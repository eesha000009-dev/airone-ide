'use client';

import { useEffect, useCallback } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useIDEStore } from '@/stores/ide-store';
import { ActivityBar } from './ActivityBar';
import { FileExplorer } from './FileExplorer';
import { EditorTabs } from './EditorTabs';
import { EditorPanel } from './EditorPanel';
import { BottomPanel } from './BottomPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { IDEMenuBar } from './MenuBar';

export function IDELayout() {
  const {
    sidebarVisible,
    bottomPanelVisible,
    aiPanelVisible,
    saveFile,
    activeFilePath,
    compile,
    flash,
    newSketch,
  } = useIDEStore();

  // ── Keyboard Shortcuts ─────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) saveFile(activeFilePath);
      }

      if (isCtrl && e.key === 'b') {
        e.preventDefault();
        compile();
      }

      if (isCtrl && e.key === 'u') {
        e.preventDefault();
        flash();
      }

      if (isCtrl && e.key === 'n') {
        e.preventDefault();
        newSketch();
      }
    },
    [activeFilePath, saveFile, compile, flash, newSketch]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Row 1: Menu Bar (File / Edit / View / Libraries / Tools) */}
      <IDEMenuBar />

      {/* Row 2: Toolbar (Compile / Upload / Serial / etc.) */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar (leftmost) */}
        <ActivityBar />

        {/* Sidebar (file explorer, etc.) */}
        {sidebarVisible && (
          <div className="w-[260px] shrink-0 border-r border-border bg-[#252526]">
            <SidebarContent />
          </div>
        )}

        {/* Center: Editor + Bottom Panel */}
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="vertical">
            {/* Editor area */}
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="flex h-full flex-col">
                <EditorTabs />
                <div className="flex-1 overflow-hidden">
                  <EditorPanel />
                </div>
              </div>
            </ResizablePanel>

            {/* Bottom panel */}
            {bottomPanelVisible && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={35} minSize={15} maxSize={60}>
                  <BottomPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        {/* AI Assistant Panel (right) */}
        {aiPanelVisible && (
          <div className="w-[340px] shrink-0 border-l border-border bg-[#252526]">
            <AIAssistantPanel />
          </div>
        )}
      </div>

      {/* Status Bar (bottom) */}
      <StatusBar />
    </div>
  );
}

function SidebarContent() {
  const { sidebarPanel } = useIDEStore();

  switch (sidebarPanel) {
    case 'explorer':
      return <FileExplorer />;
    case 'search':
      return <SearchPanel />;
    case 'devices':
      return <DevicesPanel />;
    case 'extensions':
      return <ExtensionsPanel />;
    default:
      return <FileExplorer />;
  }
}

function SearchPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Search
        </span>
      </div>
      <div className="flex-1 p-4 text-xs text-muted-foreground/50">
        Search across your project files...
      </div>
    </div>
  );
}

function DevicesPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Devices
        </span>
      </div>
      <div className="flex-1 p-4">
        <div className="flex items-center gap-2 rounded-lg border border-[#4ec9b0]/20 bg-[#4ec9b0]/5 p-3 text-xs text-[#4ec9b0]">
          <span>📡 ESP32 DevKit V1</span>
        </div>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Port</span>
            <span className="text-muted-foreground/50">/dev/ttyUSB0</span>
          </div>
          <div className="flex justify-between">
            <span>Chip</span>
            <span className="text-muted-foreground/50">ESP32-D0WDQ6</span>
          </div>
          <div className="flex justify-between">
            <span>Flash</span>
            <span className="text-muted-foreground/50">4MB</span>
          </div>
          <div className="flex justify-between">
            <span>WiFi</span>
            <span className="text-green-400">Connected</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtensionsPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Extensions
        </span>
      </div>
      <div className="flex-1 p-4 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-[#2d2d2d] p-3 text-xs">
          <span className="text-[#4ec9b0]">🤖</span>
          <div>
            <div className="text-white">Airone Compiler</div>
            <div className="text-muted-foreground/50">v0.3.0 — .airo → C++</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-[#2d2d2d] p-3 text-xs">
          <span className="text-[#569cd6]">🧠</span>
          <div>
            <div className="text-white">Brain Sync</div>
            <div className="text-muted-foreground/50">v0.2.0 — AI Brain</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-[#2d2d2d] p-3 text-xs">
          <span className="text-[#dcb67a]">📡</span>
          <div>
            <div className="text-white">Serial Monitor</div>
            <div className="text-muted-foreground/50">v0.2.0 — ESP32 Serial</div>
          </div>
        </div>
      </div>
    </div>
  );
}
