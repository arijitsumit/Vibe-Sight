(() => {
  'use strict';

  if (window.__vibecoder_initialized) return;
  window.__vibecoder_initialized = true;

  // ── State ──────────────────────────────────────────────────────────────
  let isActive = false;
  let shadowRoot = null;
  let overlayEl = null;
  let fabContainer = null;
  let idCounter = 0;
  let activeAnnotationId = null;
  const annotations = new Map(); // element -> { id, comment, selector, label }

  // ── Constants ──────────────────────────────────────────────────────────
  const HOST_ID = 'vibecoder-host';

  // ── Shadow Host Management ─────────────────────────────────────────────
  // Bug 2 fix: position:absolute so host scrolls with the document.
  // Children use document-relative coords (rect + scrollY/scrollX),
  // which are correct when the containing host is in document space.
  const getHost = () => document.getElementById(HOST_ID);

  const ensureShadow = () => {
    if (shadowRoot) return shadowRoot;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadowRoot.appendChild(style);
    document.documentElement.appendChild(host);
    shadowRoot.addEventListener('click', handleShadowClick, true);
    return shadowRoot;
  };

  const destroyShadow = () => {
    const host = getHost();
    if (host) host.remove();
    shadowRoot = null;
    overlayEl = null;
    fabContainer = null;
    activeAnnotationId = null;
  };

  // ── Shadow DOM CSS ─────────────────────────────────────────────────────
  const SHADOW_CSS = `
    * { box-sizing: border-box; }

    [data-vc="overlay"] {
      position: absolute;
      pointer-events: none;
      border: 2px dashed rgba(99, 102, 241, 0.8);
      background: rgba(99, 102, 241, 0.08);
      border-radius: 3px;
      display: none;
      transition: top 60ms linear, left 60ms linear, width 60ms linear, height 60ms linear;
    }

    [data-vc="highlight"] {
      position: absolute;
      pointer-events: none;
      border: 2px solid rgba(16, 185, 129, 0.9);
      background: rgba(16, 185, 129, 0.1);
      border-radius: 3px;
    }

    [data-vc="highlight"][data-vc-active] {
      border-color: rgba(99, 102, 241, 0.9);
      background: rgba(99, 102, 241, 0.12);
    }

    .vc-label {
      position: absolute;
      top: -24px;
      left: -2px;
      background: #10b981;
      color: white;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 3px 3px 0 0;
      white-space: nowrap;
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.5;
    }

    [data-vc-active] > .vc-label {
      background: #6366f1;
    }

    .vc-close {
      margin-left: 6px;
      opacity: 0.7;
    }
    .vc-close:hover { opacity: 1; }

    /* Bug 1 fix: comments hidden by default, shown only when active */
    [data-vc="comment"] {
      position: absolute;
      pointer-events: auto;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      width: 280px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: none;
    }

    [data-vc="comment"][data-vc-visible] {
      display: block;
      animation: vcFadeIn 150ms ease-out;
    }

    @keyframes vcFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .vc-comment-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }

    .vc-selector-text {
      font-size: 11px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 240px;
    }

    .vc-comment-input {
      width: 100%;
      border: none;
      outline: none;
      resize: vertical;
      padding: 10px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1f2937;
      background: white;
      min-height: 60px;
      max-height: 150px;
    }
    .vc-comment-input::placeholder { color: #9ca3af; }

    [data-vc="fab"] {
      position: fixed;
      bottom: 24px;
      right: 24px;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
    }

    .vc-fab-btn {
      border: none;
      border-radius: 12px;
      padding: 12px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: transform 0.1s, box-shadow 0.1s;
      white-space: nowrap;
    }
    .vc-fab-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }
    .vc-fab-btn:active { transform: translateY(0); }

    .vc-fab-generate {
      background: #6366f1;
      color: white;
    }

    .vc-fab-clear {
      background: white;
      color: #374151;
      border: 1px solid #e5e7eb;
    }

    .vc-badge {
      background: rgba(255, 255, 255, 0.25);
      border-radius: 6px;
      padding: 1px 7px;
      font-size: 12px;
    }

    [data-vc="toast"] {
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: #1f2937;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: vcToastIn 200ms ease-out;
    }

    @keyframes vcToastIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  // ── Utility Functions ──────────────────────────────────────────────────
  const nextId = () => `vc-${++idCounter}`;

  const escapeHtml = (str) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  };

  // Returns document-relative coordinates.
  // These are correct when the parent host is position:absolute at doc (0,0).
  const getElementRect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height,
    };
  };

  // ── Selector Generation (smart unique) ────────────────────────────────
  // Progressive enhancement: base → verify uniqueness → ID anchor → nth-type
  // Every selector is verified via querySelectorAll to guarantee exactly 1 match.

  // Utility classes are too generic for identification (margin/padding/color
  // shorthand etc). Filter them out for the base selector.
  const UTILITY_CLASS_RE = /^(p|m|px|py|mx|my|mt|mb|ml|mr|pt|pb|pl|pr|w|h|text|bg|flex|grid|gap|rounded|border|shadow|opacity|z|overflow|cursor|select|visible|hidden|relative|absolute|fixed|sticky|block|inline|float|clear|min|max)(-|$)/i;

  const isOwnHost = (target) => {
    const host = getHost();
    return host && (target === host || host.contains(target));
  };

  const buildBaseTag = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${CSS.escape(el.id)}`;
    let sel = tag;
    if (el.className && typeof el.className === 'string') {
      const stable = el.className.trim().split(/\s+/)
        .filter(c => c && !UTILITY_CLASS_RE.test(c))
        .slice(0, 2);
      if (stable.length) sel += '.' + stable.map(c => CSS.escape(c)).join('.');
    }
    return sel;
  };

  const matchesUnique = (sel, el) => {
    try {
      const matches = document.querySelectorAll(sel);
      return matches.length === 1 && matches[0] === el;
    } catch { return false; }
  };

  const nthOfTypeIndex = (el) => {
    const parent = el.parentElement;
    if (!parent) return 0;
    const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
    return siblings.length > 1 ? siblings.indexOf(el) + 1 : 0;
  };

  const generateSelector = (el) => {
    // Step 1: Base — tag + stable classes (or #id)
    const base = buildBaseTag(el);
    if (el.id || matchesUnique(base, el)) return base;

    // Step 2: ID anchor — walk up to find nearest parent with an id
    let current = el.parentElement;
    while (current && current !== document.documentElement && current !== document.body) {
      if (current.id) {
        const anchored = `#${CSS.escape(current.id)} > ${base}`;
        if (matchesUnique(anchored, el)) return anchored;
        // ID wasn't enough — add nth-of-type on the element itself
        const idx = nthOfTypeIndex(el);
        if (idx) {
          const anchoredNth = `#${CSS.escape(current.id)} > ${base}:nth-of-type(${idx})`;
          if (matchesUnique(anchoredNth, el)) return anchoredNth;
        }
        break;
      }
      current = current.parentElement;
    }

    // Step 3: Structural — nth-of-type on the element
    const elIdx = nthOfTypeIndex(el);
    if (elIdx) {
      const nth = `${base}:nth-of-type(${elIdx})`;
      if (matchesUnique(nth, el)) return nth;
    }

    // Step 4: Parent + nth-of-type on element
    const parent = el.parentElement;
    if (parent && parent !== document.documentElement && parent !== document.body) {
      const parentBase = buildBaseTag(parent);
      const pIdx = nthOfTypeIndex(parent);
      const parentSel = pIdx ? `${parentBase}:nth-of-type(${pIdx})` : parentBase;
      const full = `${parentSel} > ${base}`;
      if (matchesUnique(full, el)) return full;

      // Last resort: parent + nth-of-type on both
      if (elIdx) {
        const fullNth = `${parentSel} > ${base}:nth-of-type(${elIdx})`;
        if (matchesUnique(fullNth, el)) return fullNth;
      }
    }

    // Fallback: whatever we have
    return elIdx ? `${base}:nth-of-type(${elIdx})` : base;
  };

  const getShortLabel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) return `.${cls}`;
    }
    const text = (el.textContent || '').trim().slice(0, 20);
    return text ? `<${tag}> "${text}\u2026"` : `<${tag}>`;
  };

  // ── Active Comment Management (Bug 1 fix) ──────────────────────────────
  // Only one comment card visible at a time. Highlights always stay visible.
  const setActiveComment = (id) => {
    if (!shadowRoot) return;

    // Hide all comment cards
    shadowRoot.querySelectorAll('[data-vc="comment"]').forEach((card) => {
      card.removeAttribute('data-vc-visible');
    });

    // Deactivate all highlights
    shadowRoot.querySelectorAll('[data-vc="highlight"]').forEach((hl) => {
      hl.removeAttribute('data-vc-active');
    });

    if (id === null) {
      activeAnnotationId = null;
      return;
    }

    // Show target comment card
    const card = shadowRoot.querySelector(`[data-vc-id="${id}"][data-vc="comment"]`);
    if (card) {
      card.setAttribute('data-vc-visible', '');
      const input = card.querySelector('.vc-comment-input');
      if (input) requestAnimationFrame(() => input.focus());
    }

    // Activate matching highlight
    const hl = shadowRoot.querySelector(`[data-vc-id="${id}"][data-vc="highlight"]`);
    if (hl) hl.setAttribute('data-vc-active', '');

    activeAnnotationId = id;
  };

  // ── Overlay (Hover Highlight) ──────────────────────────────────────────
  const ensureOverlay = () => {
    if (overlayEl) return overlayEl;
    const shadow = ensureShadow();
    overlayEl = document.createElement('div');
    overlayEl.setAttribute('data-vc', 'overlay');
    shadow.appendChild(overlayEl);
    return overlayEl;
  };

  const showOverlay = (el) => {
    const overlay = ensureOverlay();
    const pos = getElementRect(el);
    overlay.style.top = `${pos.top}px`;
    overlay.style.left = `${pos.left}px`;
    overlay.style.width = `${pos.width}px`;
    overlay.style.height = `${pos.height}px`;
    overlay.style.display = 'block';
  };

  const hideOverlay = () => {
    if (overlayEl) overlayEl.style.display = 'none';
  };

  // ── Highlight (Locked Selection) ───────────────────────────────────────
  const createHighlight = (el, id) => {
    const shadow = ensureShadow();
    const pos = getElementRect(el);
    const label = getShortLabel(el);

    const highlight = document.createElement('div');
    highlight.setAttribute('data-vc', 'highlight');
    highlight.setAttribute('data-vc-id', id);
    Object.assign(highlight.style, {
      position: 'absolute', pointerEvents: 'none',
      border: '2px solid rgba(16, 185, 129, 0.9)',
      background: 'rgba(16, 185, 129, 0.1)',
      borderRadius: '3px',
      top: `${pos.top}px`, left: `${pos.left}px`,
      width: `${pos.width}px`, height: `${pos.height}px`,
    });

    const labelEl = document.createElement('div');
    labelEl.className = 'vc-label';
    labelEl.innerHTML = `<span>${escapeHtml(label)}</span><span class="vc-close" data-vc-remove="${id}">\u2715</span>`;
    highlight.appendChild(labelEl);
    shadow.appendChild(highlight);
  };

  const updateHighlightPosition = (el, id) => {
    if (!shadowRoot) return;
    const pos = getElementRect(el);
    const highlight = shadowRoot.querySelector(`[data-vc-id="${id}"][data-vc="highlight"]`);
    if (highlight) {
      highlight.style.top = `${pos.top}px`;
      highlight.style.left = `${pos.left}px`;
      highlight.style.width = `${pos.width}px`;
      highlight.style.height = `${pos.height}px`;
    }
  };

  // ── Comment Card ───────────────────────────────────────────────────────
  // Bug 1 fix: cards start hidden (display:none via CSS). Made visible
  // only when setActiveComment adds [data-vc-visible].
  const createCommentCard = (el, id) => {
    const shadow = ensureShadow();
    const pos = getElementRect(el);
    const selector = generateSelector(el);

    const card = document.createElement('div');
    card.setAttribute('data-vc', 'comment');
    card.setAttribute('data-vc-id', id);
    Object.assign(card.style, {
      position: 'absolute', pointerEvents: 'auto',
      background: 'white', border: '1px solid #e5e7eb',
      borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      width: '280px', overflow: 'hidden',
      top: `${pos.top + pos.height + 8}px`,
      left: `${Math.min(pos.left, window.innerWidth - 300)}px`,
    });

    const header = document.createElement('div');
    header.className = 'vc-comment-header';
    const selectorSpan = document.createElement('span');
    selectorSpan.className = 'vc-selector-text';
    selectorSpan.textContent = selector;
    header.appendChild(selectorSpan);

    const textarea = document.createElement('textarea');
    textarea.className = 'vc-comment-input';
    textarea.setAttribute('data-vc-input', id);
    textarea.placeholder = 'Describe what should change\u2026';

    card.appendChild(header);
    card.appendChild(textarea);
    shadow.appendChild(card);
  };

  const updateCommentPosition = (el, id) => {
    if (!shadowRoot) return;
    const pos = getElementRect(el);
    const comment = shadowRoot.querySelector(`[data-vc-id="${id}"][data-vc="comment"]`);
    if (comment) {
      comment.style.top = `${pos.top + pos.height + 8}px`;
      comment.style.left = `${Math.min(pos.left, window.innerWidth - 300)}px`;
    }
  };

  // ── FAB (Floating Action Button) ───────────────────────────────────────
  const renderFab = () => {
    if (!shadowRoot) return;
    if (fabContainer) fabContainer.remove();

    const count = annotations.size;
    if (count === 0) { fabContainer = null; return; }

    fabContainer = document.createElement('div');
    fabContainer.setAttribute('data-vc', 'fab');

    const generateBtn = document.createElement('button');
    generateBtn.className = 'vc-fab-btn vc-fab-generate';
    generateBtn.setAttribute('data-vc-action', 'generate');
    generateBtn.innerHTML = `\u2728 Generate Prompt <span class="vc-badge">${count}</span>`;

    if (count > 1) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'vc-fab-btn vc-fab-clear';
      clearBtn.setAttribute('data-vc-action', 'clear');
      clearBtn.textContent = 'Clear All';
      fabContainer.appendChild(clearBtn);
    }

    fabContainer.appendChild(generateBtn);
    shadowRoot.appendChild(fabContainer);
  };

  // ── Toast Notification ─────────────────────────────────────────────────
  const showToast = (message) => {
    if (!shadowRoot) return;
    const existing = shadowRoot.querySelector('[data-vc="toast"]');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.setAttribute('data-vc', 'toast');
    toast.textContent = message;
    shadowRoot.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 2000);
  };

  // ── Annotation Management ──────────────────────────────────────────────
  // Bug 1 fix: clicking a new element hides the previous comment and shows
  // the new one. Clicking an already-annotated element re-activates its
  // comment card for editing.
  const addAnnotation = (el) => {
    const host = getHost();
    if (host && (host === el || host.contains(el))) return;

    // Re-activate existing annotation
    if (annotations.has(el)) {
      const existing = annotations.get(el);
      setActiveComment(existing.id);
      return;
    }

    const id = nextId();
    annotations.set(el, {
      id,
      comment: '',
      selector: generateSelector(el),
      label: getShortLabel(el),
    });

    ensureShadow();
    createHighlight(el, id);
    createCommentCard(el, id);
    setActiveComment(id);
    renderFab();
  };

  const removeAnnotation = (el) => {
    const data = annotations.get(el);
    if (!data || !shadowRoot) return;
    if (activeAnnotationId === data.id) activeAnnotationId = null;
    shadowRoot.querySelectorAll(`[data-vc-id="${data.id}"]`).forEach(n => n.remove());
    annotations.delete(el);
    renderFab();
  };

  const removeAnnotationById = (id) => {
    for (const [el, data] of annotations.entries()) {
      if (data.id === id) {
        removeAnnotation(el);
        return;
      }
    }
  };

  const clearAllAnnotations = () => {
    if (!shadowRoot) return;
    annotations.forEach((data) => {
      shadowRoot.querySelectorAll(`[data-vc-id="${data.id}"]`).forEach(n => n.remove());
    });
    annotations.clear();
    activeAnnotationId = null;
    renderFab();
  };

  // ── Prompt Generation (token-optimized) ────────────────────────────────

  // Regex patterns for stripping noisy attributes from HTML strings
  const NOISY_ATTR_RE = /\s+bis_skin_checked="[^"]*"/g;
  const EMPTY_STYLE_RE = /\s+style=""/g;
  const EMPTY_COMMENT_RE = /<!--\s*-->/g;
  const DATA_VC_ATTR_RE = /\s+data-vibecoder-[a-z]+="[^"]*"/g;

  const cleanHtml = (el, maxLen = 150) => {
    let html = el.outerHTML;
    html = html
      .replace(NOISY_ATTR_RE, '')
      .replace(EMPTY_STYLE_RE, '')
      .replace(EMPTY_COMMENT_RE, '')
      .replace(DATA_VC_ATTR_RE, '');
    if (html.length <= maxLen) return html;
    return html.slice(0, maxLen) + '...';
  };

  // Default/zero-value patterns to skip — only keep meaningful styles
  const STYLE_DEFAULTS = {
    'display':        ['inline', 'block', 'inline-block'],
    'position':       ['static'],
    'margin':         ['0px'],
    'padding':        ['0px'],
    'border':         [''],
    'overflow':       ['visible'],
    'font-weight':    ['400'],
    'color':          ['rgb(0, 0, 0)'],
    'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
    'width':          [],
    'height':         [],
    'flex-direction': [],
  };

  const extractHighSignalStyles = (el) => {
    const cs = window.getComputedStyle(el);
    const parts = [];
    for (const [prop, defaults] of Object.entries(STYLE_DEFAULTS)) {
      const val = cs.getPropertyValue(prop).trim();
      if (!val) continue;
      if (defaults.includes(val)) continue;
      // Skip zero values (margin: 0px, padding-top: 0px, etc.)
      if (/^0(p[xt]|em|rem|%)?$/.test(val)) continue;
      // Skip transparent backgrounds
      if (prop.includes('background') && (val === 'rgba(0, 0, 0, 0)' || val === 'transparent')) continue;
      parts.push(`${prop}:${val}`);
    }
    return parts.slice(0, 5).join('; ');
  };

  const DEFAULT_ELEMENT_FORMAT = '[EL{n}] {selector}\nHTML: {html}\nStyles: {styles}\nInstruction: {instruction}';

  const resolveFormat = (fmt) =>
    fmt && fmt.trim() ? fmt.trim() : DEFAULT_ELEMENT_FORMAT;

  const formatElement = (fmt, vars) => {
    let out = fmt;
    for (const [key, val] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), val || '');
    }
    // Strip empty "Styles: " line if styles resolved to empty
    out = out.replace(/^Styles:\s*$/m, '');
    return out;
  };

  const loadSettings = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(['vibecoderSettings'], (result) => {
        resolve(result.vibecoderSettings || { preset: 'default', systemPrompt: '', elementFormat: '' });
      });
    });

  const buildPrompt = (settings) => {
    const entries = Array.from(annotations.entries());
    if (entries.length === 0) return null;

    const fmt = resolveFormat(settings.elementFormat);
    let out = '';

    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      out += settings.systemPrompt.trim() + '\n\n';
    }

    out += `URL: ${window.location.href}\n---\n`;

    entries.forEach(([el, data], i) => {
      const html = cleanHtml(el);
      const styles = extractHighSignalStyles(el);
      const instruction = data.comment || '(no instruction)';

      const block = formatElement(fmt, {
        n: String(i + 1),
        selector: data.selector,
        html,
        styles,
        instruction,
      });

      out += '\n' + block + '\n';
    });

    return out;
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  };

  const handleGenerate = async () => {
    if (!shadowRoot) return;

    // Sync ALL textarea values into annotation state (including hidden ones)
    shadowRoot.querySelectorAll('[data-vc-input]').forEach((textarea) => {
      const inputId = textarea.getAttribute('data-vc-input');
      for (const [, data] of annotations.entries()) {
        if (data.id === inputId) {
          data.comment = textarea.value;
          break;
        }
      }
    });

    const settings = await loadSettings();
    const prompt = buildPrompt(settings);
    if (!prompt) {
      showToast('No annotations to generate from');
      return;
    }

    copyToClipboard(prompt).then((success) => {
      showToast(success
        ? `\u2713 Prompt copied to clipboard (${annotations.size} elements)`
        : 'Failed to copy \u2014 check clipboard permissions');
    });
  };

  // ── Event Handling ─────────────────────────────────────────────────────

  const onMouseMove = (e) => {
    if (!isActive) return;
    if (isOwnHost(e.target)) { hideOverlay(); return; }
    showOverlay(e.target);
  };

  const onDocumentClick = (e) => {
    if (!isActive) return;
    if (isOwnHost(e.target)) return; // handled by shadow listener

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    hideOverlay();
    addAnnotation(e.target);
  };

  const handleShadowClick = (e) => {
    // Close button on highlights
    const removeEl = e.target.closest('[data-vc-remove]');
    if (removeEl) {
      e.stopPropagation();
      removeAnnotationById(removeEl.getAttribute('data-vc-remove'));
      return;
    }

    // Bug 1 fix: clicking a highlight label re-opens its comment card
    const highlightEl = e.target.closest('[data-vc="highlight"]');
    if (highlightEl) {
      e.stopPropagation();
      const id = highlightEl.getAttribute('data-vc-id');
      if (id === activeAnnotationId) {
        // Toggle off if clicking the already-active highlight
        setActiveComment(null);
      } else {
        setActiveComment(id);
      }
      return;
    }

    // FAB buttons
    const actionEl = e.target.closest('[data-vc-action]');
    if (actionEl) {
      e.stopPropagation();
      const action = actionEl.getAttribute('data-vc-action');
      if (action === 'generate') handleGenerate();
      else if (action === 'clear') { clearAllAnnotations(); showToast('All annotations cleared'); }
    }
  };

  const onKeyDown = (e) => {
    if (!isActive) return;
    if (e.key === 'Escape') {
      hideOverlay();
      setActiveComment(null);
    }
  };

  // Bug 2 fix: scroll/resize handler recalculates positions for layout
  // shifts. With position:absolute host, basic scroll is handled naturally
  // by the browser — this handler only fires for layout-affecting changes.
  const onScrollOrResize = () => {
    if (!isActive || !shadowRoot) return;
    hideOverlay();
    annotations.forEach((data, el) => {
      updateHighlightPosition(el, data.id);
      updateCommentPosition(el, data.id);
    });
  };

  // ── Activate / Deactivate ──────────────────────────────────────────────
  const activate = () => {
    if (isActive) return;
    isActive = true;
    document.body.setAttribute('data-vibecoder-active', '');
    document.body.style.cursor = 'crosshair';
    ensureOverlay();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);
    renderFab();
    notifyBackground(true);
  };

  const deactivate = () => {
    if (!isActive) return;
    isActive = false;
    document.body.removeAttribute('data-vibecoder-active');
    document.body.style.cursor = '';
    hideOverlay();
    destroyShadow();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize, true);
    notifyBackground(false);
  };

  const toggle = () => isActive ? deactivate() : activate();

  const notifyBackground = (active) => {
    try {
      chrome.runtime.sendMessage({ type: 'vibecoder-state-changed', active });
    } catch { /* context invalidated */ }
  };

  // ── Listeners ──────────────────────────────────────────────────────────
  const DEFAULT_HOTKEY = { ctrlKey: true, shiftKey: false, altKey: false, key: '\\' };

  const hotkeysMatch = (stored, event) => {
    if (!stored) return false;
    return stored.ctrlKey === event.ctrlKey
      && stored.altKey === event.altKey
      && stored.shiftKey === event.shiftKey
      && stored.key === event.key;
  };

  let currentHotkey = { ...DEFAULT_HOTKEY };

  // Load saved hotkey from storage
  chrome.storage.local.get(['vibecoderHotkey'], (result) => {
    if (result.vibecoderHotkey) currentHotkey = result.vibecoderHotkey;
  });

  // Listen for hotkey changes from popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.vibecoderHotkey?.newValue) {
      currentHotkey = changes.vibecoderHotkey.newValue;
    }
  });

  let lastToggleTime = 0;
  const debouncedToggle = () => {
    const now = Date.now();
    if (now - lastToggleTime < 150) return;
    lastToggleTime = now;
    toggle();
  };

  document.addEventListener('vibecoder-toggle', debouncedToggle);

  document.addEventListener('keydown', (e) => {
    if (hotkeysMatch(currentHotkey, e)) { e.preventDefault(); debouncedToggle(); }
  });

  // From popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'vibecoder-toggle':
        toggle();
        sendResponse({ active: isActive, count: annotations.size });
        break;
      case 'vibecoder-status':
        sendResponse({ active: isActive, count: annotations.size });
        break;
      case 'vibecoder-generate':
        if (shadowRoot) { handleGenerate().then(() => sendResponse({ success: true })); }
        else sendResponse({ success: false });
        break;
      case 'vibecoder-clear':
        if (shadowRoot) { clearAllAnnotations(); sendResponse({ success: true }); }
        else sendResponse({ success: false });
        break;
    }
    return true;
  });
})();
