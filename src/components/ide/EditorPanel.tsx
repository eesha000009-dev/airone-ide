'use client';

import { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useIDEStore } from '@/stores/ide-store';
import {
  airoLanguageConfig,
  airoMonarchLanguage,
  airoThemeColors,
} from '@/lib/airo-language';
import {
  airoSnippets,
  airoKeywordCompletions,
} from '@/lib/airo-snippets';
import type { editor } from 'monaco-editor';

// Custom dark theme for .airo
const AIRO_DARK_THEME = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'keyword.control.airo', foreground: 'c586c0' },
    { token: 'keyword.declaration.airo', foreground: '569cd6' },
    { token: 'keyword.io.airo', foreground: '4ec9b0' },
    { token: 'keyword.other.airo', foreground: 'dcdcaa' },
    { token: 'constant.language.mode.airo', foreground: '4fc1ff' },
    { token: 'entity.name.section.airo', foreground: 'd7ba7d' },
    { token: 'string.quoted.double.airo', foreground: 'ce9178' },
    { token: 'constant.numeric.float.airo', foreground: 'b5cea8' },
    { token: 'constant.numeric.integer.airo', foreground: 'b5cea8' },
    { token: 'comment.line.airo', foreground: '6a9955' },
    { token: 'comment.block.airo', foreground: '6a9955' },
    { token: 'variable.other.airo', foreground: '9cdcfe' },
    { token: 'punctuation.section.block.airo', foreground: '808080' },
    { token: 'punctuation.terminator.airo', foreground: '808080' },
    { token: 'keyword.operator.airo', foreground: 'd4d4d4' },
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#2a2d2e',
    'editor.selectionBackground': '#264f78',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editorIndentGuide.background': '#404040',
    'editorIndentGuide.activeBackground': '#707070',
  },
};

let languageRegistered = false;

function registerAiroLanguage(monaco: typeof import('monaco-editor')) {
  if (languageRegistered) return;
  languageRegistered = true;

  // Register the .airo language
  monaco.languages.register({ id: 'airo' });

  // Set language configuration
  monaco.languages.setLanguageConfiguration('airo', airoLanguageConfig);

  // Set Monarch tokenizer
  monaco.languages.setMonarchTokensProvider('airo', airoMonarchLanguage);

  // Register theme
  monaco.editor.defineTheme('airo-dark', AIRO_DARK_THEME);

  // Register completion provider
  monaco.languages.registerCompletionItemProvider('airo', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const snippetItems = airoSnippets.map((s) => ({
        ...s,
        range,
      }));

      const keywordItems = airoKeywordCompletions.map((k) => ({
        ...k,
        range,
      }));

      return {
        suggestions: [...keywordItems, ...snippetItems],
      };
    },
  });
}

export function EditorPanel() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { openFiles, activeFilePath, updateFileContent } = useIDEStore();

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    registerAiroLanguage(monaco);
    monaco.editor.setTheme('airo-dark');

    // Set editor options
    editor.updateOptions({
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      fontLigatures: true,
      minimap: { enabled: true },
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      padding: { top: 8 },
      wordWrap: 'on',
      tabSize: 4,
      insertSpaces: true,
    });
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeFilePath && value !== undefined) {
        updateFileContent(activeFilePath, value);
      }
    },
    [activeFilePath, updateFileContent]
  );

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <div className="text-6xl">🤖</div>
          <h2 className="text-xl font-light">Airone IDE</h2>
          <p className="text-sm text-muted-foreground/60">
            Open a file from the Explorer to start coding
          </p>
          <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground/40">
            <span>Quick start: Ctrl+N New Sketch</span>
            <span>Ctrl+S Save &bull; Ctrl+B Compile &bull; Ctrl+U Flash</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={activeFile.language}
        value={activeFile.content}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="airo-dark"
        path={activeFile.path}
        loading={
          <div className="flex h-full items-center justify-center bg-[#1e1e1e] text-muted-foreground">
            Loading editor...
          </div>
        }
        options={{
          fontSize: 14,
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          bracketPairColorization: { enabled: true },
          padding: { top: 8 },
          wordWrap: 'on',
          tabSize: 4,
        }}
      />
    </div>
  );
}
