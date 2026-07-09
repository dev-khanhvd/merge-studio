import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConflictTreeProvider, ConflictItem } from './conflictTreeProvider';
import { StatusBarController } from './statusBarController';
import { MergeEditorPanel } from './mergeEditorPanel';
import { parseDocument, buildResultText } from './conflictParser';
import { getConflictedFilePaths, getRepoRoot, gitAdd } from './gitHelper';

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const treeProvider = new ConflictTreeProvider();
  const statusBar = new StatusBarController();
  const treeView = vscode.window.createTreeView('mergeStudio.conflictedFiles', {
    treeDataProvider: treeProvider,
  });

  const refresh = async () => {
    const items = await treeProvider.refresh();
    statusBar.update(items.length);
    treeView.badge = items.length > 0
      ? { value: items.length, tooltip: `${items.length} file(s) with conflicts` }
      : undefined;
    return items;
  };

  const debouncedRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(refresh, 400);
  };

  context.subscriptions.push(
    treeView,
    statusBar,
    vscode.commands.registerCommand('mergeStudio.refresh', refresh),
    vscode.commands.registerCommand('mergeStudio.showPanel', () =>
      vscode.commands.executeCommand('mergeStudio.conflictedFiles.focus'),
    ),
    vscode.commands.registerCommand('mergeStudio.openMergeEditor', async (arg?: vscode.Uri | ConflictItem) => {
      const uri = resolveUri(arg);
      if (!uri) {
        vscode.window.showWarningMessage('Chọn một file đang conflict để mở Merge Editor.');
        return;
      }
      await MergeEditorPanel.createOrShow(context, uri, () => {
        void refresh();
      });
    }),
    vscode.commands.registerCommand('mergeStudio.markResolved', async (arg?: vscode.Uri | ConflictItem) => {
      const uri = resolveUri(arg);
      if (!uri) {
        vscode.window.showWarningMessage('Không có file nào được chọn.');
        return;
      }
      const content = await fs.readFile(uri.fsPath, 'utf8');
      const { conflicts } = parseDocument(content);
      if (conflicts.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `${path.basename(uri.fsPath)} vẫn còn ${conflicts.length} conflict chưa resolve. Vẫn đánh dấu resolved?`,
          { modal: true },
          'Đánh dấu vẫn',
        );
        if (choice !== 'Đánh dấu vẫn') {
          return;
        }
      }
      const root = await getRepoRoot(path.dirname(uri.fsPath));
      if (!root) {
        vscode.window.showErrorMessage('Không tìm thấy git repo cho file này.');
        return;
      }
      await gitAdd(root, uri.fsPath);
      vscode.window.showInformationMessage(`Đã git add: ${path.basename(uri.fsPath)}`);
      await refresh();
    }),
    vscode.commands.registerCommand('mergeStudio.acceptAllCurrentFile', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        vscode.window.showWarningMessage('Không có file nào đang mở trong editor.');
        return;
      }
      await applyAcceptAll(uri, 'local');
      await refresh();
    }),
    vscode.commands.registerCommand('mergeStudio.acceptAllIncomingFile', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        vscode.window.showWarningMessage('Không có file nào đang mở trong editor.');
        return;
      }
      await applyAcceptAll(uri, 'incoming');
      await refresh();
    }),
    vscode.commands.registerCommand('mergeStudio.acceptAllCurrentWorkspace', () => acceptAllInWorkspace('local', refresh)),
    vscode.commands.registerCommand('mergeStudio.acceptAllIncomingWorkspace', () => acceptAllInWorkspace('incoming', refresh)),
    vscode.commands.registerCommand('mergeStudio.nextConflict', () => MergeEditorPanel.getActive()?.navigate('next')),
    vscode.commands.registerCommand('mergeStudio.previousConflict', () => MergeEditorPanel.getActive()?.navigate('prev')),
    vscode.workspace.onDidSaveTextDocument(() => debouncedRefresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => debouncedRefresh()),
  );

  const gitStateWatcher = vscode.workspace.createFileSystemWatcher('**/.git/{MERGE_HEAD,index}');
  gitStateWatcher.onDidCreate(debouncedRefresh);
  gitStateWatcher.onDidChange(debouncedRefresh);
  gitStateWatcher.onDidDelete(debouncedRefresh);
  context.subscriptions.push(gitStateWatcher);

  await refresh();
}

export function deactivate(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
}

function resolveUri(arg?: vscode.Uri | ConflictItem): vscode.Uri | undefined {
  if (!arg) {
    return vscode.window.activeTextEditor?.document.uri;
  }
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  return arg.info.uri;
}

async function acceptAllInWorkspace(choice: 'local' | 'incoming', refresh: () => Promise<unknown>): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const filePaths = new Set<string>();
  for (const folder of folders) {
    const paths = await getConflictedFilePaths(folder.uri.fsPath);
    for (const p of paths) {
      filePaths.add(p);
    }
  }

  if (filePaths.size === 0) {
    vscode.window.showInformationMessage('Không có file nào đang conflict trong workspace.');
    return;
  }

  const label = choice === 'local' ? 'Accept All Current' : 'Accept All Incoming';
  const confirm = await vscode.window.showWarningMessage(
    `Áp dụng "${label}" cho ${filePaths.size} file trong toàn workspace? Hành động này sẽ ghi đè nội dung các file đó.`,
    { modal: true },
    'Tiếp tục',
  );
  if (confirm !== 'Tiếp tục') {
    return;
  }

  for (const filePath of filePaths) {
    await applyAcceptAll(vscode.Uri.file(filePath), choice);
  }
  await refresh();
  vscode.window.showInformationMessage(`Đã resolve ${filePaths.size} file (${label}).`);
}

async function applyAcceptAll(uri: vscode.Uri, choice: 'local' | 'incoming'): Promise<void> {
  const content = await fs.readFile(uri.fsPath, 'utf8');
  const doc = parseDocument(content);
  if (doc.conflicts.length === 0) {
    return;
  }
  const resolutions = new Map<number, string>();
  for (const conflict of doc.conflicts) {
    resolutions.set(conflict.index, choice === 'local' ? conflict.local : conflict.incoming);
  }
  const result = buildResultText(doc, resolutions);
  await fs.writeFile(uri.fsPath, result, 'utf8');
}
