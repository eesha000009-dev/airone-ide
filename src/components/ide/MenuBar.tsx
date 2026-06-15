'use client';

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarCheckboxItem,
} from '@/components/ui/menubar';
import {
  FilePlus,
  FolderOpen,
  Save,
  SaveAll,
  Download,
  X,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
  Search,
  Replace,
  ListChecks,
  Terminal,
  SidebarOpen,
  CheckSquare,
  LayoutDashboard,
  BookOpen,
  Wrench,
  Usb,
  Cpu,
  Settings,
  RefreshCw,
  Package,
} from 'lucide-react';
import { useIDEStore } from '@/stores/ide-store';

export function IDEMenuBar() {
  const {
    newSketch,
    saveFile,
    activeFilePath,
    toggleSidebar,
    toggleBottomPanel,
    toggleAIPanel,
    setBottomPanelTab,
    compile,
    flash,
  } = useIDEStore();

  return (
    <Menubar className="h-[28px] rounded-none border-0 border-b border-border bg-[#2d2d2d] px-1 shadow-none">
      {/* File Menu */}
      <MenubarMenu>
        <MenubarTrigger className="h-[24px] text-[12px] font-normal text-gray-300 hover:bg-[#3d3d3d] hover:text-white data-[state=open]:bg-[#3d3d3d] data-[state=open]:text-white">
          File
        </MenubarTrigger>
        <MenubarContent className="min-w-[200px] border-[#3d3d3d] bg-[#252526] text-gray-300">
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={newSketch}
          >
            <FilePlus className="mr-2 size-3.5" />
            New Sketch
            <MenubarShortcut>Ctrl+N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <FolderOpen className="mr-2 size-3.5" />
            Open Folder...
            <MenubarShortcut>Ctrl+O</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => activeFilePath && saveFile(activeFilePath)}
            disabled={!activeFilePath}
          >
            <Save className="mr-2 size-3.5" />
            Save
            <MenubarShortcut>Ctrl+S</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <SaveAll className="mr-2 size-3.5" />
            Save All
            <MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Download className="mr-2 size-3.5" />
            Export Compiled Binary
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <X className="mr-2 size-3.5" />
            Close Editor
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Edit Menu */}
      <MenubarMenu>
        <MenubarTrigger className="h-[24px] text-[12px] font-normal text-gray-300 hover:bg-[#3d3d3d] hover:text-white data-[state=open]:bg-[#3d3d3d] data-[state=open]:text-white">
          Edit
        </MenubarTrigger>
        <MenubarContent className="min-w-[200px] border-[#3d3d3d] bg-[#252526] text-gray-300">
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Undo2 className="mr-2 size-3.5" />
            Undo
            <MenubarShortcut>Ctrl+Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Redo2 className="mr-2 size-3.5" />
            Redo
            <MenubarShortcut>Ctrl+Y</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Scissors className="mr-2 size-3.5" />
            Cut
            <MenubarShortcut>Ctrl+X</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Copy className="mr-2 size-3.5" />
            Copy
            <MenubarShortcut>Ctrl+C</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <ClipboardPaste className="mr-2 size-3.5" />
            Paste
            <MenubarShortcut>Ctrl+V</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Search className="mr-2 size-3.5" />
            Find
            <MenubarShortcut>Ctrl+F</MenubarShortcut>
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Replace className="mr-2 size-3.5" />
            Replace
            <MenubarShortcut>Ctrl+H</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <ListChecks className="mr-2 size-3.5" />
            Select All
            <MenubarShortcut>Ctrl+A</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* View Menu */}
      <MenubarMenu>
        <MenubarTrigger className="h-[24px] text-[12px] font-normal text-gray-300 hover:bg-[#3d3d3d] hover:text-white data-[state=open]:bg-[#3d3d3d] data-[state=open]:text-white">
          View
        </MenubarTrigger>
        <MenubarContent className="min-w-[220px] border-[#3d3d3d] bg-[#252526] text-gray-300">
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => {
              const state = useIDEStore.getState();
              useIDEStore.getState().setSidebarPanel('explorer');
            }}
          >
            <SidebarOpen className="mr-2 size-3.5" />
            Explorer
            <MenubarShortcut>Ctrl+Shift+E</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => useIDEStore.getState().setSidebarPanel('search')}
          >
            <Search className="mr-2 size-3.5" />
            Search
            <MenubarShortcut>Ctrl+Shift+F</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => setBottomPanelTab('terminal')}
          >
            <Terminal className="mr-2 size-3.5" />
            Terminal
            <MenubarShortcut>Ctrl+`</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => setBottomPanelTab('serial')}
          >
            <Usb className="mr-2 size-3.5" />
            Serial Monitor
            <MenubarShortcut>Ctrl+Shift+M</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={() => setBottomPanelTab('problems')}
          >
            <CheckSquare className="mr-2 size-3.5" />
            Problems
            <MenubarShortcut>Ctrl+Shift+P</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={toggleAIPanel}
          >
            <LayoutDashboard className="mr-2 size-3.5" />
            AI Assistant
            <MenubarShortcut>Ctrl+Shift+A</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={toggleSidebar}
          >
            <SidebarOpen className="mr-2 size-3.5" />
            Toggle Sidebar
            <MenubarShortcut>Ctrl+B</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={toggleBottomPanel}
          >
            <Terminal className="mr-2 size-3.5" />
            Toggle Bottom Panel
            <MenubarShortcut>Ctrl+J</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Libraries Menu */}
      <MenubarMenu>
        <MenubarTrigger className="h-[24px] text-[12px] font-normal text-gray-300 hover:bg-[#3d3d3d] hover:text-white data-[state=open]:bg-[#3d3d3d] data-[state=open]:text-white">
          Libraries
        </MenubarTrigger>
        <MenubarContent className="min-w-[220px] border-[#3d3d3d] bg-[#252526] text-gray-300">
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <BookOpen className="mr-2 size-3.5" />
            Manage Libraries...
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Package className="mr-2 size-3.5" />
            Install from URL...
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <BookOpen className="mr-2 size-3.5" />
            Included Libraries
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarSub>
            <MenubarSubTrigger className="text-[12px] focus:bg-[#094771] focus:text-white">
              <BookOpen className="mr-2 size-3.5" />
              Body Modules
            </MenubarSubTrigger>
            <MenubarSubContent className="border-[#3d3d3d] bg-[#252526] text-gray-300">
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                body/actuation/hands.airo
              </MenubarItem>
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                body/actuation/legs.airo
              </MenubarItem>
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                body/sight/eyes.airo
              </MenubarItem>
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                body/hearing/ears.airo
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger className="text-[12px] focus:bg-[#094771] focus:text-white">
              <BookOpen className="mr-2 size-3.5" />
              Sensor Libraries
            </MenubarSubTrigger>
            <MenubarSubContent className="border-[#3d3d3d] bg-[#252526] text-gray-300">
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                sensors/ultrasonic.airo
              </MenubarItem>
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                sensors/temperature.airo
              </MenubarItem>
              <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
                sensors/imu.airo
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      {/* Tools Menu */}
      <MenubarMenu>
        <MenubarTrigger className="h-[24px] text-[12px] font-normal text-gray-300 hover:bg-[#3d3d3d] hover:text-white data-[state=open]:bg-[#3d3d3d] data-[state=open]:text-white">
          Tools
        </MenubarTrigger>
        <MenubarContent className="min-w-[220px] border-[#3d3d3d] bg-[#252526] text-gray-300">
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={compile}
          >
            <Cpu className="mr-2 size-3.5" />
            Compile
            <MenubarShortcut>Ctrl+B</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            className="text-[12px] focus:bg-[#094771] focus:text-white"
            onClick={flash}
          >
            <Usb className="mr-2 size-3.5" />
            Upload to Board
            <MenubarShortcut>Ctrl+U</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Wrench className="mr-2 size-3.5" />
            Board Manager...
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Cpu className="mr-2 size-3.5" />
            Port: /dev/ttyUSB0
          </MenubarItem>
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Cpu className="mr-2 size-3.5" />
            Board: ESP32 DevKit V1
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <RefreshCw className="mr-2 size-3.5" />
            Auto Update
          </MenubarItem>
          <MenubarSeparator className="bg-[#3d3d3d]" />
          <MenubarItem className="text-[12px] focus:bg-[#094771] focus:text-white">
            <Settings className="mr-2 size-3.5" />
            Preferences...
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
