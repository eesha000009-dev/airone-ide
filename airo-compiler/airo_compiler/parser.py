"""
Airo Parser - Builds an AST from a token stream.

Improvements over v0.1:
  - Uses AST node classes instead of dicts
  - Supports init {} blocks
  - Supports ask() statements
  - Supports saveto() statements
  - Supports if/else conditionals with proper condition parsing
  - Proper error recovery
  - Better error messages with line numbers
"""

from __future__ import annotations

from typing import List, Optional

from .lexer import Token
from .ast_nodes import (
    Program, ImportStatement, PinDef, VariableAssignment, AliasAssignment,
    InitBlock, LoopBlock, ReadForBlock, SendDataTo, ActForBlock,
    Condition, ConditionalBlock, ActionStatement, AskStatement,
    SaveToStatement, ASTNode,
)


class ParseError(Exception):
    """Raised when the parser encounters invalid syntax."""

    def __init__(self, message: str, token: Optional[Token] = None):
        self.token = token
        if token:
            super().__init__(f"L{token.line}:{token.col}: {message}")
        else:
            super().__init__(message)


class AiroParser:
    """Parses a token list into a Program AST."""

    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.pos = 0
        self.errors: List[ParseError] = []

    # ── Helpers ───────────────────────────────────────────────────────

    def current(self) -> Token:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return Token("EOF", None, 0, 0)

    def peek(self, offset: int = 1) -> Token:
        idx = self.pos + offset
        if idx < len(self.tokens):
            return self.tokens[idx]
        return Token("EOF", None, 0, 0)

    def advance(self) -> Token:
        tok = self.current()
        self.pos += 1
        return tok

    def expect(self, kind: str, value=None) -> Token:
        tok = self.current()
        if tok.kind != kind:
            raise ParseError(
                f"Expected {kind}, got {tok.kind} ({tok.value!r})", tok
            )
        if value is not None and tok.value != value:
            raise ParseError(
                f"Expected {kind} '{value}', got '{tok.value}'", tok
            )
        return self.advance()

    def match(self, kind: str, value=None) -> Optional[Token]:
        tok = self.current()
        if tok.kind == kind and (value is None or tok.value == value):
            return self.advance()
        return None

    # ── Top-level ─────────────────────────────────────────────────────

    def parse(self) -> Program:
        program = Program()

        while self.current().kind != "EOF":
            try:
                self._parse_top_level(program)
            except ParseError as e:
                self.errors.append(e)
                # Error recovery: skip to next statement boundary
                self._recover()

        return program

    def _recover(self):
        """Skip tokens until we find a likely statement boundary."""
        while self.current().kind not in ("EOF", "PERIOD", "RBRACE"):
            self.advance()
        # Consume the boundary token if it's a period
        if self.current().kind == "PERIOD":
            self.advance()

    def _parse_top_level(self, program: Program):
        tok = self.current()

        if tok.kind == "KEYWORD":
            if tok.value == "call":
                program.imports.append(self._parse_call())
            elif tok.value == "pin":
                pin_defs = self._parse_pin_defi()
                program.pin_definitions.extend(pin_defs)
            elif tok.value == "loop":
                program.loop = self._parse_loop()
            elif tok.value == "init":
                program.init_block = self._parse_init()
            elif tok.value == "if":
                cond = self._parse_if()
                program.safety_rules.append(cond)
            else:
                # Unknown top-level keyword – skip it
                self.advance()
        elif tok.kind == "IDENTIFIER":
            self._parse_identifier_statement(program)
        else:
            self.advance()

    # ── call statement ────────────────────────────────────────────────

    def _parse_call(self) -> ImportStatement:
        tok = self.expect("KEYWORD", "call")
        node = ImportStatement(line=tok.line, col=tok.col)

        # Special: call brain_url.
        if self.current().kind == "IDENTIFIER" and self.current().value == "brain_url":
            self.advance()  # consume brain_url
            self.expect("PERIOD")
            node.module_path = "brain_url"
            return node

        # Regular: call body/sight/eyes.airo.
        parts = [self.expect("IDENTIFIER").value]
        while self.current().kind == "SLASH":
            self.advance()
            parts.append("/")
            parts.append(self.expect("IDENTIFIER").value)

        if self.current().kind == "PERIOD":
            self.advance()
            if self.current().kind == "IDENTIFIER":
                parts.append(".")
                parts.append(self.expect("IDENTIFIER").value)

        self.expect("PERIOD")
        node.module_path = "".join(parts)
        return node

    # ── pin defi block ────────────────────────────────────────────────

    def _parse_pin_defi(self) -> List[PinDef]:
        tok = self.expect("KEYWORD", "pin")
        # "defi" is a keyword in the lexer, so accept it as either KEYWORD or IDENTIFIER
        cur = self.current()
        if cur.kind == "KEYWORD" and cur.value == "defi":
            self.advance()
        elif cur.kind == "IDENTIFIER" and cur.value == "defi":
            self.advance()
        else:
            raise ParseError(f"Expected 'defi' after 'pin', got {cur.kind} ({cur.value!r})", cur)
        self.expect("LBRACE")

        defs: List[PinDef] = []
        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            pin_name = self.expect("IDENTIFIER").value
            self.expect("ASSIGN")
            pin_number = self.expect("NUMBER").value
            self.expect("SEMICOLON")
            mode = self.expect("MODE").value
            self.expect("PERIOD")
            defs.append(PinDef(
                line=tok.line, col=tok.col,
                name=pin_name, number=int(pin_number), mode=mode,
            ))

        self.expect("RBRACE")
        return defs

    # ── Identifier-level statements ───────────────────────────────────

    def _parse_identifier_statement(self, program: Program):
        """Handle identifier-starting statements: assignments and aliases."""
        start = self.current()

        # Read the left-hand side, which may be a path like body/sight/eyes.airo
        parts = [self.expect("IDENTIFIER").value]
        is_path = False

        while self.current().kind in ("SLASH", "PERIOD"):
            if self.current().kind == "SLASH":
                self.advance()
                parts.append("/")
                parts.append(self.expect("IDENTIFIER").value)
                is_path = True
            elif self.current().kind == "PERIOD":
                # Peek: is the next token an identifier (part of path like .airo)
                # or something else (statement-ending period)?
                self.advance()
                if self.current().kind == "IDENTIFIER" and self.peek().kind in ("SLASH", "ASSIGN"):
                    parts.append(".")
                    parts.append(self.expect("IDENTIFIER").value)
                    is_path = True
                else:
                    # This was the statement-ending period; put it back conceptually
                    self.pos -= 1
                    break

        full_name = "".join(parts)

        # If next is ASSIGN, it's an assignment or alias
        if self.current().kind == "ASSIGN":
            self.advance()
            value = self._parse_value()
            self.expect("PERIOD")

            if full_name == "brain_url":
                program.brain_url = value if isinstance(value, str) else str(value)
                program.variables.append(VariableAssignment(
                    line=start.line, col=start.col,
                    name="brain_url", value=value,
                ))
            elif is_path:
                # Alias: body/sight/eyes.airo = eyes.
                program.aliases.append(AliasAssignment(
                    line=start.line, col=start.col,
                    module_path=full_name, short_name=str(value),
                ))
            else:
                program.variables.append(VariableAssignment(
                    line=start.line, col=start.col,
                    name=full_name, value=value,
                ))
        else:
            # Not an assignment; might be a standalone reference or error.
            # Just consume the terminating period if present.
            if self.current().kind == "PERIOD":
                self.advance()

    def _parse_value(self):
        """Parse a value (string, number, or identifier)."""
        tok = self.current()
        if tok.kind == "STRING":
            self.advance()
            return tok.value.strip('"')
        elif tok.kind == "NUMBER":
            self.advance()
            return tok.value
        elif tok.kind == "IDENTIFIER":
            self.advance()
            return tok.value
        else:
            raise ParseError(f"Expected a value, got {tok.kind} ({tok.value!r})", tok)

    # ── init block ────────────────────────────────────────────────────

    def _parse_init(self) -> InitBlock:
        tok = self.expect("KEYWORD", "init")
        self.expect("LBRACE")

        stmts: List[ASTNode] = []
        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            stmts.append(self._parse_inner_statement())

        self.expect("RBRACE")
        return InitBlock(line=tok.line, col=tok.col, statements=stmts)

    # ── loop block ────────────────────────────────────────────────────

    def _parse_loop(self) -> LoopBlock:
        tok = self.expect("KEYWORD", "loop")
        self.expect("LBRACE")

        loop = LoopBlock(line=tok.line, col=tok.col)

        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            inner = self.current()
            if inner.kind == "KEYWORD":
                if inner.value == "read_for":
                    loop.read_for = self._parse_read_for()
                elif inner.value == "senddatato":
                    loop.senddatato = self._parse_senddatato()
                elif inner.value == "actfor":
                    loop.actfor = self._parse_actfor()
                elif inner.value == "if":
                    loop.statements.append(self._parse_if())
                elif inner.value == "ask":
                    loop.statements.append(self._parse_ask())
                else:
                    self.advance()
            else:
                self.advance()

        self.expect("RBRACE")
        return loop

    def _parse_read_for(self) -> ReadForBlock:
        tok = self.expect("KEYWORD", "read_for")
        self.expect("LPAREN")
        duration = self.expect("NUMBER").value
        self.expect("RPAREN")
        self.expect("LBRACE")

        sensors: List[str] = []
        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            sensors.append(self.expect("IDENTIFIER").value)
            self.expect("PERIOD")

        self.expect("RBRACE")
        return ReadForBlock(
            line=tok.line, col=tok.col,
            duration_ms=int(duration), sensors=sensors,
        )

    def _parse_senddatato(self) -> SendDataTo:
        tok = self.expect("KEYWORD", "senddatato")
        self.expect("LPAREN")
        target = self.expect("IDENTIFIER").value
        self.expect("RPAREN")
        self.expect("PERIOD")
        return SendDataTo(line=tok.line, col=tok.col, target=target)

    def _parse_actfor(self) -> ActForBlock:
        tok = self.expect("KEYWORD", "actfor")
        self.expect("LPAREN")
        duration = self.expect("NUMBER").value
        self.expect("RPAREN")
        self.expect("LBRACE")

        outputs: List[str] = []
        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            outputs.append(self.expect("IDENTIFIER").value)
            self.expect("PERIOD")

        self.expect("RBRACE")
        return ActForBlock(
            line=tok.line, col=tok.col,
            duration_ms=int(duration), outputs=outputs,
        )

    # ── Conditionals ──────────────────────────────────────────────────

    def _parse_if(self) -> ConditionalBlock:
        tok = self.expect("KEYWORD", "if")
        condition = self._parse_condition()
        self.expect("SEMICOLON")
        self.expect("LBRACE")

        if_body: List[ASTNode] = []
        while self.current().kind != "RBRACE" and self.current().kind != "EOF":
            if_body.append(self._parse_inner_statement())

        self.expect("RBRACE")

        else_body: List[ASTNode] = []
        if self.match("KEYWORD", "else"):
            self.expect("SEMICOLON")
            self.expect("LBRACE")
            while self.current().kind != "RBRACE" and self.current().kind != "EOF":
                else_body.append(self._parse_inner_statement())
            self.expect("RBRACE")

        return ConditionalBlock(
            line=tok.line, col=tok.col,
            condition=condition, if_body=if_body, else_body=else_body,
        )

    def _parse_condition(self) -> Condition:
        """Parse: identifier operator value"""
        left = self.current().value
        if self.current().kind == "IDENTIFIER":
            self.advance()
        else:
            raise ParseError(
                f"Expected identifier in condition, got {self.current().kind}",
                self.current(),
            )

        # Operator
        op_tok = self.current()
        if op_tok.kind in ("GT", "LT", "GTE", "LTE", "EQ", "NEQ"):
            op = op_tok.value if isinstance(op_tok.value, str) else op_tok.kind
            self.advance()
        elif op_tok.kind == "ASSIGN":
            # Single = in conditions is treated as ==
            op = "=="
            self.advance()
        else:
            # Default: treat as truthy check
            return Condition(line=left.line if hasattr(left, 'line') else 0,
                             col=0, left=str(left), operator="!=", right="0")

        right = self._parse_value()
        return Condition(left=str(left), operator=op, right=right)

    # ── Inner statements (inside init, if, etc.) ─────────────────────

    def _parse_inner_statement(self) -> ASTNode:
        tok = self.current()

        if tok.kind == "KEYWORD":
            if tok.value == "ask":
                return self._parse_ask()
            elif tok.value == "saveto":
                return self._parse_saveto()
            elif tok.value == "if":
                return self._parse_if()
            elif tok.value == "read":
                # Simple read statement
                self.advance()
                sensor = self.expect("IDENTIFIER").value
                self.expect("PERIOD")
                return ActionStatement(
                    line=tok.line, col=tok.col,
                    function_name="read", args=[sensor],
                )
            else:
                self.advance()
                return ActionStatement(line=tok.line, col=tok.col)

        elif tok.kind == "IDENTIFIER":
            # Could be: digitalwrite(ledpin, on). or similar function call
            name = self.advance().value

            # Check for function call: name(args)
            if self.current().kind == "LPAREN":
                return self._parse_function_call(tok, name)
            else:
                # Standalone identifier with period
                if self.current().kind == "PERIOD":
                    self.advance()
                return ActionStatement(
                    line=tok.line, col=tok.col,
                    function_name="reference", args=[name],
                )
        else:
            self.advance()
            return ActionStatement(line=tok.line, col=tok.col)

    def _parse_function_call(self, tok: Token, name: str) -> ActionStatement:
        """Parse: function_name(arg1, arg2)."""
        self.expect("LPAREN")
        args = []
        while self.current().kind != "RPAREN" and self.current().kind != "EOF":
            args.append(self._parse_value())
            if self.current().kind == "COMMA":
                self.advance()
        self.expect("RPAREN")
        self.expect("PERIOD")
        return ActionStatement(
            line=tok.line, col=tok.col,
            function_name=name, args=args,
        )

    # ── ask statement ─────────────────────────────────────────────────

    def _parse_ask(self) -> AskStatement:
        tok = self.expect("KEYWORD", "ask")
        self.expect("LPAREN")
        question = self._parse_value()
        context = ""
        if self.current().kind == "COMMA":
            self.advance()
            context = self._parse_value()
        self.expect("RPAREN")
        self.expect("PERIOD")
        return AskStatement(
            line=tok.line, col=tok.col,
            question=str(question), context=str(context),
        )

    # ── saveto statement ──────────────────────────────────────────────

    def _parse_saveto(self) -> SaveToStatement:
        tok = self.expect("KEYWORD", "saveto")
        self.expect("LPAREN")
        variable = self._parse_value()
        self.expect("COMMA")
        value = self._parse_value()
        self.expect("RPAREN")
        self.expect("PERIOD")
        return SaveToStatement(
            line=tok.line, col=tok.col,
            variable=str(variable), value=str(value),
        )
