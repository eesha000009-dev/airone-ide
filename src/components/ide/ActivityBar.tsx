'use client';

import {
  Files,
  Search,
  Cpu,
  Puzzle,
  Bot,
} from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';
import type { SidebarPanel } from '@/types/ide';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const icons: { panel: SidebarPanel; icon: React.ReactNode; label: string }[] = [
  { panel: 'explorer', icon: <Files className="size-5" />, label: 'Explorer' },
  { panel: 'search', icon: <Search className="size-5" />, label: 'Search' },
  { panel: 'devices', icon: <Cpu className="size-5" />, label: 'Devices' },
  { panel: 'extensions', icon: <Puzzle className="size-5" />, label: 'Extensions' },
];

export function ActivityBar() {
  const { sidebarPanel, setSidebarPanel, toggleAIPanel, aiPanelVisible } =
    useIDEStore();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-12 flex-col items-center border-r border-border bg-[#181818] py-2">
        {/* Top icons */}
        <div className="flex flex-col items-center gap-1">
          {icons.map(({ panel, icon, label }) => (
            <Tooltip key={panel}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSidebarPanel(panel)}
                  className={`flex size-10 items-center justify-center rounded-md transition-colors ${
                    sidebarPanel === panel
                      ? 'text-white bg-[#2d2d2d]'
                      : 'text-muted-foreground hover:text-white hover:bg-[#2d2d2d]/50'
                  }`}
                >
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom: AI Assistant */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleAIPanel}
                className={`flex size-10 items-center justify-center rounded-md transition-colors ${
                  aiPanelVisible
                    ? 'text-[#4ec9b0] bg-[#2d2d2d]'
                    : 'text-muted-foreground hover:text-[#4ec9b0] hover:bg-[#2d2d2d]/50'
                }`}
              >
                <Bot className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              AI Assistant
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
