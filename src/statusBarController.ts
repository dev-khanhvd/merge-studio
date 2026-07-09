import * as vscode from 'vscode';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'mergeStudio.showPanel';
    this.item.name = 'Merge Studio';
  }

  update(fileCount: number): void {
    if (fileCount > 0) {
      this.item.text = `$(git-merge) ${fileCount} conflict${fileCount > 1 ? 's' : ''}`;
      this.item.tooltip = 'Merge Studio: click to view conflicted files';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
