'use client';

import {
  GitBranch,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';

export function StatusBar() {
  const { compileStatus, serialStatus, activeFilePath, openFiles } =
    useIDEStore();

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const lineCount = activeFile
    ? activeFile.content.split('\n').length
    : 0;

  return (
    <div className="flex h-[22px] items-center justify-between border-t border-[#4ec9b0]/30 bg-[#1a1a2e] px-3 text-[11px]">
      {/* Left side */}
      <div className="flex items-center gap-3">
        {/* Branch */}
        <div className="flex items-center gap-1 text-[#4ec9b0]">
          <GitBranch className="size-3" />
          <span>main</span>
        </div>

        {/* Compile status */}
        {compileStatus === 'success' && (
          <div className="flex items-center gap-1 text-green-400">
            <CheckCircle2 className="size-3" />
            <span>Compiled</span>
          </div>
        )}
        {compileStatus === 'error' && (
          <div className="flex items-center gap-1 text-red-400">
            <XCircle className="size-3" />
            <span>Errors</span>
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 text-muted-foreground">
        {/* Line count */}
        {activeFile && (
          <span>
            Ln {lineCount}
          </span>
        )}

        {/* Language */}
        {activeFile && (
          <span className="text-[#4ec9b0]">{activeFile.language.toUpperCase()}</span>
        )}

        {/* Serial */}
        <span className={serialStatus === 'connected' ? 'text-green-400' : ''}>
          {serialStatus === 'connected' ? 'Serial: ON' : 'Serial: OFF'}
        </span>

        {/* Target */}
        <span>ESP32</span>

        {/* Encoding */}
        <span>UTF-8</span>

        {/* Notifications */}
        <Bell className="size-3" />
      </div>
    </div>
  );
}
