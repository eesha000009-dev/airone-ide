'use client';

import { Terminal, Radio, AlertTriangle } from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';
import { TerminalPanel } from './TerminalPanel';
import { SerialMonitor } from './SerialMonitor';
import type { BottomPanelTab } from '@/types/ide';

const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="size-3.5" /> },
  { id: 'serial', label: 'Serial Monitor', icon: <Radio className="size-3.5" /> },
  { id: 'problems', label: 'Problems', icon: <AlertTriangle className="size-3.5" /> },
];

export function BottomPanel() {
  const { bottomPanelTab, setBottomPanelTab, compileResult } = useIDEStore();

  const errorCount = compileResult?.errors.filter((e) => e.severity === 'error').length ?? 0;
  const warningCount = compileResult?.errors.filter((e) => e.severity === 'warning').length ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-[#181818]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setBottomPanelTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-1.5 text-[11px] font-medium transition-colors ${
              bottomPanelTab === tab.id
                ? 'border-[#4ec9b0] text-white'
                : 'border-transparent text-muted-foreground hover:text-white/70'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'problems' && (errorCount > 0 || warningCount > 0) && (
              <span className="flex items-center gap-1">
                {errorCount > 0 && (
                  <span className="rounded-full bg-red-500/20 px-1.5 text-[9px] text-red-400">
                    {errorCount}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="rounded-full bg-yellow-500/20 px-1.5 text-[9px] text-yellow-400">
                    {warningCount}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {bottomPanelTab === 'terminal' && <TerminalPanel />}
        {bottomPanelTab === 'serial' && <SerialMonitor />}
        {bottomPanelTab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  );
}

function ProblemsPanel() {
  const { compileResult } = useIDEStore();

  if (!compileResult || compileResult.errors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        No problems detected
      </div>
    );
  }

  return (
    <div className="p-3 font-mono text-xs">
      {compileResult.errors.map((err, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 rounded px-2 py-1 ${
            err.severity === 'error'
              ? 'text-red-400'
              : err.severity === 'warning'
                ? 'text-yellow-400'
                : 'text-blue-400'
          }`}
        >
          <AlertTriangle className="size-3 shrink-0" />
          <span className="text-muted-foreground/50">
            {err.file ?? 'unknown'}:{err.line}:{err.column}
          </span>
          <span>{err.message}</span>
        </div>
      ))}
    </div>
  );
}
