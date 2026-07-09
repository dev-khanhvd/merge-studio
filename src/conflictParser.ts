/**
 * Parses standard Git conflict markers, including the optional diff3
 * "||||||| base" section. See `git help merge` -> "How conflicts are presented".
 */

export interface ConflictBlock {
  index: number;
  localLabel: string;
  baseLabel?: string;
  incomingLabel: string;
  local: string;
  base?: string;
  incoming: string;
}

export type DocBlock =
  | { type: 'context'; text: string }
  | { type: 'conflict'; conflict: ConflictBlock };

export interface ParsedDocument {
  blocks: DocBlock[];
  conflicts: ConflictBlock[];
  eol: string;
}

const START_RE = /^<<<<<<< ?(.*)$/;
const BASE_RE = /^\|\|\|\|\|\|\| ?(.*)$/;
const SEP_RE = /^=======\s*$/;
const END_RE = /^>>>>>>> ?(.*)$/;

export function parseDocument(text: string): ParsedDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  const blocks: DocBlock[] = [];
  const conflicts: ConflictBlock[] = [];

  let i = 0;
  let contextBuf: string[] = [];
  let index = 0;

  const flushContext = () => {
    if (contextBuf.length > 0) {
      blocks.push({ type: 'context', text: contextBuf.join(eol) });
      contextBuf = [];
    }
  };

  while (i < lines.length) {
    const startMatch = lines[i].match(START_RE);
    if (!startMatch) {
      contextBuf.push(lines[i]);
      i++;
      continue;
    }

    flushContext();
    const localLabel = startMatch[1].trim() || 'Current Change (Local)';
    i++;

    const localLines: string[] = [];
    while (i < lines.length && !BASE_RE.test(lines[i]) && !SEP_RE.test(lines[i])) {
      localLines.push(lines[i]);
      i++;
    }

    let baseLabel: string | undefined;
    let baseLines: string[] | undefined;
    if (i < lines.length && BASE_RE.test(lines[i])) {
      const baseMatch = lines[i].match(BASE_RE)!;
      baseLabel = baseMatch[1].trim() || 'Base (Ancestor)';
      i++;
      baseLines = [];
      while (i < lines.length && !SEP_RE.test(lines[i])) {
        baseLines.push(lines[i]);
        i++;
      }
    }

    // At this point lines[i] should be the "=======" separator (if the file
    // is well-formed). Skip it defensively even if EOF was reached.
    if (i < lines.length && SEP_RE.test(lines[i])) {
      i++;
    }

    const incomingLines: string[] = [];
    while (i < lines.length && !END_RE.test(lines[i])) {
      incomingLines.push(lines[i]);
      i++;
    }

    const endMatch = i < lines.length ? lines[i].match(END_RE) : null;
    const incomingLabel = endMatch && endMatch[1].trim() ? endMatch[1].trim() : 'Incoming Change (Remote)';
    if (i < lines.length) {
      i++; // skip the >>>>>>> marker line
    }

    const conflict: ConflictBlock = {
      index: index++,
      localLabel,
      baseLabel,
      incomingLabel,
      local: localLines.join(eol),
      base: baseLines ? baseLines.join(eol) : undefined,
      incoming: incomingLines.join(eol),
    };
    conflicts.push(conflict);
    blocks.push({ type: 'conflict', conflict });
  }

  flushContext();
  return { blocks, conflicts, eol };
}

const START_RE_M = /^<<<<<<< /m;
const SEP_RE_M = /^=======\s*$/m;
const END_RE_M = /^>>>>>>> /m;

export function hasConflictMarkers(text: string): boolean {
  return START_RE_M.test(text) && SEP_RE_M.test(text) && END_RE_M.test(text);
}

export function countConflictMarkers(text: string): number {
  const matches = text.match(/^<<<<<<< /gm);
  return matches ? matches.length : 0;
}

export function buildResultText(doc: ParsedDocument, resolutions: Map<number, string>): string {
  const parts: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === 'context') {
      parts.push(block.text);
    } else {
      const resolved = resolutions.get(block.conflict.index);
      parts.push(resolved !== undefined ? resolved : rawConflictText(block.conflict, doc.eol));
    }
  }
  return parts.join(doc.eol);
}

/**
 * Joins block texts with `eol`, but drops conflict blocks whose resolved
 * text is empty entirely (rather than inserting an eol for them) so a hunk
 * that legitimately contributes zero lines doesn't leave a spurious blank
 * line behind. Context blocks are always kept, even when '' (a real blank
 * line in the source file).
 */
function joinDroppingEmptyConflicts(doc: ParsedDocument, resolve: (c: ConflictBlock) => string): string {
  const parts: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === 'context') {
      parts.push(block.text);
      continue;
    }
    const text = resolve(block.conflict);
    if (text !== '') {
      parts.push(text);
    }
  }
  return parts.join(doc.eol);
}

export function buildLocalText(doc: ParsedDocument): string {
  return joinDroppingEmptyConflicts(doc, (c) => c.local);
}

export function buildServerText(doc: ParsedDocument): string {
  return joinDroppingEmptyConflicts(doc, (c) => c.incoming);
}

/**
 * Initial "Result" text: context is copied as-is, and each conflict is
 * auto-merged only when the diff3 base shows just one side actually changed
 * (base === the other side). Genuine two-sided conflicts are left blank so
 * the webview renders them as an unresolved gap the user must fill in.
 */
export function buildAutoMergedResultText(doc: ParsedDocument): string {
  return joinDroppingEmptyConflicts(doc, (c) => {
    if (c.base !== undefined) {
      if (c.base === c.local) {
        return c.incoming;
      }
      if (c.base === c.incoming) {
        return c.local;
      }
    }
    return '';
  });
}

/** Conflicts that buildAutoMergedResultText couldn't auto-merge (genuine two-sided conflicts). */
export function countUnresolvedConflicts(doc: ParsedDocument): number {
  return doc.conflicts.filter((c) => !(c.base !== undefined && (c.base === c.local || c.base === c.incoming))).length;
}

function rawConflictText(c: ConflictBlock, eol: string): string {
  const lines = [`<<<<<<< ${c.localLabel}`, c.local];
  if (c.base !== undefined) {
    lines.push(`||||||| ${c.baseLabel ?? ''}`.trimEnd());
    lines.push(c.base);
  }
  lines.push('=======');
  lines.push(c.incoming);
  lines.push(`>>>>>>> ${c.incomingLabel}`);
  return lines.join(eol);
}
