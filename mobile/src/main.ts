/* ─── Airone IDE Mobile — Main Entry Point ─────────────────────────────── */

import * as monaco from 'monaco-editor';
import { registerAiroLanguage, DEFAULT_SKETCH } from './editor/airo-language';

// ─── Global State ──────────────────────────────────────────────────────────

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let currentFileName = 'sketch.airo';
let serialConnected = false;
let serialOutput: string[] = [];
const sketches: Map<string, string> = new Map();

// Initialize default sketch
sketches.set('sketch.airo', DEFAULT_SKETCH);

// ─── Initialize Monaco Editor ──────────────────────────────────────────────

function initEditor(): void {
  const container = document.getElementById('editor-container');
  if (!container) return;

  // Register .airo language
  registerAiroLanguage(monaco);

  // Create editor
  editor = monaco.editor.create(container, {
    value: sketches.get('sketch.airo') || DEFAULT_SKETCH,
    language: 'airo',
    theme: 'vs-dark',
    fontSize: 14,
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
    minimap: { enabled: false },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: 'on',
    padding: { top: 8 },
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6
    },
    suggest: {
      showKeywords: true,
      showSnippets: true
    }
  });

  // Track cursor position for status bar
  editor.onDidChangeCursorPosition((e) => {
    const lineEl = document.getElementById('status-line');
    if (lineEl) {
      lineEl.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    }
  });

  // Auto-save on change
  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  editor.onDidChangeModelContent(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (editor) {
        sketches.set(currentFileName, editor.getValue());
      }
    }, 500);
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    editor?.layout();
  });
}

// ─── Toolbar Actions ───────────────────────────────────────────────────────

function setupToolbar(): void {
  // Verify / Compile
  const btnVerify = document.getElementById('btn-verify');
  btnVerify?.addEventListener('click', () => {
    if (!editor) return;
    const code = editor.getValue();

    btnVerify.classList.add('compiling');
    const verifySpan = btnVerify.querySelector('span');
    if (verifySpan) verifySpan.textContent = 'Compiling...';

    // Simulate compilation (in real app, this would call the airo compiler)
    setTimeout(() => {
      btnVerify.classList.remove('compiling');
      if (verifySpan) verifySpan.textContent = 'Verify';

      // Check for basic syntax errors
      const hasSetup = code.includes('setup()');
      const hasLoop = code.includes('loop()');

      if (!hasSetup || !hasLoop) {
        showOutputMessage('⚠️ Compilation Warning: Missing setup() or loop() function', 'warning');
      } else {
        showOutputMessage('✓ Compilation successful!', 'success');
      }
    }, 1500);
  });

  // Upload
  const btnUpload = document.getElementById('btn-upload');
  btnUpload?.addEventListener('click', () => {
    if (!editor) return;

    btnUpload.classList.add('uploading');
    const uploadSpan = btnUpload.querySelector('span');
    if (uploadSpan) uploadSpan.textContent = 'Uploading...';

    // Simulate upload
    setTimeout(() => {
      btnUpload.classList.remove('uploading');
      if (uploadSpan) uploadSpan.textContent = 'Upload';
      showOutputMessage('⚠️ Upload requires a connected board via USB OTG', 'warning');
    }, 2000);
  });

  // Serial Monitor Toggle
  const btnSerial = document.getElementById('btn-serial');
  btnSerial?.addEventListener('click', () => {
    toggleSerialPanel();
  });

  // Files Toggle
  const btnFiles = document.getElementById('btn-files');
  btnFiles?.addEventListener('click', () => {
    toggleFileExplorer();
  });

  // Settings
  const btnSettings = document.getElementById('btn-settings');
  btnSettings?.addEventListener('click', () => {
    toggleModal('settings-modal');
  });
}

// ─── Serial Monitor ────────────────────────────────────────────────────────

function setupSerialMonitor(): void {
  const btnConnect = document.getElementById('btn-serial-connect');
  const btnClear = document.getElementById('btn-serial-clear');
  const btnClose = document.getElementById('btn-close-serial');
  const btnSend = document.getElementById('btn-serial-send');
  const serialInput = document.getElementById('serial-input') as HTMLInputElement;

  btnConnect?.addEventListener('click', () => {
    serialConnected = !serialConnected;
    if (serialConnected) {
      btnConnect.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg> Disconnect`;
      btnConnect.classList.add('connected');
      appendSerialOutput('[Serial] Connected at 115200 baud');
      appendSerialOutput('[Serial] Waiting for data...');
    } else {
      btnConnect.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg> Connect`;
      btnConnect.classList.remove('connected');
      appendSerialOutput('[Serial] Disconnected');
    }
  });

  btnClear?.addEventListener('click', () => {
    serialOutput = [];
    const output = document.getElementById('serial-output');
    if (output) output.textContent = '';
  });

  btnClose?.addEventListener('click', () => {
    toggleSerialPanel();
  });

  btnSend?.addEventListener('click', () => {
    if (serialInput && serialInput.value && serialConnected) {
      appendSerialOutput(`> ${serialInput.value}`);
      serialInput.value = '';
    }
  });

  serialInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && serialInput.value && serialConnected) {
      appendSerialOutput(`> ${serialInput.value}`);
      serialInput.value = '';
    }
  });
}

