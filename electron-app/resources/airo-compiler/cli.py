#!/usr/bin/env python3
"""
Airo Compiler CLI - Command-line interface.

Usage:
    python -m airo_compiler input.airo --target esp32 --output firmware/
    python -m airo_compiler --template
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .lexer import AiroLexer
from .parser import AiroParser
from .safety import SafetyValidator
from .codegen import get_generator


# ── Permanent .airo template ──────────────────────────────────────────

AIRO_TEMPLATE = r'''# ============================================
# AIRONE ROBOT CONFIGURATION
# ============================================

#library#
# Import body modules for your robot
# call body/actuation/upper-right-hands.airo.
# call body/sight/eyes.airo.
# call body/hearing/ears.airo.
# call body/speech/mouth.airo.
# call body/other_sensors/temperature.airo.

Pin defi {
    # pin_name = pin_number; mode.
    # mode: input (brings data in / senses) or output (makes action)
    ledpin = 2; output.
    # temperature_sensor = 35; input.
    # ultrasonic = 34; input.
    # servo_right = 13; output.
}

#variables#
# Brain URL — where your AI brain lives
brain_url = "wss://your-brain.local:8080".
call brain_url.

# Aliases (short names for body modules)
# body/sight/eyes.airo = eyes.
# body/hearing/ears.airo = ears.

# ============================================
# MAIN LOOP — The robot runs this forever
# SENSE → THINK → ACT
# ============================================
loop {
    # Phase 1: SENSE — Read all input sensors
    # Only place sensors/modules that bring in data or sense
    read_for(1000) {
        # temperature.
        # eyes.
        # ears.
    }

    # Phase 2: THINK — Send data to brain via WebSocket
    # The compiled C++ will send:
    # "Currently, the input sensors read:
    #  (sensor: value, ...),
    #  What do you want to do to:
    #  (output_module1, output_module2, ...)."
    # The AI brain reads this and responds with commands.
    senddatato(brain_url).

    # Phase 3: ACT — Execute brain commands
    # Only place output modules here (things that make actions)
    actfor(1000) {
        ledpin.
        # servo_right.
    }
}
'''


def print_template():
    """Print the permanent .airo template to stdout."""
    print(AIRO_TEMPLATE)


def compile_file(input_path: str, target: str, output_dir: str,
                 wifi_ssid: str = "YOUR_WIFI_SSID",
                 wifi_pass: str = "YOUR_WIFI_PASSWORD",
                 verbose: bool = False) -> int:
    """Compile an .airo file and return exit code (0 = success)."""
    # Read source
    source_path = Path(input_path)
    if not source_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        return 1

    with open(source_path, "r") as f:
        source = f.read()

    robot_name = source_path.stem
    print(f"Compiling {input_path}...")
    print(f"  Target: {target}")
    print(f"  Robot:  {robot_name}")

    # Tokenize
    lexer = AiroLexer(source, filename=str(source_path))
    tokens = lexer.tokenize()
    print(f"  Tokens: {len(tokens) - 1}")  # -1 for EOF sentinel

    if lexer.errors:
        for err in lexer.errors:
            print(f"  LEX ERROR: {err}", file=sys.stderr)
        return 1

    # Parse
    parser = AiroParser(tokens)
    program = parser.parse()
    print(f"  Imports: {len(program.imports)}")
    print(f"  Pins:    {len(program.pin_definitions)}")
    print(f"  Aliases: {len(program.aliases)}")

    if parser.errors:
        for err in parser.errors:
            print(f"  PARSE ERROR: {err}", file=sys.stderr)
        if not program.loop and not program.pin_definitions:
            return 1

    # Set robot name
    has_robot_name = False
    for var in program.variables:
        if var.name == "robot_name":
            has_robot_name = True
    if not has_robot_name:
        from .ast_nodes import VariableAssignment
        program.variables.append(VariableAssignment(name="robot_name", value=robot_name))

    # Safety validation
    validator = SafetyValidator()
    report = validator.validate(program)

    if report.has_errors:
        print("\n  SAFETY ERRORS:")
        print(str(report))
        return 1

    if report.warnings:
        print("\n  SAFETY WARNINGS:")
        for w in report.warnings:
            print(f"    WARN: {w.message}")

    # Generate code
    generator_cls = get_generator(target)
    generator = generator_cls(program, wifi_ssid=wifi_ssid, wifi_pass=wifi_pass)
    files = generator.generate()

    # Write output
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    for filename, content in files.items():
        filepath = out / filename
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w") as f:
            f.write(content)
        lines = content.count("\n") + 1
        print(f"  Generated: {filepath} ({lines} lines)")

    print(f"\n  Output directory: {out.resolve()}")
    print(f"\nTo flash to ESP32:")
    print(f"  1. Open {out / 'main.cpp'} in Arduino IDE")
    print(f"  2. Copy other .h files to the same sketch directory")
    print(f"  3. Select ESP32 board, click Upload")
    print(f"\nRequired libraries:")
    print(f"  - ArduinoWebsockets")
    print(f"  - ArduinoJson")
    print(f"  - ESP32Servo")
    print(f"  - DHT sensor library (if using temperature sensors)")

    if verbose:
        print(f"\n  AST dump:")
        from .ast_nodes import program_to_dict
        print(json.dumps(program_to_dict(program), indent=2, default=str))

    return 0


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="airo_compiler",
        description=f"Airo Compiler v{__version__} - .airo to C++ firmware compiler",
    )
    parser.add_argument(
        "input", nargs="?", default=None,
        help="Input .airo file to compile",
    )
    parser.add_argument(
        "--target", "-t", default="esp32",
        choices=["esp32", "stm32"],
        help="Target microcontroller platform (default: esp32)",
    )
    parser.add_argument(
        "--output", "-o", default="generated_firmware",
        help="Output directory for generated C++ (default: generated_firmware)",
    )
    parser.add_argument(
        "--wifi-ssid", default="YOUR_WIFI_SSID",
        help="WiFi SSID for robot firmware",
    )
    parser.add_argument(
        "--wifi-pass", default="YOUR_WIFI_PASSWORD",
        help="WiFi password for robot firmware",
    )
    parser.add_argument(
        "--template", action="store_true",
        help="Print the permanent .airo template to stdout",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Print detailed AST and debug info",
    )
    parser.add_argument(
        "--version", action="version",
        version=f"Airo Compiler v{__version__}",
    )

    args = parser.parse_args()

    if args.template:
        print_template()
        sys.exit(0)

    if args.input is None:
        parser.error("Input file required (use --template for new file template)")

    exit_code = compile_file(
        input_path=args.input,
        target=args.target,
        output_dir=args.output,
        wifi_ssid=args.wifi_ssid,
        wifi_pass=args.wifi_pass,
        verbose=args.verbose,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
