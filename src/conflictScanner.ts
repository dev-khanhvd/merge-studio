import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { getConflictedFilePaths } from './gitHelper';
import { parseDocument } from './conflictParser';

export interface ConflictFileInfo {
  uri: vscode.Uri;
  relativePath: string;
  conflictCount: number;
}

/** Scans every workspace folder's git repo for unmerged files and counts conflict blocks in each. */
export async function scanWorkspaceConflicts(): Promise<ConflictFileInfo[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const filePaths = new Set<string>();

  for (const folder of folders) {
    const paths = await getConflictedFilePaths(folder.uri.fsPath);
    for (const p of paths) {
      filePaths.add(p);
    }
  }

  const results: ConflictFileInfo[] = [];
  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const { conflicts } = parseDocument(content);
      if (conflicts.length > 0) {
        const uri = vscode.Uri.file(filePath);
        results.push({
          uri,
          relativePath: vscode.workspace.asRelativePath(uri, folders.length > 1),
          conflictCount: conflicts.length,
        });
      }
    } catch {
      // Unreadable (binary/deleted/permission) — skip silently.
    }
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
