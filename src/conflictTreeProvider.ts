import * as vscode from 'vscode';
import { scanWorkspaceConflicts, ConflictFileInfo } from './conflictScanner';

export class ConflictItem extends vscode.TreeItem {
  constructor(public readonly info: ConflictFileInfo) {
    super(info.relativePath, vscode.TreeItemCollapsibleState.None);
    this.description = `${info.conflictCount} conflict${info.conflictCount > 1 ? 's' : ''}`;
    this.contextValue = 'conflictFile';
    this.iconPath = new vscode.ThemeIcon('git-merge');
    this.resourceUri = info.uri;
    this.tooltip = `${info.relativePath} — ${info.conflictCount} conflict block(s)`;
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
