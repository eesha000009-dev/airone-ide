"""
AST Node definitions for the Airo Compiler.

All AST nodes are proper classes with typed fields, replacing the
dict-based AST from the original compiler.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional, Union, Any


# ── Base ──────────────────────────────────────────────────────────────

@dataclass
class ASTNode:
    """Base class for all AST nodes."""
    line: int = 0
    col: int = 0

    def __repr__(self) -> str:
        fields = {k: v for k, v in self.__dict__.items() if v != getattr(self.__class__, k, None)}
        args = ", ".join(f"{k}={v!r}" for k, v in fields.items() if k not in ("line", "col"))
        return f"{self.__class__.__name__}({args})"


# ── Top-level ─────────────────────────────────────────────────────────

@dataclass
class Program(ASTNode):
    """Root node of an .airo program."""
    brain_url: Optional[str] = None
    imports: List[ImportStatement] = field(default_factory=list)
    pin_definitions: List[PinDef] = field(default_factory=list)
    aliases: List[AliasAssignment] = field(default_factory=list)
    variables: List[VariableAssignment] = field(default_factory=list)
    init_block: Optional[InitBlock] = None
    loop: Optional[LoopBlock] = None
    safety_rules: List[ConditionalBlock] = field(default_factory=list)


# ── Imports ───────────────────────────────────────────────────────────

@dataclass
class ImportStatement(ASTNode):
    """call body/sight/eyes.airo."""
    module_path: str = ""


# ── Pin Definitions ───────────────────────────────────────────────────

@dataclass
class PinDef(ASTNode):
    """Single pin definition: ledpin = 2; output."""
    name: str = ""
    number: int = 0
    mode: str = ""  # "input" or "output"
    sensor_type: Optional[str] = None  # auto-detected or annotated


# ── Assignments ───────────────────────────────────────────────────────

@dataclass
class VariableAssignment(ASTNode):
    """Simple variable assignment: brain_url = "wss://..."."""
    name: str = ""
    value: Union[str, int, float] = ""


@dataclass
class AliasAssignment(ASTNode):
    """Path alias: body/sight/eyes.airo = eyes."""
    module_path: str = ""
    short_name: str = ""


# ── Init Block ────────────────────────────────────────────────────────

@dataclass
class InitBlock(ASTNode):
    """init { ... } block – runs once at startup."""
    statements: List[ASTNode] = field(default_factory=list)


# ── Loop Block ────────────────────────────────────────────────────────

@dataclass
class LoopBlock(ASTNode):
    """Main execution loop."""
    read_for: Optional[ReadForBlock] = None
    senddatato: Optional[SendDataTo] = None
    actfor: Optional[ActForBlock] = None
    statements: List[ASTNode] = field(default_factory=list)


@dataclass
class ReadForBlock(ASTNode):
    """read_for(1000) { temperature. eyes. }"""
    duration_ms: int = 1000
    sensors: List[str] = field(default_factory=list)


@dataclass
class SendDataTo(ASTNode):
    """senddatato(brain_url)."""
    target: str = "brain_url"


@dataclass
class ActForBlock(ASTNode):
    """actfor(1000) { ledpin. urhands. }"""
    duration_ms: int = 1000
    outputs: List[str] = field(default_factory=list)


# ── Conditionals ──────────────────────────────────────────────────────

@dataclass
class Condition(ASTNode):
    """A comparison or boolean expression."""
    left: str = ""
    operator: str = ""  # >, <, >=, <=, ==, !=
    right: Union[str, int, float] = ""


@dataclass
class ConditionalBlock(ASTNode):
    """if condition; { ... } else; { ... }"""
    condition: Optional[Condition] = None
    if_body: List[ASTNode] = field(default_factory=list)
    else_body: List[ASTNode] = field(default_factory=list)


# ── Actions inside blocks ─────────────────────────────────────────────

@dataclass
class ActionStatement(ASTNode):
    """A standalone action: digitalwrite(ledpin, on)."""
    function_name: str = ""
    args: List[Any] = field(default_factory=list)


@dataclass
class AskStatement(ASTNode):
    """ask(what is this, what should i do?) – query the brain for a decision."""
    question: str = ""
    context: str = ""


@dataclass
class SaveToStatement(ASTNode):
    """saveto(variable, value) – persist a value to EEPROM/preferences."""
    variable: str = ""
    value: str = ""


# ── Utility ───────────────────────────────────────────────────────────

def program_to_dict(program: Program) -> dict:
    """Convert the AST to a plain dict (useful for debugging / JSON export)."""

    def _node_to_dict(node):
        if isinstance(node, ASTNode):
            result = {"_type": node.__class__.__name__}
            for k, v in node.__dict__.items():
                if k in ("line", "col"):
                    continue
                if isinstance(v, list):
                    result[k] = [_node_to_dict(item) for item in v]
                elif isinstance(v, ASTNode):
                    result[k] = _node_to_dict(v)
                else:
                    result[k] = v
            return result
        return node

    return _node_to_dict(program)
