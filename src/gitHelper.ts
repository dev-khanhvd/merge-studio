import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const execFileAsync = util.promisify(execFile);

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
