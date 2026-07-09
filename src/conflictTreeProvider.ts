import * as vscode from 'vscode';
import { scanWorkspaceConflicts, ConflictFileInfo } from './conflictScanner';

export class ConflictItem extends vscode.TreeItem {
  constructor(public readonly info: ConflictFileInfo) {
    super(info.relativePath, vscode.TreeItemCollapsibleState.None);
    const n = info.conflictCount;
    const conflictLabel = `${n} conflict${n === 1 ? '' : 's'}`;
    if (info.source === 'compare') {
      this.description = n > 0 ? `${conflictLabel} · vs ${info.ref}` : `vs ${info.ref}`;
      this.contextValue = 'compareFile';
      this.iconPath = new vscode.ThemeIcon('git-compare');
      this.tooltip = n > 0
        ? `${info.relativePath} — ${conflictLabel} vs ${info.ref}`
        : `${info.relativePath} — clean auto-merge vs ${info.ref}`;
    } else {
      this.description = conflictLabel;
      this.contextValue = 'conflictFile';
      this.iconPath = new vscode.ThemeIcon('git-merge');
      this.tooltip = `${info.relativePath} — ${n} conflict block(s)`;
    }
    this.resourceUri = info.uri;
    this.command = {
      command: 'mergeStudio.openMergeEditor',
      title: 'Open Merge Editor',
      arguments: [info.uri],
    };
  }
}

export class ConflictTreeProvider implements vscode.TreeDataProvider<ConflictItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: ConflictFileInfo[] = [];

  async refresh(): Promise<ConflictFileInfo[]> {
    this.items = await scanWorkspaceConflicts();
    this._onDidChangeTreeData.fire();
    return this.items;
  }

  getCurrentItems(): ConflictFileInfo[] {
    return this.items;
  }

  getTreeItem(element: ConflictItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConflictItem): ConflictItem[] {
    if (element) {
      return [];
    }
    return this.items.map((info) => new ConflictItem(info));
  }
}
