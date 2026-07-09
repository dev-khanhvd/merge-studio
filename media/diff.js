// Vanilla-JS Myers diff (O(ND)), no external dependencies. Exposed as
// `window.MergeStudioDiff` for use by mergeLayout.js / main.js.
(function () {
  /**
   * Classic Myers diff over two arrays of comparable (string) items.
   * Returns a list of grouped ops: { type: 'equal'|'remove'|'add', items: string[] }
   *
   * Trims the common prefix/suffix before running the O(ND) core. This isn't
   * just an optimization: without it, Myers diff can pick an equal-cost but
   * unintuitive alignment (e.g. treating a trailing common line as part of a
   * replacement instead of matching it), which would visually merge an
   * unrelated unchanged line into a change/conflict block.
   */
  function diffArrays(a, b) {
    let prefix = 0;
    const minLen = Math.min(a.length, b.length);
    while (prefix < minLen && a[prefix] === b[prefix]) prefix++;

    let suffix = 0;
    while (suffix < minLen - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

    const aMid = a.slice(prefix, a.length - suffix);
    const bMid = b.slice(prefix, b.length - suffix);
    const midChunks = diffArraysCore(aMid, bMid);

    const chunks = [];
    if (prefix > 0) chunks.push({ type: 'equal', items: a.slice(0, prefix) });
    chunks.push(...midChunks);
    if (suffix > 0) chunks.push({ type: 'equal', items: a.slice(a.length - suffix) });
    return chunks;
  }

  function diffArraysCore(a, b) {
    const max = a.length + b.length;
    let v = { 1: 0 };
    const trace = [];

    outer: for (let d = 0; d <= max; d++) {
      trace.push(Object.assign({}, v));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
          x = v[k + 1];
        } else {
          x = v[k - 1] + 1;
        }
        let y = x - k;
        while (x < a.length && y < b.length && a[x] === b[y]) {
          x++;
          y++;
        }
        v[k] = x;
        if (x >= a.length && y >= b.length) {
          break outer;
        }
      }
    }

    const ops = [];
    let x = a.length;
    let y = b.length;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vd = trace[d];
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && vd[k - 1] < vd[k + 1])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      const prevX = vd[prevK];
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        ops.push({ type: 'equal', aIndex: x - 1, bIndex: y - 1 });
        x--;
        y--;
      }

      if (d > 0) {
        if (x === prevX) {
          ops.push({ type: 'add', bIndex: y - 1 });
          y--;
        } else {
          ops.push({ type: 'remove', aIndex: x - 1 });
          x--;
        }
      }
    }
    ops.reverse();

    const chunks = [];
    for (const op of ops) {
      const item = op.type === 'add' ? b[op.bIndex] : a[op.aIndex];
      const last = chunks[chunks.length - 1];
      if (last && last.type === op.type) {
        last.items.push(item);
      } else {
        chunks.push({ type: op.type, items: [item] });
      }
    }
    return chunks;
  }

  function splitLines(text) {
    if (text === '') return [];
    return text.split(/\r\n|\n/);
  }

  /** Diff two texts at line granularity. Chunks use `lines` instead of `items`. */
  function diffLines(oldText, newText) {
    const chunks = diffArrays(splitLines(oldText), splitLines(newText));
    return chunks.map((c) => ({ type: c.type, lines: c.items }));
  }

  function splitWords(line) {
    return line.split(/(\s+)/).filter((s) => s.length > 0);
  }

  /** Diff two single lines at word/whitespace-token granularity. */
  function diffWords(oldLine, newLine) {
    const chunks = diffArrays(splitWords(oldLine), splitWords(newLine));
    return chunks.map((c) => ({ type: c.type, tokens: c.items }));
  }

  window.MergeStudioDiff = { diffLines, diffWords };
})();
