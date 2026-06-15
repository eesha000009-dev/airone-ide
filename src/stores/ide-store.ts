import { create } from 'zustand';
import type {
  FileNode,
  OpenFile,
  TerminalLine,
  SerialMessage,
  ChatMessage,
  BottomPanelTab,
  SidebarPanel,
  CompileStatus,
  SerialStatus,
  CompileResult,
} from '@/types/ide';
import { SAMPLE_PROJECT } from '@/lib/sample-files';

// ── IDE Store ────────────────────────────────────────────────────

interface IDEState {
  // File system
  projectFiles: FileNode[];
  expandedFolders: Set<string>;

  // Editor
  openFiles: OpenFile[];
  activeFilePath: string | null;

  // Panels
  sidebarPanel: SidebarPanel;
  sidebarVisible: boolean;
  bottomPanelTab: BottomPanelTab;
  bottomPanelVisible: boolean;
  aiPanelVisible: boolean;

  // Compile
  compileStatus: CompileStatus;
  compileResult: CompileResult | null;

  // Terminal
  terminalLines: TerminalLine[];

  // Serial
  serialStatus: SerialStatus;
  serialMessages: SerialMessage[];
  serialPort: string;
  serialBaudRate: number;

  // AI Chat
  chatMessages: ChatMessage[];
  chatInput: string;
  chatLoading: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  toggleBottomPanel: () => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  toggleAIPanel: () => void;
  toggleFolder: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => void;
  compile: () => Promise<void>;
  flash: () => Promise<void>;
  addTerminalLine: (text: string, type: TerminalLine['type']) => void;
  clearTerminal: () => void;
  connectSerial: () => void;
  disconnectSerial: () => void;
  sendSerialData: (data: string) => void;
  clearSerial: () => void;
  sendChatMessage: (message: string) => Promise<void>;
  setChatInput: (input: string) => void;
  setSerialPort: (port: string) => void;
  setSerialBaudRate: (rate: number) => void;
  newSketch: () => void;
}

let lineIdCounter = 0;
function nextLineId() {
  return `line-${++lineIdCounter}`;
}

let msgIdCounter = 0;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}

