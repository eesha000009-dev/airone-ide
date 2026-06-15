"""
Airo Lexer - Tokenizes .airo source code into a token stream.

Improvements over v0.1:
  - Line and column tracking on every token
  - Block comment support (## ... ##)
  - New keywords: ask, saveto, init
  - Comparison operators (>, <, >=, <=, ==, !=)
  - Better error messages with source location
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List


# ── Token types ───────────────────────────────────────────────────────

KEYWORDS = frozenset({
    "call", "pin", "defi", "if", "else", "loop",
    "read", "read_for", "senddatato", "actfor",
    "ask", "saveto", "init",
})

MODES = frozenset({"input", "output"})

# Tokens are represented as dataclass instances for clarity.
@dataclass(frozen=True)
class Token:
    kind: str
    value: object
    line: int
    col: int

    def __repr__(self) -> str:
        return f"Token({self.kind}, {self.value!r}, L{self.line}:{self.col})"


# ── Lexer ─────────────────────────────────────────────────────────────

# Order matters: more specific patterns first.
TOKEN_SPEC = [
    ("COMMENT_BLOCK", r"##[\s\S]*?##"),
    ("COMMENT_LINE",  r"#[^\n]*"),
    ("KEYWORD",       r"\b(?:call|pin|defi|if|else|loop|read_for|read|senddatato|actfor|ask|saveto|init)\b"),
    ("MODE",          r"\b(?:input|output)\b"),
    ("NUMBER",        r"\d+(?:\.\d+)?"),
    ("STRING",        r'"[^"]*"'),
    ("IDENTIFIER",    r"[a-zA-Z_][a-zA-Z0-9_-]*"),
    ("GTE",           r">="),
    ("LTE",           r"<="),
    ("EQ",            r"=="),
    ("NEQ",           r"!="),
    ("GT",            r">"),
    ("LT",            r"<"),
    ("ASSIGN",        r"="),
    ("SEMICOLON",     r";"),
    ("PERIOD",        r"\."),
    ("LBRACE",        r"\{"),
    ("RBRACE",        r"\}"),
    ("LPAREN",        r"\("),
    ("RPAREN",        r"\)"),
    ("COMMA",         r","),
    ("COLON",         r":"),
    ("SLASH",         r"/"),
    ("WS",            r"[ \t\n\r]+"),
    ("MISMATCH",      r"."),
]


class AiroLexer:
    """Tokenizes .airo source code."""

    def __init__(self, source: str, filename: str = "<input>"):
        self.source = source
        self.filename = filename
        self.tokens: List[Token] = []
        self.errors: List[str] = []

    def tokenize(self) -> List[Token]:
        """Run the lexer and return a list of tokens."""
        self.tokens = []
        self.errors = []

        # Build a single regex with named groups
        pattern = "|".join(
            f"(?P<{name}>{pat})" for name, pat in TOKEN_SPEC
        )
        regex = re.compile(pattern)

        for match in regex.finditer(self.source):
            kind = match.lastgroup
            value = match.group()

            # Compute line / column
            line = self.source[:match.start()].count("\n") + 1
            col = match.start() - self.source[:match.start()].rfind("\n")

            if kind == "WS" or kind in ("COMMENT_BLOCK", "COMMENT_LINE"):
                continue
            elif kind == "NUMBER":
                value = float(value) if "." in value else int(value)
            elif kind == "STRING":
                value = value  # keep quotes; parser strips them
            elif kind == "KEYWORD":
                pass  # value stays as the keyword string
            elif kind == "MISMATCH":
                self.errors.append(
                    f"{self.filename}:{line}:{col}: unexpected character {value!r}"
                )
                continue

            self.tokens.append(Token(kind, value, line, col))

        # Append EOF sentinel
        if self.source:
            last_line = self.source.count("\n") + 1
        else:
            last_line = 1
        self.tokens.append(Token("EOF", None, last_line, 1))

        return self.tokens
