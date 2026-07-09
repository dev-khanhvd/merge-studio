(function () {
  const vscode = acquireVsCodeApi();
  const ROW_H = 19; // keep in sync with --ms-row-h in main.css
  const COLLAPSE_THRESHOLD = 8;
  const EDGE_LINES = 3;

  let fileName = '';
  let localText = '';
  let serverText = '';
  let resultText = '';
  let localLabel = 'HEAD';
  let incomingLabel = 'incoming';
  let EOL = '\n';
  let layout = { groups: [], changeCount: 0, conflictCount: 0 };
  let focusedGroupIndex = -1;
  let wordHighlight = true;
  let collapseUnchanged = true;
  let dirty = false;
  const expandedGroups = new Set();

  // Populated fresh on every render(); entries are either
  // { el: <textarea> } for a live-editable group, or
  // { staticText } for a collapsed equal-group with no live editor.
  let resultTextareas = [];
  let pendingCursor = null;
  let editDebounce = null;

  const app = document.getElementById('app');

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') {
          node.className = value;
        } else if (key === 'title') {
          node.title = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== undefined && value !== null && value !== false) {
          node.setAttribute(key, value === true ? '' : value);
        }
      }
    }
    for (const child of children || []) {
      if (child === undefined || child === null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function rowDiv(text, extraClass) {
    const d = document.createElement('div');
    d.className = extraClass ? 'row ' + extraClass : 'row';
    if (text) d.textContent = text;
    return d;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  // ---------- render ----------

  function render() {
    app.innerHTML = '';
    resultTextareas = [];
    app.appendChild(renderToolbar());
    app.appendChild(renderMergeGrid());
    app.appendChild(renderBottomBar());
    restoreCursorIfPending();
  }

  function renderToolbar() {
    const bar = el('div', { className: 'toolbar' }, [
      el('span', { className: 'file-name' }, [fileName || '']),
      el('button', { onClick: () => go(-1), title: 'Xung đột trước' }, ['↑ Trước']),
      el('button', { onClick: () => go(1), title: 'Xung đột tiếp theo' }, ['Tiếp theo ↓']),
      buildHighlightSelect(),
      el('button', {
        className: 'icon-btn' + (collapseUnchanged ? ' toggled' : ''),
        title: 'Thu gọn phần không đổi',
        onClick: () => {
          collapseUnchanged = !collapseUnchanged;
          render();
        },
      }, ['≡']),
      el('button', {
        className: 'icon-btn',
        title: 'Tải lại từ đĩa',
        onClick: () => post({ type: 'reload' }),
      }, ['↻']),
      el('button', {
        className: 'accept-local',
        title: 'Accept All Local',
        onClick: () => acceptAll('local'),
      }, ['✔ Local']),
      el('button', {
        className: 'accept-server',
        title: 'Accept All Incoming',
        onClick: () => acceptAll('server'),
      }, ['✔ Server']),
      el('span', { className: 'spacer' }, []),
      el('span', { className: 'counter' }, [
        `${layout.changeCount} thay đổi. ${layout.conflictCount} xung đột.`,
      ]),
    ]);
    return bar;
  }

  function buildHighlightSelect() {
    const select = document.createElement('select');
    const opt1 = document.createElement('option');
    opt1.value = 'words';
    opt1.textContent = 'Highlight words';
    const opt2 = document.createElement('option');
    opt2.value = 'lines';
    opt2.textContent = 'Highlight lines';
    select.appendChild(opt1);
    select.appendChild(opt2);
    select.value = wordHighlight ? 'words' : 'lines';
    select.addEventListener('change', () => {
      wordHighlight = select.value === 'words';
      render();
    });
    return select;
  }

  function renderBottomBar() {
    const group = focusedGroupIndex >= 0 ? layout.groups[focusedGroupIndex] : null;
    const canLeft = !!group && group.kind !== 'equal' && group.kind !== 'diff-server-only';
    const canRight = !!group && group.kind !== 'equal' && group.kind !== 'diff-local-only';
    return el('div', { className: 'bottom-bar' }, [
      el('button', {
        onClick: () => focusedGroupIndex >= 0 && takeSide(focusedGroupIndex, 'local'),
        disabled: !canLeft,
      }, ['Accept Left']),
      el('button', {
        onClick: () => focusedGroupIndex >= 0 && takeSide(focusedGroupIndex, 'server'),
        disabled: !canRight,
      }, ['Accept Right']),
      el('span', { className: 'spacer' }, []),
      el('button', { className: 'danger', onClick: onAbort }, ['Abort']),
      el('button', { className: 'primary', onClick: onApply }, ['Apply']),
    ]);
  }

  function onApply() {
    // Flush any pending debounced edit first, otherwise text typed within the
    // last 250ms would be lost (the host would save the previous value).
    flushPendingEdit();
    post({ type: 'saveAndMarkResolved', conflictText: buildTextWithConflictMarkers() });
    dirty = false;
  }

  function onAbort() {
    // Flush so the host is in sync even if the user cancels the abort prompt.
    flushPendingEdit();
    // confirm() is blocked in the VS Code webview sandbox and always returns a
    // falsy value, so the confirmation must happen on the extension host side.
    post({ type: 'abort', dirty });
  }

  // Recombines the live textareas, rebuilds the layout, and pushes the latest
  // result text to the host synchronously, cancelling any queued debounce.
  function flushPendingEdit() {
    if (editDebounce !== null) {
      clearTimeout(editDebounce);
      editDebounce = null;
    }
    resultText = recombineResultText();
    layout = window.MergeStudioLayout.buildLayout(localText, resultText, serverText);
    post({ type: 'directEdit', text: resultText, remainingConflicts: layout.conflictCount });
  }

  // Serializes the current result, re-inserting real Git conflict markers for
  // every still-unresolved hunk. Used when the user chooses to save a file that
  // still has conflicts, so unresolved hunks keep both sides instead of being
  // silently written out as an empty (resolved-looking) gap.
  function buildTextWithConflictMarkers() {
    const out = [];
    for (const g of layout.groups) {
      if (g.kind === 'conflict-unresolved') {
        out.push('<<<<<<< ' + localLabel);
        for (const l of g.local.lines) out.push(l);
        out.push('=======');
        for (const l of g.server.lines) out.push(l);
        out.push('>>>>>>> ' + incomingLabel);
      } else {
        for (const l of g.result.lines) out.push(l);
      }
    }
    return out.join(EOL);
  }

  function getChangeIndices() {
    const out = [];
    layout.groups.forEach((g, i) => {
      if (g.kind !== 'equal') out.push(i);
    });
    return out;
  }

  // ---------- 3-pane grid ----------

  function renderMergeGrid() {
    const scroll = el('div', { className: 'merge-scroll' }, []);

    if (layout.groups.length === 0) {
      scroll.appendChild(el('div', { className: 'empty-state' }, ['Không có nội dung.']));
      return scroll;
    }

    const localCol = el('div', { className: 'pane-col text' }, []);
    const localNum = el('div', { className: 'pane-col linenum' }, []);
    const gutterLeft = el('div', { className: 'pane-col gutter gutter-left' }, []);
    const resultNumL = el('div', { className: 'pane-col linenum' }, []);
    const resultCol = el('div', { className: 'pane-col text' }, []);
    const resultNumR = el('div', { className: 'pane-col linenum' }, []);
    const gutterRight = el('div', { className: 'pane-col gutter gutter-right' }, []);
    const serverNum = el('div', { className: 'pane-col linenum' }, []);
    const serverCol = el('div', { className: 'pane-col text' }, []);

    let localLineNo = 1;
    let resultLineNo = 1;
    let serverLineNo = 1;

    layout.groups.forEach((group, groupIndex) => {
      const collapsible = collapseUnchanged
        && group.kind === 'equal'
        && group.height > COLLAPSE_THRESHOLD
        && !expandedGroups.has(groupIndex);

      if (collapsible) {
        renderCollapsedGroup(group, groupIndex, {
          localCol, localNum, gutterLeft, resultNumL, resultCol, resultNumR, gutterRight, serverNum, serverCol,
        }, localLineNo, resultLineNo, serverLineNo);
      } else {
        renderFullGroup(group, groupIndex, {
          localCol, localNum, gutterLeft, resultNumL, resultCol, resultNumR, gutterRight, serverNum, serverCol,
        }, localLineNo, resultLineNo, serverLineNo);
      }

      localLineNo += group.local.lines.length;
      resultLineNo += group.result.lines.length;
      serverLineNo += group.server.lines.length;
    });

    scroll.appendChild(localCol);
    scroll.appendChild(localNum);
    scroll.appendChild(gutterLeft);
    scroll.appendChild(resultNumL);
    scroll.appendChild(resultCol);
    scroll.appendChild(resultNumR);
    scroll.appendChild(gutterRight);
    scroll.appendChild(serverNum);
    scroll.appendChild(serverCol);
    return scroll;
  }

  function renderFullGroup(group, groupIndex, cols, localLineNo, resultLineNo, serverLineNo) {
    const focused = groupIndex === focusedGroupIndex;
    const blockClass = 'group-block kind-' + group.kind + (focused ? ' focused' : '');

    appendTextBlock(cols.localCol, group.local.lines, group.height, blockClass, groupIndex, {
      counterpart: group.kind !== 'equal' ? group.result.lines : null,
    });
    appendLineNumBlock(cols.localNum, localLineNo, group.local.lines.length, group.height, blockClass, groupIndex);

    appendResultBlock(cols.resultCol, group, groupIndex, blockClass);
    appendLineNumBlock(cols.resultNumL, resultLineNo, group.result.lines.length, group.height, blockClass, groupIndex);
    appendLineNumBlock(cols.resultNumR, resultLineNo, group.result.lines.length, group.height, blockClass, groupIndex);

    appendTextBlock(cols.serverCol, group.server.lines, group.height, blockClass, groupIndex, {
      counterpart: group.kind !== 'equal' ? group.result.lines : null,
    });
    appendLineNumBlock(cols.serverNum, serverLineNo, group.server.lines.length, group.height, blockClass, groupIndex);

    cols.gutterLeft.appendChild(buildGutterBand('left', group, groupIndex, blockClass));
    cols.gutterRight.appendChild(buildGutterBand('right', group, groupIndex, blockClass));
  }

  function renderCollapsedGroup(group, groupIndex, cols, localLineNo, resultLineNo, serverLineNo) {
    const total = group.height;
    const hidden = total - EDGE_LINES * 2;
    const blockClass = 'group-block kind-equal';

    appendStaticEdges(cols.localCol, group.local.lines, hidden, blockClass, groupIndex);
    appendLineNumEdges(cols.localNum, localLineNo, total, hidden, blockClass, groupIndex);

    const wrap = el('div', { className: blockClass }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    appendStaticEdgesInto(wrap, group.result.lines, hidden, groupIndex);
    cols.resultCol.appendChild(wrap);
    resultTextareas[groupIndex] = { staticText: group.result.lines.join(EOL) };

    appendLineNumEdges(cols.resultNumL, resultLineNo, total, hidden, blockClass, groupIndex);
    appendLineNumEdges(cols.resultNumR, resultLineNo, total, hidden, blockClass, groupIndex);

    appendStaticEdges(cols.serverCol, group.server.lines, hidden, blockClass, groupIndex);
    appendLineNumEdges(cols.serverNum, serverLineNo, total, hidden, blockClass, groupIndex);

    const leftGutter = el('div', { className: blockClass }, [spacerDiv((EDGE_LINES * 2 + 1) * ROW_H)]);
    leftGutter.dataset.groupIndex = String(groupIndex);
    cols.gutterLeft.appendChild(leftGutter);
    const rightGutter = el('div', { className: blockClass }, [spacerDiv((EDGE_LINES * 2 + 1) * ROW_H)]);
    rightGutter.dataset.groupIndex = String(groupIndex);
    cols.gutterRight.appendChild(rightGutter);
  }

  function spacerDiv(height) {
    const d = document.createElement('div');
    d.style.height = height + 'px';
    return d;
  }

  function appendStaticEdges(col, lines, hidden, blockClass, groupIndex) {
    const wrap = el('div', { className: blockClass }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    appendStaticEdgesInto(wrap, lines, hidden, groupIndex);
    col.appendChild(wrap);
  }

  function appendStaticEdgesInto(wrap, lines, hidden, groupIndex) {
    const head = lines.slice(0, EDGE_LINES);
    const tail = lines.slice(lines.length - EDGE_LINES);
    for (const line of head) wrap.appendChild(rowDiv(line));
    const divider = el('div', { className: 'collapse-divider' }, [`⋮ ${hidden} dòng không đổi ⋮`]);
    divider.addEventListener('click', () => {
      expandedGroups.add(groupIndex);
      render();
    });
    wrap.appendChild(divider);
    for (const line of tail) wrap.appendChild(rowDiv(line));
  }

  function appendLineNumEdges(col, startLine, total, hidden, blockClass, groupIndex) {
    const wrap = el('div', { className: blockClass }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    for (let i = 0; i < EDGE_LINES; i++) wrap.appendChild(rowDiv(String(startLine + i)));
    wrap.appendChild(el('div', { className: 'collapse-divider' }, [`⋮ ${hidden} ⋮`]));
    for (let i = total - EDGE_LINES; i < total; i++) wrap.appendChild(rowDiv(String(startLine + i)));
    col.appendChild(wrap);
  }

  function appendTextBlock(col, lines, height, blockClass, groupIndex, wordOpts) {
    const wrap = el('div', { className: blockClass }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    for (let i = 0; i < height; i++) {
      if (i < lines.length) {
        const row = document.createElement('div');
        row.className = 'row';
        if (wordHighlight && wordOpts && wordOpts.counterpart && wordOpts.counterpart.length === lines.length) {
          appendWordDiff(row, wordOpts.counterpart[i], lines[i], 'new');
        } else {
          row.textContent = lines[i];
        }
        wrap.appendChild(row);
      } else {
        wrap.appendChild(rowDiv('', 'filler'));
      }
    }
    col.appendChild(wrap);
  }

  function appendWordDiff(row, otherLine, ownLine, side) {
    const chunks = window.MergeStudioDiff.diffWords(otherLine, ownLine);
    for (const c of chunks) {
      if (c.type === 'equal') {
        row.appendChild(document.createTextNode(c.tokens.join('')));
      } else if (side === 'new' && c.type === 'add') {
        const span = document.createElement('span');
        span.className = 'tok-changed';
        span.textContent = c.tokens.join('');
        row.appendChild(span);
      }
    }
  }

  function appendLineNumBlock(col, startLine, realCount, height, blockClass, groupIndex) {
    const wrap = el('div', { className: blockClass }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    for (let i = 0; i < height; i++) {
      wrap.appendChild(i < realCount ? rowDiv(String(startLine + i)) : rowDiv('', 'filler'));
    }
    col.appendChild(wrap);
  }

  function appendResultBlock(col, group, groupIndex, blockClass) {
    const wrap = el('div', { className: blockClass + ' result-cell-wrap' }, []);
    wrap.dataset.groupIndex = String(groupIndex);
    wrap.style.minHeight = (group.height * ROW_H) + 'px';
    const textarea = document.createElement('textarea');
    textarea.className = 'ms-result-ta';
    textarea.spellcheck = false;
    textarea.value = group.result.lines.join(EOL);
    textarea.rows = Math.max(1, group.result.lines.length);
    textarea.addEventListener('focus', () => {
      if (focusedGroupIndex !== groupIndex) {
        focusedGroupIndex = groupIndex;
        updateFocusOutline();
      }
    });
    textarea.addEventListener('input', () => onResultInput(textarea));
    wrap.appendChild(textarea);
    col.appendChild(wrap);
    resultTextareas[groupIndex] = { el: textarea };
    autoGrow(textarea);
  }

  function updateFocusOutline() {
    document.querySelectorAll('.group-block.focused').forEach((n) => n.classList.remove('focused'));
    document.querySelectorAll(`[data-group-index="${focusedGroupIndex}"]`).forEach((n) => n.classList.add('focused'));
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function gutterActionsFor(kind) {
    return {
      showTakeLocal: kind === 'conflict-unresolved' || kind === 'diff-local-only' || kind === 'diff-both-resolved',
      showTakeServer: kind === 'conflict-unresolved' || kind === 'diff-server-only' || kind === 'diff-both-resolved',
    };
  }

  function buildGutterBand(side, group, groupIndex, blockClass) {
    const band = el('div', { className: blockClass }, []);
    band.style.height = (group.height * ROW_H) + 'px';
    band.dataset.groupIndex = String(groupIndex);
    if (group.kind === 'equal') return band;

    const actions = gutterActionsFor(group.kind);
    if (side === 'left' && actions.showTakeLocal) {
      const btn = el('div', {
        className: 'gutter-action action-take',
        title: 'Lấy Local vào Result',
        onClick: () => takeSide(groupIndex, 'local'),
      }, ['»']);
      band.appendChild(btn);
    }
    if (side === 'right' && actions.showTakeServer) {
      const btn = el('div', {
        className: 'gutter-action action-take',
        title: 'Lấy Server vào Result',
        onClick: () => takeSide(groupIndex, 'server'),
      }, ['«']);
      band.appendChild(btn);
    }
    return band;
  }

  // ---------- editing / state sync ----------

  function currentResultValue(entry) {
    return entry.el ? entry.el.value : entry.staticText;
  }

  function recombineResultText() {
    return resultTextareas.map(currentResultValue).join(EOL);
  }

  function computeGlobalOffset(activeTextarea) {
    let offset = 0;
    for (const entry of resultTextareas) {
      if (entry.el === activeTextarea) {
        return offset + activeTextarea.selectionStart;
      }
      offset += currentResultValue(entry).length + EOL.length;
    }
    return offset;
  }

  function restoreCursorIfPending() {
    if (pendingCursor === null) return;
    const target = pendingCursor;
    pendingCursor = null;
    let offset = 0;
    for (const entry of resultTextareas) {
      const len = currentResultValue(entry).length;
      if (entry.el && target <= offset + len) {
        entry.el.focus();
        const pos = Math.max(0, Math.min(len, target - offset));
        entry.el.setSelectionRange(pos, pos);
        return;
      }
      offset += len + EOL.length;
    }
  }

  function onResultInput(ta) {
    autoGrow(ta);
    dirty = true;
    pendingCursor = computeGlobalOffset(ta);
    clearTimeout(editDebounce);
    editDebounce = setTimeout(() => {
      resultText = recombineResultText();
      recomputeAndSend();
    }, 250);
  }

  function recomputeAndSend() {
    clearTimeout(editDebounce);
    layout = window.MergeStudioLayout.buildLayout(localText, resultText, serverText);
    if (focusedGroupIndex >= layout.groups.length) {
      focusedGroupIndex = -1;
    }
    render();
    post({ type: 'directEdit', text: resultText, remainingConflicts: layout.conflictCount });
  }

  function takeSide(groupIndex, side) {
    const group = layout.groups[groupIndex];
    const entry = resultTextareas[groupIndex];
    if (!group || !entry) return;
    const lines = side === 'local' ? group.local.lines : group.server.lines;
    const text = lines.join(EOL);
    if (entry.el) {
      entry.el.value = text;
    } else {
      entry.staticText = text;
    }
    dirty = true;
    resultText = recombineResultText();
    recomputeAndSend();
  }

  function acceptAll(side) {
    layout.groups.forEach((g, i) => {
      if (g.kind === 'equal') return;
      const entry = resultTextareas[i];
      if (!entry) return;
      const lines = side === 'local' ? g.local.lines : g.server.lines;
      const text = lines.join(EOL);
      if (entry.el) {
        entry.el.value = text;
      } else {
        entry.staticText = text;
      }
    });
    dirty = true;
    resultText = recombineResultText();
    recomputeAndSend();
  }

  function go(delta) {
    const changeIndices = getChangeIndices();
    if (changeIndices.length === 0) return;
    const pos = changeIndices.indexOf(focusedGroupIndex);
    const nextPos = pos === -1
      ? (delta > 0 ? 0 : changeIndices.length - 1)
      : ((pos + delta) % changeIndices.length + changeIndices.length) % changeIndices.length;
    focusedGroupIndex = changeIndices[nextPos];
    render();
    const target = document.querySelector(`[data-group-index="${focusedGroupIndex}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ---------- host <-> webview messages ----------

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
      fileName = msg.fileName;
      localText = msg.localText;
      serverText = msg.serverText;
      resultText = msg.resultText;
      localLabel = msg.localLabel || 'HEAD';
      incomingLabel = msg.incomingLabel || 'incoming';
      EOL = (localText.includes('\r\n') || serverText.includes('\r\n') || resultText.includes('\r\n')) ? '\r\n' : '\n';
      focusedGroupIndex = -1;
      expandedGroups.clear();
      dirty = false;
      layout = window.MergeStudioLayout.buildLayout(localText, resultText, serverText);
      render();
    } else if (msg.type === 'navigate') {
      go(msg.direction === 'next' ? 1 : -1);
    }
  });

  post({ type: 'ready' });
})();
