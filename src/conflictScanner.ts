import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { getConflictedFilePaths } from './gitHelper';
import { parseDocument } from './conflictParser';
import { getActiveCompareEntries, getSessionRef } from './compareSession';

export interface ConflictFileInfo {
  uri: vscode.Uri;
  relativePath: string;
  conflictCount: number;
  /** 'merge' = real git conflict; 'compare' = generated diff-vs-ref session. */
  source: 'merge' | 'compare';
  /** The compared ref, when source === 'compare'. */
  ref?: string;
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
          source: 'merge',
        });
      }
    } catch {
      // Unreadable (binary/deleted/permission) — skip silently.
    }
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Append entries from an active "compare vs ref" session. These are already
  // rendered by the scanner's owner ordering-independently, so keep them after
  // real conflicts.
  const ref = getSessionRef();
  const realConflictPaths = new Set(results.map((r) => r.uri.fsPath));
  for (const entry of getActiveCompareEntries()) {
    if (entry.conflictCount === 0) {
      continue; // Clean auto-merge — nothing to resolve, so hide it.
    }
    if (realConflictPaths.has(entry.fsPath)) {
      continue; // A real conflict on the same file takes precedence.
    }
    results.push({
      uri: vscode.Uri.file(entry.fsPath),
      relativePath: entry.relativePath,
      conflictCount: entry.conflictCount,
      source: 'compare',
      ref,
    });
  }

  return results;
}
