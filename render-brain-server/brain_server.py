"""
Airone Brain Server — LNN-powered WebSocket brain for robots.

This is the cloud-deployed brain server. It loads an LNN model configuration
from the MODEL_CONFIG environment variable and runs inference via WebSocket.

The brain server IS the LNN. When a robot connects and sends sensor data,
the LNN processes the inputs and returns commands.

Environment Variables:
    MODEL_CONFIG  - JSON string with LNN model configuration
    ROBOT_NAME    - Name of the robot
    PORT          - Port to listen on (default: 10000)
    API_KEY       - Optional API key for authentication

Message Protocol:
    Robot → Brain: Natural language prompt format:
        "Currently, the input sensors read:
         (sensor_name: value, ...),
         What do you want to do to:
         (module1, module2, ...)."

    Or JSON:
        {"robot_id": "...", "input_sensors_read": {...}, "output_modules_available": [...]}

    Brain → Robot: JSON commands:
        {"command_id": "...", "output_commands": {"module": {"action": "...", "value": ...}}}
"""

import os
import sys
import json
import math
import random
import re
import asyncio
import logging
from datetime import datetime
from http import HTTPStatus

try:
    import websockets
except ImportError:
    print("ERROR: websockets package not installed. Run: pip install websockets")
    sys.exit(1)

# ─── Configuration ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('BrainServer')

MODEL_CONFIG_RAW = os.environ.get('MODEL_CONFIG', '{}')
ROBOT_NAME = os.environ.get('ROBOT_NAME', 'Unnamed')
PORT = int(os.environ.get('PORT', '10000'))
API_KEY = os.environ.get('API_KEY', '')

# Parse model configuration
try:
    MODEL_CONFIG = json.loads(MODEL_CONFIG_RAW)
    logger.info(f"Loaded model config: input_size={MODEL_CONFIG.get('input_size')}, "
                f"output_size={MODEL_CONFIG.get('output_size')}")
except json.JSONDecodeError as e:
    logger.error(f"Failed to parse MODEL_CONFIG: {e}")
    MODEL_CONFIG = {}

# ─── LNN Model (Liquid Neural Network) ─────────────────────────────────────

