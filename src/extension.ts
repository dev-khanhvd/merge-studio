import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConflictTreeProvider, ConflictItem } from './conflictTreeProvider';
import { StatusBarController } from './statusBarController';
import { MergeEditorPanel } from './mergeEditorPanel';
import { parseDocument, buildResultText } from './conflictParser';
import { getConflictedFilePaths, getRepoRoot, gitAdd, listRefs } from './gitHelper';
import { buildCompareSession, clearCompareSession, getSessionRef } from './compareSession';

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
    void vscode.commands.executeCommand('setContext', 'mergeStudio.compareActive', getSessionRef() !== undefined);
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
    vscode.commands.registerCommand('mergeStudio.compareWithRef', () => startCompare(refresh)),
    vscode.commands.registerCommand('mergeStudio.clearCompare', async () => {
      clearCompareSession();
      await refresh();
      vscode.window.showInformationMessage('Đã thoát chế độ Compare.');
    }),
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

async function startCompare(refresh: () => Promise<unknown>): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const firstFolder = folders[0];
  if (!firstFolder) {
    vscode.window.showWarningMessage('Chưa mở workspace nào.');
    return;
  }
  const root = await getRepoRoot(firstFolder.uri.fsPath);
  if (!root) {
    vscode.window.showErrorMessage('Thư mục hiện tại không phải git repo.');
    return;
  }

  const refs = await listRefs(root);
  const MANUAL = '$(edit) Nhập commit hash / ref…';
  const picks: vscode.QuickPickItem[] = [
    { label: MANUAL, description: 'Gõ trực tiếp commit hash, tag, hoặc tên branch' },
    ...refs.map((r) => ({ label: r })),
  ];
  const chosen = await vscode.window.showQuickPick(picks, {
    title: 'So sánh working tree với branch / commit nào?',
    placeHolder: 'Chọn ref để merge 3-way (base = merge-base chung)',
  });
  if (!chosen) {
    return;
  }

  let ref = chosen.label;
  if (ref === MANUAL) {
    const input = await vscode.window.showInputBox({
      title: 'Nhập commit hash / ref',
      placeHolder: 'vd: main, origin/dev, v1.2.0, hoặc 8fffe1c',
      validateInput: (v) => (v.trim() ? undefined : 'Ref không được rỗng'),
    });
    if (!input) {
      return;
    }
    ref = input.trim();
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Merge Studio: dựng 3-way vs ${ref}…` },
    async () => {
      const entries = await buildCompareSession(root, ref);
      const conflicting = entries.filter((e) => e.conflictCount > 0).length;
      if (entries.length === 0) {
        vscode.window.showInformationMessage(`Không có file nào khác biệt giữa working tree và ${ref}.`);
      } else if (conflicting === 0) {
        vscode.window.showInformationMessage(
          `${entries.length} file khác biệt vs ${ref} nhưng đều auto-merge sạch — không có conflict cần resolve.`,
        );
      }
    },
  );

  await refresh();
  await vscode.commands.executeCommand('mergeStudio.conflictedFiles.focus');
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
