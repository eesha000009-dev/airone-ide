# Airo Compiler

Converts `.airo` source files to C++ firmware for ESP32 microcontrollers.

Part of the [Airone System](https://github.com/airone-project) – a unified language for AI-driven robotics.

## Installation

```bash
pip install -r requirements.txt
pip install -e .
```

## Usage

### Compile an .airo file

```bash
python -m airo_compiler input.airo --target esp32 --output firmware/
```

### Print the new robot template

```bash
python -m airo_compiler --template > my_robot.airo
```

### With WiFi credentials

```bash
python -m airo_compiler robot.airo --target esp32 --output firmware/ \
    --wifi-ssid "MyNetwork" --wifi-pass "MyPassword"
```

### Verbose output (includes AST dump)

```bash
python -m airo_compiler robot.airo --target esp32 -v
```

## Architecture

```
airo-compiler/
├── airo_compiler/
│   ├── __init__.py       # Package init
│   ├── __main__.py       # python -m entry point
│   ├── cli.py            # Command-line interface
│   ├── lexer.py          # Tokenizer with line/column tracking
│   ├── parser.py         # AST builder with proper node classes
│   ├── ast_nodes.py      # AST node definitions (dataclasses)
│   ├── safety.py         # Safety validation and injection
│   ├── brain_client.py   # Brain URL parsing and client generation
│   └── codegen/
│       ├── __init__.py   # Code generator registry
│       ├── base.py       # Base code generator (Jinja2)
│       ├── esp32.py      # ESP32 C++ code generator
│       └── stm32.py      # STM32 stub (not yet implemented)
├── templates/            # Jinja2 templates for C++ output
│   ├── esp32_main.cpp.j2
│   ├── esp32_pins.h.j2
│   ├── esp32_sensors.h.j2
│   ├── esp32_commands.h.j2
│   ├── esp32_safety.h.j2
│   └── esp32_brain.h.j2
├── requirements.txt
├── setup.py
└── README.md
```

## Generated Output

The compiler produces multiple C++ files:

| File | Purpose |
|------|---------|
| `main.cpp` | Main loop with WebSocket client (SENSE → THINK → ACT → SAFETY) |
| `pin_map.h` | Pin definitions and servo objects |
| `sensor_reader.h` | Sensor reading functions with auto-detected types |
| `command_executor.h` | Brain command execution (sandboxed to actfor list) |
| `safety_monitor.h` | Hard safety checks (unmodifiable by brain) |
| `brain_client.h` | WebSocket communication with reconnection |

## Supported Sensor Types

| Sensor | Auto-detected from name | C++ Function |
|--------|------------------------|--------------|
| DHT22 temperature | `temperature`, `temp` | `dht.readTemperature()` |
| HC-SR04 ultrasonic | `ultrasonic` | `pulseIn()` based |
| OV2640 camera | `camera` | Camera capture (stub) |
| I2S microphone | `microphone`, `mic` | I2S read (stub) |
| Analog input | default for input pins | `analogRead()` |
| Digital input | - | `digitalRead()` |

## Language Features

- `call` – Import body modules
- `pin defi {}` – Hardware pin definitions
- `brain_url = "wss://..."` – Brain connection
- `init {}` – Initialization block (runs once)
- `loop {}` – Main execution loop
- `read_for(ms) {}` – Sensor reading phase
- `senddatato(brain_url)` – Send data to brain
- `actfor(ms) {}` – Command execution phase (sandboxed)
- `ask(question, context)` – Query the brain for a decision
- `saveto(variable, value)` – Persist values
- `if condition; {} else; {}` – Conditionals
- `## block comments ##` – Block comments
- `# line comments` – Line comments

## Safety

The compiler enforces three layers of safety:

1. **Compile-time**: Pin conflicts, mode mismatches, missing brain_url
2. **Runtime sandbox**: Only actfor-listed modules can be controlled by brain
3. **Hard safety**: Emergency stop on overheat/proximity, watchdog timer, brain timeout

These cannot be overridden by the brain.
