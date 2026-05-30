/* ─── Airone IDE Mobile — .airo Language Definition for Monaco ──────────── */

export function registerAiroLanguage(monaco: typeof import('monaco-editor')): void {
  // Register the .airo language
  monaco.languages.register({ id: 'airo', extensions: ['.airo'], aliases: ['Airo', 'airo'] });

  // Language tokens
  monaco.languages.setMonarchTokensProvider('airo', {
    keywords: [
      'setup', 'loop', 'function', 'return', 'if', 'else', 'elif',
      'for', 'while', 'break', 'continue', 'import', 'from', 'as',
      'class', 'extends', 'new', 'this', 'super', 'try', 'catch',
      'finally', 'throw', 'async', 'await', 'yield', 'let', 'const',
      'var', 'true', 'false', 'null', 'undefined', 'void', 'typeof',
      'instanceof', 'in', 'of', 'delete', 'export', 'default',
      // .airo-specific keywords
      'pin', 'analog', 'digital', 'serial', 'motor', 'servo',
      'sensor', 'robot', 'move', 'turn', 'stop', 'speed',
      'forward', 'backward', 'left', 'right', 'delay',
      'begin', 'end', 'read', 'write', 'print', 'println',
      'high', 'low', 'input', 'output', 'input_pullup',
      'on', 'off', 'toggle', 'pulse', 'map', 'constrain',
      'attach', 'detach', 'send', 'receive', 'broadcast',
      'connect', 'disconnect', 'wifi', 'bluetooth',
      'interrupt', 'trigger', 'event', 'handler',
      'state', 'transition', 'action', 'guard',
      'component', 'module', 'config', 'param',
      'board', 'esp32', 'esp8266'
    ],

    typeKeywords: [
      'int', 'float', 'double', 'bool', 'string', 'char',
      'byte', 'long', 'short', 'unsigned', 'signed',
      'array', 'list', 'dict', 'map', 'set', 'tuple',
      'void', 'any', 'never', 'unknown'
    ],

    operators: [
      '=', '>', '<', '!', '~', '?', ':',
      '==', '<=', '>=', '!=', '&&', '||', '??',
      '+', '-', '*', '/', '%', '**',
      '+=', '-=', '*=', '/=', '%=',
      '&', '|', '^', '<<', '>>',
      '++', '--'
    ],

    symbols: /[=><!~?:&|+\-*/^%]+/,

    tokenizer: {
      root: [
        // Identifiers and keywords
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier'
          }
        }],

        // Whitespace
        { include: '@whitespace' },

        // Numbers
        [/\d*\.\d+([eE][+-]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/0[bB][01]+/, 'number.binary'],
        [/\d+/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
        [/'([^'\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],

        // Decorators
        [/@[a-zA-Z_]\w*/, 'annotation'],

        // Delimiters
        [/[{}()[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],

        // Operators
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': ''
          }
        }]
      ],

      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop']
      ],

      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop']
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment']
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment']
      ]
    }
  });

  // Language configuration (bracket matching, auto-closing, etc.)
  monaco.languages.setLanguageConfiguration('airo', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/']
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '/*', close: ' */', notIn: ['string'] }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    folding: {
      markers: {
        start: /^\s*\/\/\s*#?region\b/,
        end: /^\s*\/\/\s*#?endregion\b/
      }
    },
    indentationRules: {
      increaseIndentPattern: /[{(]\s*$/,
      decreaseIndentPattern: /^\s*[)}]/
    }
  });

  // Completion provider
  monaco.languages.registerCompletionItemProvider('airo', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions: any[] = [
        // Setup and Loop — core .airo structure
        {
          label: 'setup',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'setup() {\n\t$0\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Setup function — runs once at startup'
        },
        {
          label: 'loop',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'loop() {\n\t$0\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Loop function — runs repeatedly'
        },
        // Pin operations
        {
          label: 'pinMode',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'pinMode(${1:pin}, ${2:mode})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Configure pin mode (input/output)'
        },
        {
          label: 'digitalWrite',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'digitalWrite(${1:pin}, ${2:value})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Write digital value to pin'
        },
        {
          label: 'digitalRead',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'digitalRead(${1:pin})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Read digital value from pin'
        },
        {
          label: 'analogWrite',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'analogWrite(${1:pin}, ${2:value})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Write analog (PWM) value to pin'
        },
        {
          label: 'analogRead',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'analogRead(${1:pin})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Read analog value from pin'
        },
        // Serial
        {
          label: 'Serial.begin',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'Serial.begin(${1:9600})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Initialize serial communication'
        },
        {
          label: 'Serial.println',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'Serial.println($0)',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Print line to serial'
        },
        // Motor
        {
          label: 'motor',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'motor ${1:m1} = motor(${2:pin1}, ${3:pin2})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Declare a motor'
        },
        // Servo
        {
          label: 'servo',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'servo ${1:s1} = servo(${2:pin})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Declare a servo'
        },
        // Delay
        {
          label: 'delay',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'delay(${1:1000})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Delay in milliseconds'
        },
        // WiFi
        {
          label: 'wifi.connect',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'wifi.connect("${1:ssid}", "${2:password}")',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Connect to WiFi'
        }
      ];

      return { suggestions };
    }
  });
}

// Default sketch template
export const DEFAULT_SKETCH = `// Airone IDE — Sketch Template
// Write your .airo robotics code here

setup() {
    // Initialize pins and peripherals
    Serial.begin(115200);
    pinMode(2, output);
    Serial.println("Airone IDE ready!");
}

loop() {
    // Main loop — runs continuously
    digitalWrite(2, high);
    delay(1000);
    digitalWrite(2, low);
    delay(1000);
}
`;
