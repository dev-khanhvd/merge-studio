(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{blocks: any[], total: number, fileName: string}} */
  let state = { blocks: [], total: 0, fileName: '' };
  let resolvedIndexes = new Set();
  let resultText = '';
  let manualEditIndex = null;
  let currentNavIndex = -1;
  let resultCollapsed = true;

  const app = document.getElementById('app');

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') {
          node.className = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== undefined && value !== null) {
          node.setAttribute(key, value);
        }
      }
    }
    for (const child of children || []) {
      if (child === undefined || child === null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function pre(text, className) {
    const p = el('pre', className ? { className } : null, []);
    p.textContent = text ?? '';
    return p;
  }

  function render() {
    app.innerHTML = '';
    app.appendChild(renderToolbar());

    const content = el('div', { className: 'content', id: 'content' }, []);
    if (state.blocks.length === 0) {
      content.appendChild(el('div', { className: 'empty-state' }, ['Đang tải…']));
    } else {
      for (const block of state.blocks) {
        if (block.type === 'context') {
          content.appendChild(renderContextBlock(block.text));
        } else {
          content.appendChild(renderConflictCard(block.conflict));
        }
      }
    }
    app.appendChild(content);
    app.appendChild(renderResultPanel());
  }

  function renderToolbar() {
    const resolvedCount = resolvedIndexes.size;
    const total = state.total;
    return el('div', { className: 'toolbar' }, [
      el('span', { className: 'file-name' }, [`\u{1F500} ${state.fileName || ''}`]),
      el('span', { className: 'progress' }, [`${resolvedCount}/${total} resolved`]),
      el('span', { className: 'spacer' }, []),
      el('button', { onClick: () => go(-1) }, ['↑ Prev']),
      el('button', { onClick: () => go(1) }, ['Next ↓']),
      el('button', { onClick: () => acceptAll('local') }, ['Accept All Current']),
      el('button', { onClick: () => acceptAll('incoming') }, ['Accept All Incoming']),
      el('button', { className: 'primary', onClick: () => post({ type: 'save' }) }, ['Save']),
      el(
        'button',
        { className: 'primary', onClick: () => post({ type: 'saveAndMarkResolved' }) },
        ['Save && Mark Resolved'],
      ),
    ]);
  }

  function renderContextBlock(text) {
    const lines = text.split(/\r\n|\n/);
    if (lines.length > 8) {
      const head = lines.slice(0, 3).join('\n');
      const tail = lines.slice(-3).join('\n');
      const wrap = el('div', null, []);
      wrap.appendChild(pre(head, 'context'));
      const collapsedNote = el('div', { className: 'context-collapsed' }, [`⋮ ${lines.length - 6} dòng không đổi ⋮`]);
      wrap.appendChild(collapsedNote);
      wrap.appendChild(pre(tail, 'context'));
      let expanded = false;
      collapsedNote.addEventListener('click', () => {
        if (expanded) return;
        expanded = true;
        const full = pre(text, 'context');
        wrap.replaceChildren(full);
      });
      return wrap;
    }
    return pre(text, 'context');
  }

  function renderConflictCard(conflict) {
    const isResolved = resolvedIndexes.has(conflict.index);
    const card = el('div', {
      className: `conflict-card${isResolved ? ' resolved' : ''}`,
      id: `conflict-${conflict.index}`,
    }, []);

    card.appendChild(
      el('div', { className: 'conflict-header' }, [
        el('span', { className: 'badge' }, [`Conflict #${conflict.index + 1} / ${state.total}`]),
        el('span', { className: 'status' }, [isResolved ? 'Resolved' : 'Unresolved']),
      ]),
    );

    const actions = el('div', { className: 'conflict-actions' }, [
      el('button', { onClick: () => resolve(conflict.index, 'local') }, ['Accept Current']),
      conflict.base !== undefined
        ? el('button', { onClick: () => resolve(conflict.index, 'base') }, ['Accept Base'])
        : null,
      el('button', { onClick: () => resolve(conflict.index, 'incoming') }, ['Accept Incoming']),
      el('button', { onClick: () => resolve(conflict.index, 'both') }, ['Accept Both']),
      el('button', { onClick: () => toggleManualEdit(conflict.index) }, ['Edit Manually']),
      isResolved
        ? el('button', { onClick: () => unresolve(conflict.index) }, ['Revert'])
        : null,
    ]);
    card.appendChild(actions);

    if (manualEditIndex === conflict.index) {
      card.appendChild(renderManualEdit(conflict));
    } else {
      const columns = el('div', {
        className: `conflict-columns${conflict.base !== undefined ? ' with-base' : ''}`,
      }, []);
      columns.appendChild(renderColumn('local', 'Current (Local)', conflict.localLabel, conflict.local));
      if (conflict.base !== undefined) {
        columns.appendChild(renderColumn('base', 'Base (Ancestor)', conflict.baseLabel, conflict.base));
      }
      columns.appendChild(renderColumn('incoming', 'Incoming (Remote)', conflict.incomingLabel, conflict.incoming));
      card.appendChild(columns);

      if (isResolved) {
        const resolvedText = getResolvedTextFor(conflict.index);
        card.appendChild(
          el('div', { className: 'resolved-preview' }, [
            el('div', { className: 'col-label' }, ['Kết quả đã chọn']),
            pre(resolvedText, undefined),
          ]),
        );
      }
    }

    return card;
  }

  function renderColumn(kind, title, label, text) {
    const isEmpty = !text;
    return el('div', { className: `conflict-column ${kind}${isEmpty ? ' empty' : ''}` }, [
      el('div', { className: 'col-label' }, [`${title}${label ? ` — ${label}` : ''}`]),
      pre(isEmpty ? '(trống)' : text, undefined),
    ]);
  }

  function renderManualEdit(conflict) {
    const initial = resolvedIndexes.has(conflict.index)
      ? getResolvedTextFor(conflict.index)
      : [conflict.local, conflict.incoming].filter(Boolean).join('\n');
    const wrap = el('div', { className: 'manual-edit' }, []);
    const textarea = document.createElement('textarea');
    textarea.value = initial;
    wrap.appendChild(textarea);
    wrap.appendChild(
      el('div', { className: 'manual-edit-actions' }, [
        el('button', {
          className: 'primary',
          onClick: () => {
            resolve(conflict.index, 'custom', textarea.value);
            manualEditIndex = null;
          },
        }, ['Apply']),
        el('button', { onClick: () => { manualEditIndex = null; render(); } }, ['Cancel']),
      ]),
    );
    return wrap;
  }

  // Client-side cache of the text each conflict was resolved to, so the
  // "resolved preview" / manual-edit box can render without waiting on a
  // round trip. The extension host recomputes the authoritative text on save.
  const resolvedTextByIndex = new Map();

  function getResolvedTextFor(index) {
    return resolvedTextByIndex.get(index) ?? '';
  }

  function findConflict(index) {
    for (const block of state.blocks) {
      if (block.type === 'conflict' && block.conflict.index === index) {
        return block.conflict;
      }
    }
    return null;
  }

  function computeChoiceText(conflict, choice, customText) {
    switch (choice) {
      case 'local':
        return conflict.local;
      case 'base':
        return conflict.base ?? '';
      case 'incoming':
        return conflict.incoming;
      case 'both':
        return [conflict.local, conflict.incoming].filter(Boolean).join('\n');
      case 'custom':
        return customText ?? '';
      default:
        return '';
    }
  }

  function renderResultPanel() {
    const panel = el('div', { className: `result-panel${resultCollapsed ? ' collapsed' : ''}` }, []);
    const header = el('div', { className: 'result-panel-header' }, [
      el('span', { className: 'chev' }, ['▼']),
      el('span', null, ['Final Result Preview (có thể sửa trực tiếp)']),
    ]);
    header.addEventListener('click', () => {
      resultCollapsed = !resultCollapsed;
      render();
      focusResultTextareaIfOpen();
    });
    panel.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.id = 'result-textarea';
    textarea.value = resultText;
    textarea.spellcheck = false;
    let debounceTimer;
    textarea.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const value = textarea.value;
      debounceTimer = setTimeout(() => post({ type: 'directEdit', text: value }), 250);
    });
    panel.appendChild(textarea);
    return panel;
  }

  function focusResultTextareaIfOpen() {
    if (!resultCollapsed) {
      const ta = document.getElementById('result-textarea');
      if (ta) ta.focus();
    }
  }

  function resolve(index, choice, text) {
    const conflict = findConflict(index);
    if (conflict) {
      resolvedTextByIndex.set(index, computeChoiceText(conflict, choice, text));
    }
    post({ type: 'resolve', index, choice, text });
  }

  function acceptAll(choice) {
    for (const block of state.blocks) {
      if (block.type === 'conflict') {
        resolvedTextByIndex.set(block.conflict.index, computeChoiceText(block.conflict, choice));
      }
    }
    post({ type: choice === 'local' ? 'acceptAllLocal' : 'acceptAllIncoming' });
  }

  function unresolve(index) {
    resolvedTextByIndex.delete(index);
    post({ type: 'unresolve', index });
  }

  function toggleManualEdit(index) {
    manualEditIndex = manualEditIndex === index ? null : index;
    render();
  }

  function go(delta) {
    const conflicts = state.blocks.filter((b) => b.type === 'conflict').map((b) => b.conflict);
    if (conflicts.length === 0) return;
    currentNavIndex = ((currentNavIndex + delta) % conflicts.length + conflicts.length) % conflicts.length;
    const target = document.getElementById(`conflict-${conflicts[currentNavIndex].index}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.style.outline = '2px solid var(--vscode-focusBorder)';
      setTimeout(() => { target.style.outline = ''; }, 900);
    }
  }

  function post(message) {
    vscode.postMessage(message);
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
      state = { blocks: msg.blocks, total: msg.total, fileName: msg.fileName };
      manualEditIndex = null;
      currentNavIndex = -1;
      resolvedTextByIndex.clear();
      render();
    } else if (msg.type === 'update') {
      resolvedIndexes = new Set(msg.resolvedIndexes);
      resultText = msg.resultText;
      state.total = msg.total;
      for (const index of Array.from(resolvedTextByIndex.keys())) {
        if (!resolvedIndexes.has(index)) {
          resolvedTextByIndex.delete(index);
        }
      }
      const activeElement = document.activeElement;
      const resultFocused = activeElement && activeElement.id === 'result-textarea';
      render();
      if (resultFocused) {
        focusResultTextareaIfOpen();
      }
    } else if (msg.type === 'navigate') {
      go(msg.direction === 'next' ? 1 : -1);
    }
  });

  post({ type: 'ready' });
})();
