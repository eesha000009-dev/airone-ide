'use client';

import {
  Play,
  Upload,
  FilePlus,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  RotateCcw,
  Usb,
} from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { CompileStatus } from '@/types/ide';
import Image from 'next/image';

const statusConfig: Record<
  CompileStatus,
  { icon: React.ReactNode; label: string; color: string }
> = {
  idle: { icon: null, label: 'Ready', color: 'text-muted-foreground' },
  compiling: {
    icon: <Loader2 className="size-3.5 animate-spin" />,
    label: 'Compiling...',
    color: 'text-yellow-400',
  },
  flashing: {
    icon: <Loader2 className="size-3.5 animate-spin" />,
    label: 'Flashing...',
    color: 'text-yellow-400',
  },
  success: {
    icon: <CheckCircle2 className="size-3.5" />,
    label: 'Success',
    color: 'text-green-400',
  },
  error: {
    icon: <XCircle className="size-3.5" />,
    label: 'Error',
    color: 'text-red-400',
  },
};

export function Toolbar() {
  const {
    compile,
    flash,
    saveFile,
    activeFilePath,
    compileStatus,
    newSketch,
    serialStatus,
  } = useIDEStore();

  const status = statusConfig[compileStatus];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-[44px] items-center justify-between border-b border-border bg-[#1a1a2e] px-3">
        {/* Left: Logo + Actions */}
        <div className="flex items-center gap-1">
          {/* Logo */}
          <div className="mr-2 flex items-center gap-2.5">
            <Image
              src="/airone-logo-48.png"
              alt="Airone"
              width={32}
              height={32}
              className="rounded"
              priority
            />
            <span className="text-sm font-semibold text-white/90">
              Airone IDE
            </span>
          </div>

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-border" />

          {/* Action buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={newSketch}
                className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-white hover:bg-[#2d2d2d]"
              >
                <FilePlus className="size-3.5" />
                New
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Sketch (Ctrl+N)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  activeFilePath && saveFile(activeFilePath)
                }
                disabled={!activeFilePath}
                className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-white hover:bg-[#2d2d2d]"
              >
                <Save className="size-3.5" />
                Save
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save (Ctrl+S)</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={compile}
                disabled={compileStatus === 'compiling' || compileStatus === 'flashing'}
                className="h-8 gap-1.5 px-3 text-xs font-medium text-[#4ec9b0] hover:text-[#4ec9b0] hover:bg-[#2d2d2d]"
              >
                <Play className="size-4" />
                Compile
              </Button>
            </TooltipTrigger>
            <TooltipContent>Compile .airo → C++ (Ctrl+B)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={flash}
                disabled={compileStatus === 'compiling' || compileStatus === 'flashing'}
                className="h-8 gap-1.5 px-3 text-xs font-medium text-[#569cd6] hover:text-[#569cd6] hover:bg-[#2d2d2d]"
              >
                <Upload className="size-4" />
                Upload
              </Button>
            </TooltipTrigger>
            <TooltipContent>Compile & Upload to ESP32 (Ctrl+U)</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-white hover:bg-[#2d2d2d]"
                onClick={() => useIDEStore.getState().setBottomPanelTab('serial')}
              >
                <Usb className="size-3.5" />
                Serial
              </Button>
            </TooltipTrigger>
            <TooltipContent>Serial Monitor</TooltipContent>
          </Tooltip>
        </div>

        {/* Right: Status */}
        <div className="flex items-center gap-3">
          {/* Compile status */}
          {compileStatus !== 'idle' && (
            <div className={`flex items-center gap-1.5 text-xs ${status.color}`}>
              {status.icon}
              <span>{status.label}</span>
            </div>
          )}

          {/* Serial status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {serialStatus === 'connected' ? (
              <Wifi className="size-3.5 text-green-400" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            <span>{serialStatus === 'connected' ? 'Connected' : 'Serial'}</span>
          </div>

          {/* Target */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CpuIcon className="size-3.5" />
            <span>ESP32</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function CpuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}
