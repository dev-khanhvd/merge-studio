import * as fs from 'fs/promises';
import * as path from 'path';
import { diffNameOnly, mergeBase, showFileAtRef, threeWayMerge } from './gitHelper';

export interface CompareEntry {
  /** Absolute path of the working-tree file. */
  fsPath: string;
  /** Path relative to the repo root, forward-slash separated. */
  relativePath: string;
  /** Number of conflicting hunks (0 = clean auto-merge). */
  conflictCount: number;
}

interface SessionState {
  ref: string;
  root: string;
  base: string;
  /** fsPath -> conflict-marked (diff3) text produced by git merge-file. */
  files: Map<string, string>;
  entries: CompareEntry[];
}

let session: SessionState | undefined;

async function readWorking(fsPath: string): Promise<string | null> {
  try {
    return await fs.readFile(fsPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Builds a 3-way comparison between the working tree (local) and `ref`
 * (incoming), using merge-base(HEAD, ref) as the ancestor. Every file that
 * differs is rendered as diff3 conflict-marked text so it flows through the
 * existing conflict panel / merge editor unchanged.
 */
export async function buildCompareSession(root: string, ref: string): Promise<CompareEntry[]> {
  const base = (await mergeBase(root, 'HEAD', ref)) ?? ref;
  const changed = await diffNameOnly(root, ref);
  const files = new Map<string, string>();
  const entries: CompareEntry[] = [];

  const baseShort = base.length >= 7 ? base.slice(0, 7) : base;
  const labels = {
    local: 'Working Tree (Current)',
    base: `Base (${baseShort})`,
    incoming: `Incoming (${ref})`,
  };

  for (const rel of changed) {
    const fsPath = path.join(root, rel);
    try {
      const local = (await readWorking(fsPath)) ?? '';
      const incoming = (await showFileAtRef(root, ref, rel)) ?? '';
      const baseContent = (await showFileAtRef(root, base, rel)) ?? '';
      const { text, conflicts } = await threeWayMerge(local, baseContent, incoming, labels);
      files.set(fsPath, text);
      entries.push({ fsPath, relativePath: rel, conflictCount: conflicts });
    } catch {
      // Binary or unmergeable file — skip it rather than fail the whole session.
    }
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  session = { ref, root, base, files, entries };
  return entries;
}

export function hasActiveSession(): boolean {
  return !!session && session.files.size > 0;
}

export function getSessionRef(): string | undefined {
  return session?.ref;
}

export function getActiveCompareEntries(): CompareEntry[] {
  return session ? session.entries : [];
}

/** The generated conflict text for a file, if it belongs to the active session. */
export function getCompareText(fsPath: string): string | undefined {
  return session?.files.get(fsPath);
}

/** Replace stored text after a partial (marker-preserving) save. */
export function updateCompareText(fsPath: string, text: string): void {
  if (session?.files.has(fsPath)) {
    session.files.set(fsPath, text);
  }
}

/** Drop one file from the session (e.g. once fully resolved). */
export function clearCompareEntry(fsPath: string): void {
  if (!session) {
    return;
  }
  session.files.delete(fsPath);
  session.entries = session.entries.filter((e) => e.fsPath !== fsPath);
  if (session.files.size === 0) {
    session = undefined;
  }
}

/** Exit compare mode entirely. */
export function clearCompareSession(): void {
  session = undefined;
}
