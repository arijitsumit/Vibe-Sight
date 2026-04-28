(() => {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────────────────
  const toggleBtn = document.getElementById('toggleBtn');
  const generateBtn = document.getElementById('generateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const settingsArrow = document.getElementById('settingsArrow');
  const settingsPanel = document.getElementById('settingsPanel');
  const systemPromptInput = document.getElementById('systemPrompt');
  const elementFormatInput = document.getElementById('elementFormat');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  const savedIndicator = document.getElementById('savedIndicator');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const hotkeyInput = document.getElementById('hotkeyInput');
  const hotkeyResetBtn = document.getElementById('hotkeyResetBtn');
  const shortcutDisplay = document.getElementById('shortcutDisplay');

  // ── Presets ──────────────────────────────────────────────────────────
  const PRESETS = {
    default: {
      systemPrompt: '',
      elementFormat: '',
    },
    tailwind: {
      systemPrompt: 'Act as a Tailwind CSS expert. Output only the modified HTML with updated Tailwind classes. No explanations needed.',
      elementFormat: '[EL{n}] {selector}\nHTML: {html}\nStyles: {styles}\nInstruction: {instruction}',
    },
    react: {
      systemPrompt: 'Act as a React developer. Output only JSX/TSX component code changes. Preserve existing props and state patterns.',
      elementFormat: '[EL{n}] {selector}\nJSX: {html}\nStyles: {styles}\nInstruction: {instruction}',
    },
    vue: {
      systemPrompt: 'Act as a Vue.js developer. Output only template/style/script changes for Vue SFC components. Preserve reactivity patterns.',
      elementFormat: '[EL{n}] {selector}\nTemplate: {html}\nStyles: {styles}\nInstruction: {instruction}',
    },
    custom: {
      systemPrompt: '',
      elementFormat: '',
    },
  };

  const DEFAULT_ELEMENT_FORMAT = '[EL{n}] {selector}\nHTML: {html}\nStyles: {styles}\nInstruction: {instruction}';

  const DEFAULT_HOTKEY = { ctrlKey: true, shiftKey: false, altKey: false, key: '\\' };

  const MODIFIER_LABELS = {
    ctrlKey: 'Ctrl',
    shiftKey: 'Shift',
    altKey: 'Alt',
    metaKey: 'Meta',
  };

  const SYSTEM_KEYS = new Set([
    'Escape', 'Tab', 'CapsLock', 'Enter', 'Backspace', 'Delete',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ]);

  const formatHotkey = (hk) => {
    if (!hk) return 'Ctrl + \\';
    const parts = [];
    if (hk.ctrlKey) parts.push('Ctrl');
    if (hk.altKey) parts.push('Alt');
    if (hk.shiftKey) parts.push('Shift');
    const keyLabel = hk.key === '\\' ? '\\' : hk.key.length === 1 ? hk.key.toUpperCase() : hk.key;
    parts.push(keyLabel);
    return parts.join(' + ');
  };

  const hotkeysMatch = (stored, event) => {
    if (!stored) return false;
    return stored.ctrlKey === event.ctrlKey
      && stored.altKey === event.altKey
      && stored.shiftKey === event.shiftKey
      && stored.key === event.key;
  };

  // ── Settings helpers ─────────────────────────────────────────────────
  const getResolveFormat = (format) =>
    format && format.trim() ? format.trim() : DEFAULT_ELEMENT_FORMAT;

  const loadSettings = () => {
    chrome.storage.local.get(['vibecoderSettings', 'vibecoderHotkey'], (result) => {
      const settings = result.vibecoderSettings || { preset: 'default', systemPrompt: '', elementFormat: '' };
      systemPromptInput.value = settings.systemPrompt || '';
      elementFormatInput.value = settings.elementFormat || '';
      highlightPreset(settings.preset || 'default');

      const hotkey = result.vibecoderHotkey || DEFAULT_HOTKEY;
      renderHotkeyDisplay(hotkey);
    });
  };

  const saveSettings = () => {
    const preset = getActivePreset();
    const settings = {
      preset,
      systemPrompt: systemPromptInput.value,
      elementFormat: elementFormatInput.value,
    };
    chrome.storage.local.set({ vibecoderSettings: settings }, () => {
      flashSaved();
    });
  };

  const resetSettings = () => {
    chrome.storage.local.remove('vibecoderSettings', () => {
      systemPromptInput.value = '';
      elementFormatInput.value = '';
      highlightPreset('default');
      flashSaved();
    });
  };

  const getActivePreset = () => {
    const active = document.querySelector('.preset-btn.active');
    return active ? active.getAttribute('data-preset') : 'default';
  };

  const highlightPreset = (name) => {
    presetBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === name);
    });
  };

  const flashSaved = () => {
    savedIndicator.classList.add('show');
    setTimeout(() => savedIndicator.classList.remove('show'), 1200);
  };

  // ── Tab status ───────────────────────────────────────────────────────
  const updateUI = (active, count = 0) => {
    statusBadge.className = `status-badge ${active ? 'active' : 'inactive'}`;
    statusDot.className = `status-dot ${active ? 'active' : 'inactive'}`;
    statusText.textContent = active
      ? `Active \u2014 ${count} element${count !== 1 ? 's' : ''} selected`
      : 'Inactive';

    toggleBtn.textContent = active ? '\u23F9 Deactivate Selection Mode' : '\u25B6 Activate Selection Mode';
    toggleBtn.style.background = active ? '#ef4444' : '';

    generateBtn.disabled = count === 0;
    clearBtn.disabled = count === 0;
  };

  const sendToTab = (message, callback) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          updateUI(response.active, response.count ?? 0);
          if (callback) callback(response);
        }
      });
    });
  };

  // ── Event listeners ──────────────────────────────────────────────────
  toggleBtn.addEventListener('click', () => {
    sendToTab({ type: 'vibecoder-toggle' });
  });

  generateBtn.addEventListener('click', () => {
    sendToTab({ type: 'vibecoder-generate' });
  });

  clearBtn.addEventListener('click', () => {
    sendToTab({ type: 'vibecoder-clear' });
  });

  // Settings panel toggle
  settingsToggleBtn.addEventListener('click', () => {
    const open = settingsPanel.classList.toggle('open');
    settingsArrow.classList.toggle('open', open);
  });

  // Preset buttons
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      highlightPreset(preset);
      const data = PRESETS[preset];
      if (data) {
        systemPromptInput.value = data.systemPrompt;
        elementFormatInput.value = data.elementFormat;
      }
    });
  });

  saveSettingsBtn.addEventListener('click', saveSettings);
  resetSettingsBtn.addEventListener('click', resetSettings);

  const renderHotkeyDisplay = (hk) => {
    const label = formatHotkey(hk);
    hotkeyInput.innerHTML = label;
    shortcutDisplay.textContent = label;
  };

  // ── Hotkey recorder ──────────────────────────────────────────────────
  let isRecording = false;

  hotkeyInput.addEventListener('click', () => {
    isRecording = true;
    hotkeyInput.classList.add('recording');
    hotkeyInput.innerHTML = '<span class="placeholder">Press shortcut...</span>';
    hotkeyInput.focus();
  });

  hotkeyInput.addEventListener('keydown', (e) => {
    if (!isRecording) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels recording
    if (e.key === 'Escape') {
      isRecording = false;
      hotkeyInput.classList.remove('recording');
      chrome.storage.local.get(['vibecoderHotkey'], (r) => {
        renderHotkeyDisplay(r.vibecoderHotkey || DEFAULT_HOTKEY);
      });
      return;
    }

    // Must include at least one modifier
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) return;

    // Reject system keys
    if (SYSTEM_KEYS.has(e.key)) return;

    const hotkey = {
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      key: e.key,
    };

    isRecording = false;
    hotkeyInput.classList.remove('recording');
    renderHotkeyDisplay(hotkey);

    chrome.storage.local.set({ vibecoderHotkey: hotkey }, () => {
      flashSaved();
    });
  });

  hotkeyInput.addEventListener('blur', () => {
    if (!isRecording) return;
    isRecording = false;
    hotkeyInput.classList.remove('recording');
    chrome.storage.local.get(['vibecoderHotkey'], (r) => {
      renderHotkeyDisplay(r.vibecoderHotkey || DEFAULT_HOTKEY);
    });
  });

  hotkeyResetBtn.addEventListener('click', () => {
    chrome.storage.local.remove('vibecoderHotkey', () => {
      renderHotkeyDisplay(DEFAULT_HOTKEY);
      flashSaved();
    });
  });

  // ── Init ─────────────────────────────────────────────────────────────
  loadSettings();
  sendToTab({ type: 'vibecoder-status' });
})();
