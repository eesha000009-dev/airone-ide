"""
Airo Compiler — .airo to C++ transpiler for ESP32/ESP8266

This is the bundled Python-based compiler for the Airone IDE.
It transpiles .airo files to C++ that can be compiled for ESP32 microcontrollers.

Usage:
    python -m airo_compiler <file.airo> --target esp32 --output <output_dir>
    python -m airo_compiler --template
"""

import sys
import os
import argparse
import json
from pathlib import Path


def get_template():
    """Return the default .airo sketch template."""
    return '''# ============================================
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
    senddatato(brain_url).

    # Phase 3: ACT — Execute brain commands
    # Only place output modules here (things that make actions)
    actfor(1000) {
        ledpin.
        # servo_right.
    }
}
'''


def parse_airo(content: str) -> dict:
    """Parse an .airo file and extract its structure."""
    result = {
        'libraries': [],
        'pin_definitions': [],
        'variables': [],
        'loop_content': '',
        'errors': []
    }

    lines = content.split('\n')
    section = 'header'

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        if stripped.startswith('#library#') or (stripped == '#library#'):
            section = 'library'
            continue
        elif stripped == '#variables#':
            section = 'variables'
            continue
        elif stripped.startswith('Pin defi'):
            section = 'pins'
            continue
        elif stripped.startswith('loop'):
            section = 'loop'
            continue

        if section == 'library':
            # Parse library imports
            if stripped.startswith('call ') and not stripped.startswith('#'):
                lib_path = stripped.replace('call ', '').rstrip('.')
                result['libraries'].append(lib_path)
        elif section == 'pins':
            # Parse pin definitions
            if '=' in stripped and not stripped.startswith('#') and stripped not in ['{', '}']:
                result['pin_definitions'].append(stripped.rstrip('.'))
        elif section == 'variables':
            # Parse variables
            if stripped and not stripped.startswith('#') and stripped not in ['{', '}']:
                result['variables'].append(stripped.rstrip('.'))
        elif section == 'loop':
            result['loop_content'] += line + '\n'

    return result


def transpile_to_cpp(parsed: dict, target: str = 'esp32') -> str:
    """Transpile parsed .airo structure to C++ code for ESP32."""

    # Generate includes
    includes = ['#include <Arduino.h>']
    for lib in parsed['libraries']:
        lib_name = lib.split('/')[-1].replace('.airo', '')
        includes.append(f'// #include "{lib_name}.h"  // {lib}')

    includes.append('')
    if target == 'esp8266':
        includes.append('#include <ESP8266WiFi.h>')
    else:
        includes.append('#include <WiFi.h>')
        includes.append('#include <WebSocketsClient.h>')
    includes.append('')

    # Generate pin definitions
    pin_defs = []
    pin_modes = []
    for pin_def in parsed['pin_definitions']:
        parts = pin_def.split('=')
        if len(parts) >= 2:
            name = parts[0].strip()
            rest = parts[1].strip()
            pin_parts = rest.split(';')
            if len(pin_parts) >= 2:
                pin_num = pin_parts[0].strip()
                mode = pin_parts[1].strip().upper()
                pin_defs.append(f'const int {name} = {pin_num};')
                pin_modes.append(f'    pinMode({name}, {mode});')

    # Generate variables
    var_defs = []
    for var in parsed['variables']:
        if '=' in var:
            parts = var.split('=', 1)
            name = parts[0].strip()
            value = parts[1].strip().rstrip('.')
            if value.startswith('"'):
                var_defs.append(f'String {name} = {value};')
            elif '.' in value and not value.startswith('0x'):
                var_defs.append(f'float {name} = {value};')
            else:
                var_defs.append(f'int {name} = {value};')
        elif var.startswith('call '):
            # Skip call statements in variables section
            pass

    # Generate loop content
    loop_content = parsed['loop_content']
    # Basic .airo to C++ transformation
    cpp_loop = loop_content
    cpp_loop = cpp_loop.replace('read_for(', 'for (unsigned long _start = millis(); millis() - _start < ')
    cpp_loop = cpp_loop.replace(') {', '); ) {')
    cpp_loop = cpp_loop.replace('actfor(', 'for (unsigned long _start = millis(); millis() - _start < ')
    cpp_loop = cpp_loop.replace('senddatato(', '// senddatato(')
    cpp_loop = cpp_loop.replace('ask ', 'if (')
    cpp_loop = cpp_loop.replace(' = HIGH.', ' = HIGH;')
    cpp_loop = cpp_loop.replace(' = LOW.', ' = LOW;')

    # Assemble C++ code
    cpp_code = '\n'.join(includes) + '\n'
    cpp_code += '\n'.join(pin_defs) + '\n\n'
    cpp_code += '\n'.join(var_defs) + '\n\n'

    # Setup function
    cpp_code += 'void setup() {\n'
    cpp_code += '    Serial.begin(115200);\n'
    for mode in pin_modes:
        cpp_code += mode + '\n'
    cpp_code += '}\n\n'

    # Loop function
    cpp_code += 'void loop() {\n'
    cpp_code += cpp_loop
    cpp_code += '}\n'

    return cpp_code


def compile_file(file_path: str, target: str = 'esp32', output_dir: str = 'build',
                 wifi_ssid: str = None, wifi_pass: str = None) -> int:
    """Compile an .airo file to C++."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        parsed = parse_airo(content)
        cpp_code = transpile_to_cpp(parsed, target)

        # Create output directory
        os.makedirs(output_dir, exist_ok=True)

        # Write C++ output
        base_name = Path(file_path).stem
        output_file = os.path.join(output_dir, f'{base_name}.cpp')
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(cpp_code)

        print(f'✓ Transpiled {file_path} -> {output_file}')
        print(f'  Target: {target}')
        print(f'  Libraries: {len(parsed["libraries"])}')
        print(f'  Pins: {len(parsed["pin_definitions"])}')
        print(f'  Variables: {len(parsed["variables"])}')

        # Output JSON result for machine consumption
        result = {
            'success': True,
            'output_file': output_file,
            'target': target,
            'libraries': parsed['libraries'],
            'pins': parsed['pin_definitions'],
            'variables': parsed['variables']
        }
        result_file = os.path.join(output_dir, f'{base_name}.result.json')
        with open(result_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)

        return 0

    except FileNotFoundError:
        print(f'✗ Error: File not found: {file_path}', file=sys.stderr)
        return 1
    except Exception as e:
        print(f'✗ Error: {str(e)}', file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser(
        description='Airo Compiler — .airo to C++ transpiler for ESP32/ESP8266'
    )
    parser.add_argument('file', nargs='?', help='Input .airo file')
    parser.add_argument('--target', default='esp32',
                        choices=['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp8266'],
                        help='Target board (default: esp32)')
    parser.add_argument('--output', default='build',
                        help='Output directory (default: build)')
    parser.add_argument('--template', action='store_true',
                        help='Print the default .airo template')
    parser.add_argument('--wifi-ssid', help='WiFi SSID for network features')
    parser.add_argument('--wifi-pass', help='WiFi password for network features')

    args = parser.parse_args()

    if args.template:
        print(get_template())
        return 0

    if not args.file:
        parser.print_help()
        return 1

    return compile_file(
        args.file,
        target=args.target,
        output_dir=args.output,
        wifi_ssid=args.wifi_ssid,
        wifi_pass=args.wifi_pass
    )


if __name__ == '__main__':
    sys.exit(main())
