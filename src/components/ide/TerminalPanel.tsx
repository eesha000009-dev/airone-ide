'use client';

import { useRef, useEffect } from 'react';
import { useIDEStore } from '@/stores/ide-store';
import { ScrollArea } from '@/components/ui/scroll-area';

const typeStyles: Record<string, string> = {
  info: 'text-[#9cdcfe]',
  error: 'text-[#f44747]',
  warning: 'text-[#cca700]',
  success: 'text-[#4ec9b0]',
  system: 'text-[#569cd6]',
};

export function TerminalPanel() {
  const { terminalLines, clearTerminal } = useIDEStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines]);

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Terminal — Output
        </span>
        <button
          onClick={clearTerminal}
          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Terminal content */}
      <ScrollArea className="flex-1">
        <div className="p-3 font-mono text-xs leading-relaxed">
          {terminalLines.map((line) => (
            <div key={line.id} className={`flex gap-2 ${typeStyles[line.type]}`}>
              <span className="shrink-0 text-muted-foreground/40">
                {new Date(line.timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className="whitespace-pre-wrap">{line.text}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
