// Builds the unified 3-pane row grid (Local | Result | Server) from three
// full-file texts. Exposed as `window.MergeStudioLayout`.
(function () {
  function splitLines(text) {
    if (text === '') return [];
    return text.split(/\r\n|\n/);
  }

  /**
   * Re-expresses a diffLines(a,b) result on the "result" line axis.
   * resultIsA=true when result is the `a` side of the diff (result vs server),
   * resultIsA=false when result is the `b` side (local vs result).
   * Returns:
   *  - segments: contiguous, non-overlapping ranges of the result axis, each
   *    tagged with whether it also matches ("equal") the other side and the
   *    corresponding other-side line range.
   *  - zeroWidthOther: lines that exist only on the *other* side, keyed by
   *    the result-axis position they're anchored to (no result lines there).
   */
  function buildResultAlignedSegments(diffChunks, resultIsA) {
    const segments = [];
    const zeroWidthOther = new Map();
    let r = 0;
    let o = 0;
    for (const chunk of diffChunks) {
      if (chunk.type === 'equal') {
        segments.push({ rStart: r, rEnd: r + chunk.lines.length, equal: true });
        r += chunk.lines.length;
        o += chunk.lines.length;
        continue;
      }
      const isResultSide = resultIsA ? chunk.type === 'remove' : chunk.type === 'add';
      if (isResultSide) {
        segments.push({ rStart: r, rEnd: r + chunk.lines.length, equal: false });
        r += chunk.lines.length;
      } else {
        const existing = zeroWidthOther.get(r) || [];
        zeroWidthOther.set(r, existing.concat(chunk.lines));
        o += chunk.lines.length;
      }
    }
    return { segments, zeroWidthOther };
  }

  function buildLayout(localText, resultText, serverText) {
    const D = window.MergeStudioDiff;
    const localLines = splitLines(localText);
    const resultLines = splitLines(resultText);
    const serverLines = splitLines(serverText);

    const diffA = D.diffLines(localText, resultText); // a=local, b=result
    const diffB = D.diffLines(resultText, serverText); // a=result, b=server

    const { segments: segA, zeroWidthOther: localOnlyAtR } = buildResultAlignedSegments(diffA, false);
    const { segments: segB, zeroWidthOther: serverOnlyAtR } = buildResultAlignedSegments(diffB, true);

    const finalR = resultLines.length;
    const breakSet = new Set([0, finalR]);
    for (const s of segA) { breakSet.add(s.rStart); breakSet.add(s.rEnd); }
    for (const s of segB) { breakSet.add(s.rStart); breakSet.add(s.rEnd); }
    for (const r of localOnlyAtR.keys()) breakSet.add(r);
    for (const r of serverOnlyAtR.keys()) breakSet.add(r);
    const breakpoints = Array.from(breakSet).sort((a, b) => a - b);

    let segAIdx = 0;
    let segBIdx = 0;
    let localCursor = 0;
    let serverCursor = 0;
    const groups = [];

    // A zero-width attachment (lines that exist only on one side, anchored at
    // a result position) is always its own group — it must never be folded
    // into whatever ranged (possibly unrelated/equal) content starts at the
    // same result position, or an unrelated matching line would visually
    // get swallowed into the change/conflict block above it.
    function emitZeroWidthGroup(r0) {
      const localOnly = localOnlyAtR.get(r0) || [];
      const serverOnly = serverOnlyAtR.get(r0) || [];
      if (localOnly.length === 0 && serverOnly.length === 0) {
        return;
      }
      localCursor += localOnly.length;
      serverCursor += serverOnly.length;

      let kind;
      if (localOnly.length > 0 && serverOnly.length > 0) {
        kind = 'conflict-unresolved';
      } else if (localOnly.length > 0) {
        kind = 'diff-local-only';
      } else {
        kind = 'diff-server-only';
      }

      groups.push({
        kind,
        height: Math.max(localOnly.length, serverOnly.length),
        local: { lines: localOnly },
        result: { lines: [] },
        server: { lines: serverOnly },
      });
    }

    function emitRangedGroup(r0, r1) {
      if (r1 <= r0) {
        return;
      }

      let localSlice = [];
      let localEqual = false;
      while (segAIdx < segA.length && segA[segAIdx].rEnd <= r0) segAIdx++;
      const segAHit = segA[segAIdx];
      if (segAHit && segAHit.rStart <= r0 && segAHit.rEnd >= r1) {
        localEqual = segAHit.equal;
        if (segAHit.equal) {
          localSlice = localLines.slice(localCursor, localCursor + (r1 - r0));
          localCursor += r1 - r0;
        }
      }

      let serverSlice = [];
      let serverEqual = false;
      while (segBIdx < segB.length && segB[segBIdx].rEnd <= r0) segBIdx++;
      const segBHit = segB[segBIdx];
      if (segBHit && segBHit.rStart <= r0 && segBHit.rEnd >= r1) {
        serverEqual = segBHit.equal;
        if (segBHit.equal) {
          serverSlice = serverLines.slice(serverCursor, serverCursor + (r1 - r0));
          serverCursor += r1 - r0;
        }
      }

      const resultSlice = resultLines.slice(r0, r1);

      let kind;
      if (localEqual && serverEqual) {
        kind = 'equal';
      } else if (!localEqual && !serverEqual) {
        kind = 'diff-both-resolved';
      } else if (!localEqual) {
        kind = 'diff-local-only';
      } else {
        kind = 'diff-server-only';
      }

      groups.push({
        kind,
        height: Math.max(localSlice.length, resultSlice.length, serverSlice.length),
        local: { lines: localSlice },
        result: { lines: resultSlice },
        server: { lines: serverSlice },
      });
    }

    for (let i = 0; i < breakpoints.length; i++) {
      const r0 = breakpoints[i];
      emitZeroWidthGroup(r0);
      if (i < breakpoints.length - 1) {
        emitRangedGroup(r0, breakpoints[i + 1]);
      }
    }

    const mergedGroups = mergeAdjacentChanges(groups);
    const changeCount = mergedGroups.filter((g) => g.kind !== 'equal').length;
    const conflictCount = mergedGroups.filter((g) => g.kind === 'conflict-unresolved').length;

    return { groups: mergedGroups, changeCount, conflictCount };
  }

  function kindFlags(kind) {
    if (kind === 'conflict-unresolved' || kind === 'diff-both-resolved') return { local: true, server: true };
    if (kind === 'diff-local-only') return { local: true, server: false };
    if (kind === 'diff-server-only') return { local: false, server: true };
    return { local: false, server: false };
  }

  /**
   * The breakpoint walk above emits one group per contiguous diff chunk, so
   * a single changed line typically shows up as an adjacent remove+add pair
   * (one group with only local content, the next with only server/result
   * content). Fold consecutive non-equal groups into one continuous block —
   * this is what makes a single modified line render as one row instead of
   * two, and turns a manually-resolved multi-part hunk into one clean band.
   */
  function mergeAdjacentChanges(rawGroups) {
    const merged = [];
    for (const g of rawGroups) {
      const last = merged[merged.length - 1];
      if (last && last.kind !== 'equal' && g.kind !== 'equal') {
        const lf = kindFlags(last.kind);
        const gf = kindFlags(g.kind);
        last.local.lines = last.local.lines.concat(g.local.lines);
        last.result.lines = last.result.lines.concat(g.result.lines);
        last.server.lines = last.server.lines.concat(g.server.lines);
        const localChanged = lf.local || gf.local;
        const serverChanged = lf.server || gf.server;
        if (localChanged && serverChanged) {
          last.kind = last.result.lines.length === 0 ? 'conflict-unresolved' : 'diff-both-resolved';
        } else if (localChanged) {
          last.kind = 'diff-local-only';
        } else {
          last.kind = 'diff-server-only';
        }
        last.height = Math.max(last.local.lines.length, last.result.lines.length, last.server.lines.length);
      } else {
        merged.push({
          kind: g.kind,
          height: g.height,
          local: { lines: g.local.lines.slice() },
          result: { lines: g.result.lines.slice() },
          server: { lines: g.server.lines.slice() },
        });
      }
    }
    return merged;
  }

  window.MergeStudioLayout = { buildLayout, splitLines };
})();
