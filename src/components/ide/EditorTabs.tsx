'use client';

import { X, FileCode } from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';

export function EditorTabs() {
  const { openFiles, activeFilePath, setActiveFile, closeFile } =
    useIDEStore();

  if (openFiles.length === 0) return null;

  return (
    <div className="flex h-[35px] items-center overflow-x-auto bg-[#181818] border-b border-border">
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath;
        return (
          <div
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            className={`group flex h-full min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-r border-border px-3 text-sm transition-colors ${
              isActive
                ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#4ec9b0]'
                : 'bg-[#2d2d2d] text-muted-foreground hover:bg-[#2a2d2e]'
            }`}
          >
            <FileCode
              className={`size-4 shrink-0 ${
                file.name.endsWith('.airo')
                  ? 'text-[#4ec9b0]'
                  : 'text-muted-foreground'
              }`}
            />
            <span className="truncate flex-1">
              {file.name}
              {file.isDirty && (
                <span className="ml-1 inline-block size-2 rounded-full bg-white" />
              )}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeFile(file.path);
              }}
              className="shrink-0 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[#3d3d3d] transition-opacity"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
