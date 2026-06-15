// ── IDE Type Definitions ──────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  language?: string;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export interface CompileResult {
  success: boolean;
  output: string;
  errors: CompileError[];
  generatedCode?: string;
  firmwarePath?: string;
}

export interface CompileError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  file?: string;
}

export interface TerminalLine {
  id: string;
  text: string;
  type: 'info' | 'error' | 'warning' | 'success' | 'system';
  timestamp: number;
}

export interface SerialMessage {
  id: string;
  data: string;
  direction: 'rx' | 'tx';
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export type BottomPanelTab = 'terminal' | 'serial' | 'problems';
export type SidebarPanel = 'explorer' | 'search' | 'devices' | 'extensions';
export type CompileStatus = 'idle' | 'compiling' | 'flashing' | 'success' | 'error';
export type SerialStatus = 'disconnected' | 'connecting' | 'connected';