export const useIDEStore = create<IDEState>((set, get) => ({
  // File system
  projectFiles: SAMPLE_PROJECT.files,
  expandedFolders: new Set(['/my-robot']),

  // Editor
  openFiles: [],
  activeFilePath: null,

  // Panels
  sidebarPanel: 'explorer',
  sidebarVisible: true,
  bottomPanelTab: 'terminal',
  bottomPanelVisible: true,
  aiPanelVisible: false,

  // Compile
  compileStatus: 'idle',
  compileResult: null,

  // Terminal
  terminalLines: [
    {
      id: nextLineId(),
      text: 'Airone IDE v0.3.0 — Ready',
      type: 'system',
      timestamp: Date.now(),
    },
  ],

  // Serial
  serialStatus: 'disconnected',
  serialMessages: [],
  serialPort: 'auto',
  serialBaudRate: 115200,

  // AI Chat
  chatMessages: [
    {
      id: nextMsgId(),
      role: 'system',
      content:
        'Hello! I am the Airone AI assistant. I can help you with .airo programming, robot design, pin configurations, and more. How can I help you today?',
      timestamp: Date.now(),
    },
  ],
  chatInput: '',
  chatLoading: false,

  // ── Actions ────────────────────────────────────────────────────

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setSidebarPanel: (panel) =>
    set((s) => ({
      sidebarPanel: panel,
      sidebarVisible: s.sidebarPanel === panel ? !s.sidebarVisible : true,
    })),

  toggleBottomPanel: () =>
    set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),

  setBottomPanelTab: (tab) =>
    set({ bottomPanelTab: tab, bottomPanelVisible: true }),

  toggleAIPanel: () => set((s) => ({ aiPanelVisible: !s.aiPanelVisible })),

  toggleFolder: (path) =>
    set((s) => {
      const next = new Set(s.expandedFolders);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedFolders: next };
    }),

  openFile: (path) =>
    set((s) => {
      const existing = s.openFiles.find((f) => f.path === path);
      if (existing) return { activeFilePath: path };

      const fileNode = findFileNode(s.projectFiles, path);
      if (!fileNode || fileNode.type !== 'file') return s;

      // Look up content from sample files
      const content =
        SAMPLE_PROJECT.fileContents[path] ??
        `# ${fileNode.name}\n# New file\n`;

      const newFile: OpenFile = {
        path,
        name: fileNode.name,
        content,
        language: fileNode.name.endsWith('.airo')
          ? 'airo'
          : fileNode.name.endsWith('.cpp')
            ? 'cpp'
            : fileNode.name.endsWith('.h')
              ? 'cpp'
              : fileNode.name.endsWith('.json')
                ? 'json'
                : 'plaintext',
        isDirty: false,
      };

      return {
        openFiles: [...s.openFiles, newFile],
        activeFilePath: path,
      };
    }),

  closeFile: (path) =>
    set((s) => {
      const idx = s.openFiles.findIndex((f) => f.path === path);
      if (idx === -1) return s;

      const newOpen = [...s.openFiles];
      newOpen.splice(idx, 1);

      let nextActive = s.activeFilePath;
      if (nextActive === path) {
        if (newOpen.length > 0) {
          nextActive =
            newOpen[Math.min(idx, newOpen.length - 1)].path;
        } else {
          nextActive = null;
        }
      }

      return { openFiles: newOpen, activeFilePath: nextActive };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    })),

  saveFile: (path) =>
    set((s) => {
      addTerminalLine(s, `Saved: ${path}`, 'info');
      return {
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, isDirty: false } : f
        ),
      };
    }),

  compile: async () => {
    set({ compileStatus: 'compiling' });
    addTerminalLine(get(), '⏳ Compiling .airo → C++ for ESP32...', 'info');

    // Simulate compilation
    await new Promise((r) => setTimeout(r, 1500));

    const state = get();
    const activeFile = state.openFiles.find(
      (f) => f.path === state.activeFilePath
    );

    if (!activeFile) {
      addTerminalLine(get(), '❌ No active file to compile.', 'error');
      set({ compileStatus: 'error' });
      return;
    }

    // Simulate success
    addTerminalLine(get(), '✅ Compilation successful!', 'success');
    addTerminalLine(
      get(),
      '   Generated: /build/firmware/main.cpp (4.2 KB)',
      'info'
    );
    addTerminalLine(
      get(),
      '   Generated: /build/firmware/pin_map.h (0.8 KB)',
      'info'
    );
    addTerminalLine(
      get(),
      '   Generated: /build/firmware/sensor_reader.h (1.1 KB)',
      'info'
    );
    addTerminalLine(
      get(),
      '   Total: 3 files, 6.1 KB',
      'info'
    );

    set({
      compileStatus: 'success',
      compileResult: {
        success: true,
        output: 'Compilation successful',
        errors: [],
        generatedCode: '// Generated C++ code would appear here',
      },
    });
  },

  flash: async () => {
    set({ compileStatus: 'flashing' });
    addTerminalLine(get(), '⏳ Compiling .airo → C++ for ESP32...', 'info');

    await new Promise((r) => setTimeout(r, 1500));
    addTerminalLine(get(), '✅ Compilation successful!', 'success');

    addTerminalLine(get(), '⏳ Flashing firmware to ESP32...', 'info');
    addTerminalLine(get(), '   Connecting to /dev/ttyUSB0...', 'info');

    await new Promise((r) => setTimeout(r, 2000));
    addTerminalLine(get(), '   Writing firmware: ██████████ 100%', 'info');

    await new Promise((r) => setTimeout(r, 500));
    addTerminalLine(get(), '✅ Flash complete! Firmware deployed to ESP32.', 'success');
    addTerminalLine(get(), '   Resetting device...', 'info');

    set({ compileStatus: 'success' });
  },

  addTerminalLine: (text, type) =>
    set((s) => ({
      terminalLines: [
        ...s.terminalLines,
        { id: nextLineId(), text, type, timestamp: Date.now() },
      ],
    })),

  clearTerminal: () => set({ terminalLines: [] }),

  connectSerial: () => {
    set({ serialStatus: 'connecting' });
    setTimeout(() => {
      set({ serialStatus: 'connected' });
      const msg: SerialMessage = {
        id: nextMsgId(),
        data: 'ESP32 Serial Connected — Ready',
        direction: 'rx',
        timestamp: Date.now(),
      };
      set((s) => ({ serialMessages: [...s.serialMessages, msg] }));
    }, 1000);
  },

  disconnectSerial: () => {
    set({ serialStatus: 'disconnected' });
  },

  sendSerialData: (data) => {
    const msg: SerialMessage = {
      id: nextMsgId(),
      data,
      direction: 'tx',
      timestamp: Date.now(),
    };
    set((s) => ({ serialMessages: [...s.serialMessages, msg] }));

    // Simulate echo response
    setTimeout(() => {
      const resp: SerialMessage = {
        id: nextMsgId(),
        data: `[ECHO] ${data}`,
        direction: 'rx',
        timestamp: Date.now(),
      };
      set((s) => ({ serialMessages: [...s.serialMessages, resp] }));
    }, 200);
  },

  clearSerial: () => set({ serialMessages: [] }),

  sendChatMessage: async (message) => {
    if (!message.trim()) return;

    const userMsg: ChatMessage = {
      id: nextMsgId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    set((s) => ({
      chatMessages: [...s.chatMessages, userMsg],
      chatInput: '',
      chatLoading: true,
    }));

    // Simulate AI response
    await new Promise((r) => setTimeout(r, 1200));

    const responses = [
      "In .airo, you define hardware pins using `pin defi { ... }`. Each pin has a name, number, and mode (input/output). For example:\n```\npin defi {\n    ledpin = 2; output.\n    sensor = 35; input.\n}\n```",
      "The main robot loop uses `loop { ... }` which runs forever. Inside, follow the SENSE → THINK → ACT pattern:\n- `read_for(ms) { ... }` to sense\n- `senddatato(url)` to think\n- `actfor(ms) { ... }` to act",
      "To connect your robot to an AI brain, set the `brain_url` variable in the `#variables#` section:\n```\nbrain_url = \"wss://your-brain.local:8080\".\ncall brain_url.\n```",
      "You can import body modules using the `call` keyword in the `#library#` section:\n```\n#library#\ncall body/actuation/hands.airo.\ncall body/sight/eyes.airo.\n```",
      "The `actfor(ms) { ... }` block controls output actuators for the specified duration. Only place output pins and modules inside this block.",
    ];

    const aiMsg: ChatMessage = {
      id: nextMsgId(),
      role: 'assistant',
      content: responses[Math.floor(Math.random() * responses.length)],
      timestamp: Date.now(),
    };

    set((s) => ({
      chatMessages: [...s.chatMessages, aiMsg],
      chatLoading: false,
    }));
  },

  setChatInput: (input) => set({ chatInput: input }),

  setSerialPort: (port) => set({ serialPort: port }),

  setSerialBaudRate: (rate) => set({ serialBaudRate: rate }),

  newSketch: () => {
    const state = get();
    const sketchName = 'untitled';
    const path = `/${sketchName}/${sketchName}.airo`;

    // Check if already open
    if (state.openFiles.find((f) => f.path === path)) {
      set({ activeFilePath: path });
      return;
    }

    const newFile: OpenFile = {
      path,
      name: `${sketchName}.airo`,
      content: SAMPLE_PROJECT.fileContents['/new-robot.airo'] ?? '',
      language: 'airo',
      isDirty: true,
    };

    set((s) => ({
      openFiles: [...s.openFiles, newFile],
      activeFilePath: path,
    }));

    addTerminalLine(get(), `📝 New sketch created: ${sketchName}.airo`, 'info');
  },
}));

// ── Helpers ──────────────────────────────────────────────────────

function findFileNode(
  nodes: FileNode[],
  path: string
): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findFileNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function addTerminalLine(
  state: IDEState,
  text: string,
  type: TerminalLine['type']
) {
  // This is a workaround since we can't call set from outside
  // The actual set is done in the action
  void state;
  void text;
  void type;
}
