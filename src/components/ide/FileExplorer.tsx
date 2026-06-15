'use client';

import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';
import type { FileNode } from '@/types/ide';

function getFileIcon(name: string) {
  if (name.endsWith('.airo')) {
    return <FileCode className="size-4 text-[#4ec9b0]" />;
  }
  return <FileCode className="size-4 text-muted-foreground" />;
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const { expandedFolders, toggleFolder, openFile, activeFilePath } =
    useIDEStore();
  const isExpanded = expandedFolders.has(node.path);
  const isActive = activeFilePath === node.path;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => toggleFolder(node.path)}
          className="flex w-full items-center gap-1 rounded-sm px-2 py-[3px] text-sm hover:bg-[#2a2d2e] text-[#ccc]"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen className="size-4 shrink-0 text-[#dcb67a]" />
          ) : (
            <Folder className="size-4 shrink-0 text-[#dcb67a]" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => openFile(node.path)}
      className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-[3px] text-sm hover:bg-[#2a2d2e] ${
        isActive ? 'bg-[#37373d] text-white' : 'text-[#ccc]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileExplorer() {
  const { projectFiles } = useIDEStore();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
      </div>

      {/* Project header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Folder className="size-4 text-[#dcb67a]" />
        <span className="text-sm font-medium text-[#ccc]">my-robot</span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {projectFiles.map((node) => (
          <TreeNode key={node.path} node={node} />
        ))}
      </div>
    </div>
  );
}
