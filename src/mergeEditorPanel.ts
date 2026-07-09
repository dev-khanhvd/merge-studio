import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseDocument, buildResultText, hasConflictMarkers, ParsedDocument } from './conflictParser';
import { gitAdd, getRepoRoot } from './gitHelper';

type ResolveChoice = 'local' | 'base' | 'incoming' | 'both' | 'none' | 'custom';

interface InboundMessage {
  type: 'ready' | 'resolve' | 'unresolve' | 'acceptAllLocal' | 'acceptAllIncoming' | 'directEdit' | 'save' | 'saveAndMarkResolved';
  index?: number;
  choice?: ResolveChoice;
  text?: string;
}

export class MergeEditorPanel {
  private static readonly panels = new Map<string, MergeEditorPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly fileUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onSaved: () => void;

  private doc!: ParsedDocument;
  private resolutions = new Map<number, string>();
  private pendingDirectText: string | undefined;

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
    this.resolutions.clear();
    this.pendingDirectText = undefined;
    this.postInit();
    this.postUpdate();
  }

  private postInit(): void {
    this.panel.webview.postMessage({
      type: 'init',
      fileName: path.basename(this.fileUri.fsPath),
      blocks: this.doc.blocks,
      total: this.doc.conflicts.length,
    });
  }

  private postUpdate(): void {
    const resultText = buildResultText(this.doc, this.resolutions);
    this.panel.webview.postMessage({
      type: 'update',
      resultText,
      resolvedIndexes: Array.from(this.resolutions.keys()),
      resolvedCount: this.resolutions.size,
      total: this.doc.conflicts.length,
    });
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postInit();
        this.postUpdate();
        break;
      case 'resolve':
        this.resolveConflict(msg.index, msg.choice, msg.text);
        break;
      case 'unresolve':
        if (typeof msg.index === 'number') {
          this.pendingDirectText = undefined;
          this.resolutions.delete(msg.index);
          this.postUpdate();
        }
        break;
      case 'acceptAllLocal':
        this.pendingDirectText = undefined;
        for (const c of this.doc.conflicts) {
          this.resolutions.set(c.index, c.local);
        }
        this.postUpdate();
        break;
      case 'acceptAllIncoming':
        this.pendingDirectText = undefined;
        for (const c of this.doc.conflicts) {
          this.resolutions.set(c.index, c.incoming);
        }
        this.postUpdate();
        break;
      case 'directEdit':
        this.pendingDirectText = msg.text ?? '';
        break;
      case 'save':
        await this.save(false);
        break;
      case 'saveAndMarkResolved':
        await this.save(true);
        break;
    }
  }

  private resolveConflict(index: number | undefined, choice: ResolveChoice | undefined, customText: string | undefined): void {
    if (typeof index !== 'number' || !choice) {
      return;
    }
    const conflict = this.doc.conflicts.find((c) => c.index === index);
    if (!conflict) {
      return;
    }

    let text: string;
    switch (choice) {
      case 'local':
        text = conflict.local;
        break;
      case 'base':
        text = conflict.base ?? '';
        break;
      case 'incoming':
        text = conflict.incoming;
        break;
      case 'both':
        text = [conflict.local, conflict.incoming].filter((s) => s.length > 0).join(this.doc.eol);
        break;
      case 'none':
        text = '';
        break;
      case 'custom':
        text = customText ?? '';
        break;
      default:
        return;
    }

    this.pendingDirectText = undefined;
    this.resolutions.set(index, text);
    this.postUpdate();
  }

  private async save(markResolved: boolean): Promise<void> {
    const text = this.pendingDirectText !== undefined ? this.pendingDirectText : buildResultText(this.doc, this.resolutions);
    const stillHasConflicts = hasConflictMarkers(text);

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
    this.resolutions.clear();
    this.pendingDirectText = undefined;

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
    this.postUpdate();
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