function toggleSerialPanel(): void {
  const panel = document.getElementById('serial-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  // Resize editor
  setTimeout(() => editor?.layout(), 100);
}

function appendSerialOutput(text: string): void {
  serialOutput.push(text);
  const output = document.getElementById('serial-output');
  if (output) {
    output.textContent += text + '\n';
    output.scrollTop = output.scrollHeight;
  }
}

// ─── File Explorer ─────────────────────────────────────────────────────────

function setupFileExplorer(): void {
  const btnNewFile = document.getElementById('btn-new-file');
  const btnCloseExplorer = document.getElementById('btn-close-explorer');
  const btnCreateFile = document.getElementById('btn-create-file');
  const newFileName = document.getElementById('newfile-name') as HTMLInputElement;
  const btnCloseNewFile = document.getElementById('btn-close-newfile');

  btnCloseExplorer?.addEventListener('click', () => {
    toggleFileExplorer();
  });

  btnNewFile?.addEventListener('click', () => {
    toggleModal('newfile-modal');
    if (newFileName) newFileName.value = '';
  });

  btnCreateFile?.addEventListener('click', () => {
    const name = newFileName?.value?.trim();
    if (name) {
      const fileName = name.endsWith('.airo') ? name : `${name}.airo`;
      if (!sketches.has(fileName)) {
        sketches.set(fileName, `// ${fileName}\n\nsetup() {\n\t\n}\n\nloop() {\n\t\n}\n`);
        refreshFileList();
        openFile(fileName);
      }
      toggleModal('newfile-modal');
    }
  });

  btnCloseNewFile?.addEventListener('click', () => {
    toggleModal('newfile-modal');
  });

  refreshFileList();
}

function toggleFileExplorer(): void {
  const explorer = document.getElementById('file-explorer');
  if (!explorer) return;
  explorer.classList.toggle('hidden');
  setTimeout(() => editor?.layout(), 100);
}

function refreshFileList(): void {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  fileList.innerHTML = '';
  sketches.forEach((_, name) => {
    const item = document.createElement('div');
    item.className = `file-item${name === currentFileName ? ' active' : ''}`;
    item.innerHTML = `<span class="file-icon">📄</span><span>${name}</span>`;
    item.addEventListener('click', () => openFile(name));
    fileList.appendChild(item);
  });
}

function openFile(fileName: string): void {
  if (!editor) return;

  // Save current file
  sketches.set(currentFileName, editor.getValue());

  // Open new file
  currentFileName = fileName;
  const content = sketches.get(fileName) || '';
  const model = monaco.editor.createModel(content, 'airo');
  editor.setModel(model);

  // Update status bar
  const fileEl = document.getElementById('status-file');
  if (fileEl) fileEl.textContent = fileName;

  refreshFileList();
}

// ─── Settings ──────────────────────────────────────────────────────────────

function setupSettings(): void {
  const btnClose = document.getElementById('btn-close-settings');

  btnClose?.addEventListener('click', () => {
    toggleModal('settings-modal');
  });

  // Board selector
  const boardSelect = document.getElementById('setting-board') as HTMLSelectElement;
  boardSelect?.addEventListener('change', () => {
    const boardEl = document.getElementById('status-board');
    if (boardEl) boardEl.textContent = boardSelect.value.toUpperCase();
  });

  // Font size
  const fontSizeInput = document.getElementById('setting-font-size') as HTMLInputElement;
  fontSizeInput?.addEventListener('change', () => {
    if (editor) {
      const size = parseInt(fontSizeInput.value, 10);
      if (size >= 10 && size <= 32) {
        editor.updateOptions({ fontSize: size });
      }
    }
  });

  // Theme
  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement;
  themeSelect?.addEventListener('change', () => {
    monaco.editor.setTheme(themeSelect.value);
  });
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function toggleModal(id: string): void {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.toggle('hidden');
  }
}

function showOutputMessage(message: string, type: 'success' | 'warning' | 'error'): void {
  // Show in serial panel if open, or show a brief toast
  const serialPanel = document.getElementById('serial-panel');
  if (serialPanel && !serialPanel.classList.contains('hidden')) {
    appendSerialOutput(message);
  } else {
    // Show brief notification at top
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed; top: 56px; left: 50%; transform: translateX(-50%);
      padding: 8px 16px; border-radius: 6px; font-size: 13px; z-index: 300;
      background: ${type === 'success' ? '#166534' : type === 'warning' ? '#854d0e' : '#991b1b'};
      color: white; pointer-events: none; animation: fadeOut 2s forwards;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initEditor();
  setupToolbar();
  setupSerialMonitor();
  setupFileExplorer();
  setupSettings();

  // Add fadeOut animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeOut {
      0% { opacity: 1; }
      70% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