class LiquidNeuralNetwork:
    """
    Liquid Neural Network inference engine.
    
    Uses a CfC-inspired architecture with continuous-time dynamics.
    The network maintains hidden state across time steps, enabling temporal
    reasoning about sensor data streams.
    
    Pure Python implementation — no torch/ncps required.
    """

    def __init__(self, config: dict):
        self.input_size = config.get('input_size', 4)
        self.output_size = config.get('output_size', 4)
        self.hidden_units = config.get('hidden_units', 16)
        self.time_steps = config.get('time_steps', 1)
        self.neuron_params = config.get('neuron_params', {
            'vt': 0.1, 'dt': 0.01, 'sensitivity': 0.5
        })
        self.input_mapping = config.get('input_mapping', {})
        self.output_mapping = config.get('output_mapping', {})
        self.description = config.get('description', '')

        # Xavier initialization for stability
        limit_in = math.sqrt(6.0 / (self.input_size + self.hidden_units))
        limit_out = math.sqrt(6.0 / (self.hidden_units + self.output_size))

        random.seed(42)  # Reproducible
        self.weights_input = [[random.uniform(-limit_in, limit_in)
                               for _ in range(self.input_size)]
                              for _ in range(self.hidden_units)]
        self.weights_recurrent = [[random.uniform(-0.5, 0.5)
                                   for _ in range(self.hidden_units)]
                                  for _ in range(self.hidden_units)]
        self.weights_output = [[random.uniform(-limit_out, limit_out)
                                for _ in range(self.hidden_units)]
                               for _ in range(self.output_size)]

        # Hidden state (persists across time steps)
        self.hidden_state = [0.0] * self.hidden_units

        # Reverse mappings for encoding/decoding
        self.input_name_to_idx = {name: idx for name, idx in self.input_mapping.items()}
        self.idx_to_output_name = {idx: name for name, idx in self.output_mapping.items()}

        logger.info(f"LNN initialized: {self.input_size} inputs → "
                    f"{self.hidden_units} hidden → {self.output_size} outputs")
        logger.info(f"  Input mapping: {self.input_mapping}")
        logger.info(f"  Output mapping: {self.output_mapping}")
        if self.description:
            logger.info(f"  Description: {self.description}")

    def _sigmoid(self, x: float) -> float:
        if x >= 0:
            return 1.0 / (1.0 + math.exp(-x))
        else:
            ex = math.exp(x)
            return ex / (1.0 + ex)

    def _tanh(self, x: float) -> float:
        return math.tanh(x)

    def forward(self, input_values: list) -> list:
        """
        Run a forward pass through the LNN.
        
        Args:
            input_values: List of float values (length = input_size), normalized to [0, 1]
            
        Returns:
            List of float values (length = output_size), in range [0, 1]
        """
        vt = self.neuron_params.get('vt', 0.1)
        dt = self.neuron_params.get('dt', 0.01)
        sensitivity = self.neuron_params.get('sensitivity', 0.5)

        # Input layer
        input_contribution = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            for i in range(min(len(input_values), self.input_size)):
                input_contribution[h] += self.weights_input[h][i] * input_values[i]

        # Recurrent contribution
        recurrent_contribution = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            for j in range(self.hidden_units):
                recurrent_contribution[h] += self.weights_recurrent[h][j] * self.hidden_state[j]

        # Liquid neuron update: ODE-inspired continuous-time dynamics
        new_hidden = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            total_input = input_contribution[h] + recurrent_contribution[h]
            tau = vt + sensitivity * self._sigmoid(total_input)
            activation = self._tanh(total_input)
            new_hidden[h] = self.hidden_state[h] + dt * (activation - self.hidden_state[h]) / tau

        self.hidden_state = new_hidden

        # Output layer
        outputs = [0.0] * self.output_size
        for o in range(self.output_size):
            for h in range(self.hidden_units):
                outputs[o] += self.weights_output[o][h] * self.hidden_state[h]
            outputs[o] = self._sigmoid(outputs[o])

        return outputs

    def process_sensor_data(self, sensor_data: dict, output_modules: list) -> dict:
        """
        Process sensor data through the LNN and generate commands.
        
        Args:
            sensor_data: Dict mapping sensor names to values
            output_modules: List of output module names available
            
        Returns:
            Dict mapping module names to command objects
        """
        # Encode inputs to [0, 1] range
        input_values = [0.0] * self.input_size
        for name, idx in self.input_mapping.items():
            if name in sensor_data:
                val = sensor_data[name]
                if isinstance(val, (int, float)):
                    input_values[idx] = min(1.0, max(0.0, float(val) / 4095.0))
                elif isinstance(val, str):
                    try:
                        input_values[idx] = min(1.0, max(0.0, float(val) / 4095.0))
                    except (ValueError, TypeError):
                        pass

        # Run forward pass
        raw_outputs = self.forward(input_values)

        # Decode outputs to commands
        commands = {}
        for idx, name in self.idx_to_output_name.items():
            if idx < len(raw_outputs) and name in output_modules:
                output_val = raw_outputs[idx]
                if output_val > 0.7:
                    commands[name] = {"action": "digitalwrite", "value": 1}
                elif output_val < 0.3:
                    commands[name] = {"action": "digitalwrite", "value": 0}
                else:
                    angle = int(output_val * 180)
                    commands[name] = {"action": "servo", "angle": angle}

        return commands


# ─── Natural Language Prompt Parser ────────────────────────────────────────

def parse_natural_language_prompt(text: str) -> dict:
    """
    Parse the natural language prompt sent by the ESP32.
    
    Format:
        Currently, the input sensors read:
        (sensor_name: value, ...),
        What do you want to do to:
        (module1, module2, ...).
    """
    result = {
        'input_sensors_read': {},
        'output_modules_available': [],
        '_raw_prompt': text,
        '_format': 'natural_language'
    }

    # Extract input sensors
    sensors_match = re.search(
        r'Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)', text, re.IGNORECASE
    )
    if sensors_match:
        sensor_text = sensors_match.group(1).strip()
        if sensor_text and 'no input sensors' not in sensor_text.lower():
            for pair in sensor_text.split(','):
                pair = pair.strip()
                if ':' in pair:
                    key, *val_parts = pair.split(':')
                    val = ':'.join(val_parts).strip()
                    try:
                        val = float(val)
                    except (ValueError, TypeError):
                        pass
                    result['input_sensors_read'][key.strip()] = val

    # Extract output modules
    outputs_match = re.search(
        r'What do you want to do to:\s*\n?\s*\(([^)]*)\)', text, re.IGNORECASE
    )
    if outputs_match:
        output_text = outputs_match.group(1).strip()
        if output_text and 'no output modules' not in output_text.lower():
            result['output_modules_available'] = [
                m.strip().replace('.', '') for m in output_text.split(',') if m.strip()
            ]

    return result


