import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  parseDocument,
  hasConflictMarkers,
  buildLocalText,
  buildServerText,
  buildAutoMergedResultText,
  countUnresolvedConflicts,
  ParsedDocument,
} from './conflictParser';
import { gitAdd, getRepoRoot } from './gitHelper';

interface InboundMessage {
  type: 'ready' | 'reload' | 'directEdit' | 'save' | 'saveAndMarkResolved' | 'abort';
  text?: string;
  remainingConflicts?: number;
}

export class MergeEditorPanel {
  private static readonly panels = new Map<string, MergeEditorPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly fileUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onSaved: () => void;

  private doc!: ParsedDocument;
  private currentResultText = '';
  private remainingConflicts = 0;

  static async createOrShow(context: vscode.ExtensionContext, fileUri: vscode.Uri, onSaved: () => void): Promise<MergeEditorPanel> {
    const key = fileUri.fsPath;
    const existing = MergeEditorPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      await existing.load();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'mergeStudio.editor',
      `Merge: ${path.basename(fileUri.fsPath)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    const instance = new MergeEditorPanel(context, panel, fileUri, onSaved);
    MergeEditorPanel.panels.set(key, instance);
    await instance.load();
    return instance;
  }

  static getActive(): MergeEditorPanel | undefined {
    for (const candidate of MergeEditorPanel.panels.values()) {
      if (candidate.panel.active) {
        return candidate;
      }
    }
    return undefined;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    fileUri: vscode.Uri,
    onSaved: () => void,
  ) {
    this.panel = panel;
    this.fileUri = fileUri;
    this.onSaved = onSaved;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.handleMessage(msg), null, this.disposables);
  }

  navigate(direction: 'next' | 'prev'): void {
    this.panel.reveal();
    this.panel.webview.postMessage({ type: 'navigate', direction });
  }

  private async load(): Promise<void> {
    const content = await fs.readFile(this.fileUri.fsPath, 'utf8');
    this.doc = parseDocument(content);
    this.currentResultText = buildAutoMergedResultText(this.doc);
    this.remainingConflicts = countUnresolvedConflicts(this.doc);
    this.postInit();
  }

  private postInit(): void {
    this.panel.webview.postMessage({
      type: 'init',
      fileName: path.basename(this.fileUri.fsPath),
      localText: buildLocalText(this.doc),
      serverText: buildServerText(this.doc),
      resultText: this.currentResultText,
    });
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postInit();
        break;
      case 'reload':
        await this.load();
        break;
      case 'directEdit':
        this.currentResultText = msg.text ?? '';
        this.remainingConflicts = msg.remainingConflicts ?? this.remainingConflicts;
        break;
      case 'save':
        await this.save(false);
        break;
      case 'saveAndMarkResolved':
        await this.save(true);
        break;
      case 'abort':
        this.panel.dispose();
        break;
    }
  }

  private async save(markResolved: boolean): Promise<void> {
    const text = this.currentResultText;
    const stillHasConflicts = this.remainingConflicts > 0 || hasConflictMarkers(text);

    if (stillHasConflicts) {
      const choice = await vscode.window.showWarningMessage(
        `${path.basename(this.fileUri.fsPath)} vẫn còn conflict chưa resolve hết. Vẫn lưu file?`,
        { modal: true },
        'Lưu vẫn',
      );
      if (choice !== 'Lưu vẫn') {
        return;
      }
    }

    await fs.writeFile(this.fileUri.fsPath, text, 'utf8');

    // Reload from what we just wrote so in-memory state matches disk.
    this.doc = parseDocument(text);
    this.currentResultText = buildAutoMergedResultText(this.doc);
    this.remainingConflicts = countUnresolvedConflicts(this.doc);

    if (!stillHasConflicts && markResolved) {
      const root = await getRepoRoot(path.dirname(this.fileUri.fsPath));
      if (root) {
        await gitAdd(root, this.fileUri.fsPath);
        vscode.window.showInformationMessage(`Đã resolve và git add: ${path.basename(this.fileUri.fsPath)}`);
      } else {
        vscode.window.showInformationMessage(`Đã lưu (không tìm thấy git repo để add): ${path.basename(this.fileUri.fsPath)}`);
      }
    } else {
      vscode.window.showInformationMessage(`Đã lưu: ${path.basename(this.fileUri.fsPath)}`);
    }

    this.postInit();
    this.onSaved();
  }

  private dispose(): void {
    MergeEditorPanel.panels.delete(this.fileUri.fsPath);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const diffUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'diff.js'));
    const layoutUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mergeLayout.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${styleUri}" />
<title>Merge Studio</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${diffUri}"></script>
<script nonce="${nonce}" src="${layoutUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
