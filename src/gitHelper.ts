import { execFile } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';

const execFileAsync = util.promisify(execFile);
const BIG_BUFFER = 64 * 1024 * 1024;

export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Returns absolute paths of files currently in an unmerged (conflicted) state. */
export async function getConflictedFilePaths(cwd: string): Promise<string[]> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return [];
  }
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: root });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((relativePath) => path.join(root, relativePath));
  } catch {
    return [];
  }
}

export async function gitAdd(cwd: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], { cwd });
}

export async function isInMerge(cwd: string): Promise<boolean> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return false;
  }
  return fs.existsSync(path.join(root, '.git', 'MERGE_HEAD'));
}

/** Local branches, remote-tracking branches, and tags — for a ref picker. */
export async function listRefs(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes', 'refs/tags'],
      { cwd: root },
    );
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** The common ancestor of two refs, or null if they share no history. */
export async function mergeBase(root: string, a: string, b: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', a, b], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Relative paths that differ between `ref` and the working tree. */
export async function diffNameOnly(root: string, ref: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', ref, '--'], { cwd: root, maxBuffer: BIG_BUFFER });
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Content of `relPath` at `ref`, or null if the file does not exist there. */
export async function showFileAtRef(root: string, ref: string, relPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${relPath}`], { cwd: root, maxBuffer: BIG_BUFFER });
    return stdout;
  } catch {
    return null;
  }
}

export interface MergeFileResult {
  /** Merged text with diff3 conflict markers for the hunks that clash. */
  text: string;
  /** Number of conflicting hunks git could not auto-merge. */
  conflicts: number;
}

/**
 * Runs `git merge-file --diff3` over three in-memory versions and returns the
 * merged text (with conflict markers) plus the conflict count. `local` is kept
 * on the "current" side, `incoming` on the "other" side, `base` as ancestor.
 */
export async function threeWayMerge(
  local: string,
  base: string,
  incoming: string,
  labels: { local: string; base: string; incoming: string },
): Promise<MergeFileResult> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mergestudio-'));
  const cur = path.join(dir, 'current');
  const bas = path.join(dir, 'base');
  const oth = path.join(dir, 'other');
  try {
    await Promise.all([
      fsp.writeFile(cur, local, 'utf8'),
      fsp.writeFile(bas, base, 'utf8'),
      fsp.writeFile(oth, incoming, 'utf8'),
    ]);
    const args = [
      'merge-file', '-p', '--diff3',
      '-L', labels.local, '-L', labels.base, '-L', labels.incoming,
      cur, bas, oth,
    ];
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: dir, maxBuffer: BIG_BUFFER });
      return { text: stdout, conflicts: 0 };
    } catch (err) {
      // git merge-file exits with the number of conflicts (>0); stdout still
      // holds the merged text. Any other failure (code < 0 / no stdout) rethrows.
      const e = err as { code?: number; stdout?: string };
      if (typeof e.code === 'number' && e.code > 0 && typeof e.stdout === 'string') {
        return { text: e.stdout, conflicts: e.code };
      }
      throw err;
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