# ─── WebSocket Handler ─────────────────────────────────────────────────────

# Initialize the LNN
lnn = LiquidNeuralNetwork(MODEL_CONFIG)

# Track connected clients
connected_clients = set()
command_counter = 0


async def handle_connection(websocket, path=None):
    """Handle a WebSocket connection from a robot."""
    global command_counter

    client_id = id(websocket)
    connected_clients.add(client_id)
    logger.info(f"Robot connected. Total connections: {len(connected_clients)}")

    try:
        async for message in websocket:
            try:
                raw = message if isinstance(message, str) else message.decode('utf-8')

                # Parse message (JSON or natural language)
                data = None
                try:
                    data = json.loads(raw)
                    if not isinstance(data, dict):
                        data = None
                except (json.JSONDecodeError, TypeError):
                    pass

                if data is None:
                    data = parse_natural_language_prompt(raw)

                sensor_data = data.get('input_sensors_read', {})
                output_modules = data.get('output_modules_available', [])

                # If no output modules specified, use output_mapping names
                if not output_modules:
                    output_modules = list(lnn.output_mapping.keys())

                logger.info(f"Received: {len(sensor_data)} sensors, {len(output_modules)} outputs")

                # Run LNN inference
                commands = lnn.process_sensor_data(sensor_data, output_modules)

                # Build response
                command_counter += 1
                response = {
                    "command_id": f"cmd_{command_counter}",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "output_commands": commands,
                    "metadata": {
                        "model": "LNN (Liquid Neural Network)",
                        "robot_name": ROBOT_NAME,
                        "hidden_state_norm": round(
                            sum(h*h for h in lnn.hidden_state) ** 0.5, 4
                        ),
                        "inputs_processed": len(sensor_data),
                        "outputs_generated": len(commands),
                        "format": data.get('_format', 'json')
                    }
                }

                await websocket.send(json.dumps(response))
                logger.info(f"Sent commands: {list(commands.keys())}")

            except Exception as e:
                logger.error(f"Error processing message: {e}")
                error_response = {
                    "error": str(e),
                    "command_id": f"cmd_error_{command_counter}"
                }
                try:
                    await websocket.send(json.dumps(error_response))
                except:
                    pass

    except websockets.exceptions.ConnectionClosed:
        logger.info("Robot disconnected (connection closed)")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        connected_clients.discard(client_id)
        logger.info(f"Robot disconnected. Total connections: {len(connected_clients)}")


# ─── HTTP Health Check Handler ─────────────────────────────────────────────

async def http_handler(path, request_headers):
    """
    Handle HTTP requests (non-WebSocket) for health checks.
    This is called by websockets.serve via process_request.
    """
    if path.strip('/') == 'health' or path.strip('/') == 'healthz':
        health_data = json.dumps({
            "status": "healthy",
            "robot_name": ROBOT_NAME,
            "model": "LNN (Liquid Neural Network)",
            "connections": len(connected_clients),
            "input_size": lnn.input_size,
            "output_size": lnn.output_size,
            "input_mapping": list(lnn.input_mapping.keys()),
            "output_mapping": list(lnn.output_mapping.keys()),
        })
        return (
            HTTPStatus.OK,
            [("Content-Type", "application/json")],
            health_data.encode(),
        )
    
    # For any other path, let it through to WebSocket handler
    return None


# ─── Main Server ───────────────────────────────────────────────────────────

async def main():
    logger.info("=" * 60)
    logger.info("  Airone Brain Server — LNN-Powered Robot Intelligence")
    logger.info("=" * 60)
    logger.info(f"  Robot: {ROBOT_NAME}")
    logger.info(f"  Port: {PORT}")
    logger.info(f"  API Key: {'***' + API_KEY[-4:] if API_KEY and len(API_KEY) > 4 else 'None'}")
    logger.info(f"  Model: {lnn.input_size} inputs → {lnn.hidden_units} hidden → {lnn.output_size} outputs")
    logger.info(f"  Input pins: {list(lnn.input_mapping.keys())}")
    logger.info(f"  Output pins: {list(lnn.output_mapping.keys())}")
    logger.info("=" * 60)

    async with websockets.serve(
        handle_connection,
        "0.0.0.0",
        PORT,
        process_request=http_handler,
        ping_interval=30,
        ping_timeout=10,
    ):
        logger.info(f"Brain server listening on ws://0.0.0.0:{PORT}")
        logger.info(f"Health check: http://0.0.0.0:{PORT}/health")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server shutting down...")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
