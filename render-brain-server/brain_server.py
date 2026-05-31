"""
Airone Multi-Model Brain Server
================================
A WebSocket brain server that hosts MULTIPLE LNN models simultaneously.
Each robot gets its own model, routed by the ?robot=<name> query parameter.

Architecture:
- MODEL_CONFIG env var contains JSON with all robot models
- WebSocket connections specify which robot via ?robot=robot-name
- Each robot's LNN processes sensor data independently
- Supports both JSON and natural language input formats

Usage on Render:
  Set MODEL_CONFIG='{"robot-name": {...model...}, "other-robot": {...model...}}'
  The server loads all models and routes by robot name.

Brain URL format:
  wss://<service>.onrender.com/?robot=my-robot-name

Inference:
  Send sensor data as JSON or natural language prompt.
  Receive output commands as JSON.
"""

import os
import json
import math
import time
import asyncio
import logging
import re
import random
from urllib.parse import parse_qs

try:
    import websockets
except ImportError:
    websockets = None

logging.basicConfig(level=logging.INFO, format='[BrainServer] %(message)s')
logger = logging.getLogger(__name__)

# ==================== LNN ENGINE ====================

class LiquidNeuralNetwork:
    """Liquid Neural Network with trained weights for real-time inference."""

    def __init__(self, config):
        self.config = config
        self.input_size = config.get('input_size', 1)
        self.output_size = config.get('output_size', 1)
        self.hidden_units = config.get('hidden_units', 16)
        self.time_steps = config.get('time_steps', 1)

        # Neuron parameters
        params = config.get('neuron_params', {})
        self.tau = params.get('tau', params.get('vt', 0.1))
        self.dt = params.get('dt', 0.01)
        self.sensitivity = params.get('sensitivity', 0.5)

        # Mappings
        self.input_mapping = config.get('input_mapping', {})
        self.output_mapping = config.get('output_mapping', {})

        # Trained weights (from AI training)
        self.weights = config.get('weights', {})
        self.W_in = self.weights.get('W_in')
        self.W_rec = self.weights.get('W_rec')
        self.W_out = self.weights.get('W_out')
        self.b_in = self.weights.get('b_in')
        self.b_out = self.weights.get('b_out')

        # If no trained weights, initialize with Xavier initialization
        if self.W_in is None:
            self.W_in = self._xavier_init(self.hidden_units, self.input_size)
        if self.W_rec is None:
            self.W_rec = self._xavier_init(self.hidden_units, self.hidden_units)
        if self.W_out is None:
            self.W_out = self._xavier_init(self.output_size, self.hidden_units)
        if self.b_in is None:
            self.b_in = [0.0] * self.hidden_units
        if self.b_out is None:
            self.b_out = [0.0] * self.output_size

        # Hidden state (persistent across timesteps)
        self.hidden_state = [0.0] * self.hidden_units

        # Output types for each output (determines output format)
        self.output_types = config.get('output_types', {})

        # Reverse output mapping
        self.output_reverse = {v: k for k, v in self.output_mapping.items()}

    def _xavier_init(self, rows, cols):
        """Xavier/Glorot initialization for weight matrices."""
        limit = math.sqrt(6.0 / (rows + cols))
        return [[random.uniform(-limit, limit) for _ in range(cols)] for _ in range(rows)]

    def _sigmoid(self, x):
        if x >= 0:
            return 1.0 / (1.0 + math.exp(-x))
        else:
            ex = math.exp(x)
            return ex / (1.0 + ex)

    def _tanh(self, x):
        return math.tanh(x)

    def forward(self, inputs):
        """
        Run one forward pass through the LNN.
        inputs: dict of {pin_name: value} or list of values
        Returns: dict of {pin_name: command_dict}
        """
        # Convert dict input to ordered list
        if isinstance(inputs, dict):
            input_values = []
            for name, idx in sorted(self.input_mapping.items(), key=lambda x: x[1]):
                val = inputs.get(name, 0.0)
                if isinstance(val, str):
                    try:
                        val = float(val)
                    except (ValueError, TypeError):
                        val = 0.0
                input_values.append(val)
            # Pad if needed
            while len(input_values) < self.input_size:
                input_values.append(0.0)
        else:
            input_values = list(inputs)
            while len(input_values) < self.input_size:
                input_values.append(0.0)

        # Ensure correct length
        input_values = input_values[:self.input_size]

        # LNN cell update: h = (1 - dt/tau) * h + dt/tau * tanh(W_in * x + W_rec * h + b_in)
        new_hidden = [0.0] * self.hidden_units
        for i in range(self.hidden_units):
            w_sum = self.b_in[i]
            for j in range(min(len(input_values), self.input_size)):
                w_sum += self.W_in[i][j] * input_values[j]
            for j in range(self.hidden_units):
                w_sum += self.W_rec[i][j] * self.hidden_state[j]
            decay = 1.0 - self.dt / max(self.tau, 0.001)
            new_hidden[i] = decay * self.hidden_state[i] + (self.dt / max(self.tau, 0.001)) * self._tanh(w_sum)

        self.hidden_state = new_hidden

        # Output layer: y = sigmoid(W_out * h + b_out)
        raw_outputs = []
        for i in range(self.output_size):
            w_sum = self.b_out[i]
            for j in range(self.hidden_units):
                w_sum += self.W_out[i][j] * self.hidden_state[j]
            raw_outputs.append(self._sigmoid(w_sum))

        # Convert raw outputs (0-1) to commands based on output types
        commands = {}
        for name, idx in self.output_mapping.items():
            if idx < len(raw_outputs):
                raw_val = raw_outputs[idx]
                out_type = self.output_types.get(name, 'digital')
                command = self._format_output(name, raw_val, out_type)
                commands[name] = command

        return commands

    def _format_output(self, name, raw_val, out_type):
        """Format raw output (0-1) into appropriate command format."""
        if out_type == 'pwm' or out_type == 'motor':
            pwm_value = int(raw_val * 255)
            pwm_value = max(0, min(255, pwm_value))
            return {"action": "pwm", "value": pwm_value}
        elif out_type == 'servo':
            angle = int(raw_val * 180)
            angle = max(0, min(180, angle))
            return {"action": "servo", "angle": angle}
        else:
            value = 1 if raw_val > 0.5 else 0
            return {"action": "digitalwrite", "value": value}

    def reset_state(self):
        """Reset hidden state."""
        self.hidden_state = [0.0] * self.hidden_units


class MultiModelBrainServer:
    """Brain server that hosts multiple LNN models, routing by robot name."""

    def __init__(self):
        self.models = {}  # robot_name -> LiquidNeuralNetwork
        self.load_models()

    def load_models(self):
        """Load models from MODEL_CONFIG environment variable."""
        config_str = os.environ.get('MODEL_CONFIG', '')
        if not config_str:
            logger.warning("No MODEL_CONFIG environment variable set")
            return

        try:
            config = json.loads(config_str)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse MODEL_CONFIG: {e}")
            return

        # Support both single-model and multi-model formats
        if 'input_size' in config:
            # Single model format - use ROBOT_NAME env var or 'default'
            robot_name = os.environ.get('ROBOT_NAME', 'default')
            self.models[robot_name] = LiquidNeuralNetwork(config)
            logger.info(f"Loaded single model for robot: {robot_name}")
        else:
            # Multi-model format: { "robot-name": {...config...}, ... }
            for robot_name, model_config in config.items():
                if isinstance(model_config, dict) and 'input_size' in model_config:
                    self.models[robot_name] = LiquidNeuralNetwork(model_config)
                    logger.info(f"Loaded model for robot: {robot_name} (inputs={model_config.get('input_size')}, outputs={model_config.get('output_size')})")

        logger.info(f"Total models loaded: {len(self.models)}")

    def get_model(self, robot_name):
        """Get the LNN model for a robot, or fall back to default."""
        if robot_name in self.models:
            return self.models[robot_name]
        if 'default' in self.models:
            return self.models['default']
        if self.models:
            first_name = next(iter(self.models))
            logger.warning(f"No model for robot '{robot_name}', using '{first_name}'")
            return self.models[first_name]
        return None

    def process_message(self, robot_name, message):
        """Process a sensor data message and return commands."""
        model = self.get_model(robot_name)
        if not model:
            return {"error": f"No model found for robot '{robot_name}'", "output_commands": {}}

        parsed = self._parse_message(message)
        sensor_data = parsed.get('input_sensors_read', parsed)
        commands = model.forward(sensor_data)

        return {
            "output_commands": commands,
            "metadata": {
                "robot": robot_name,
                "confidence": 0.85,
                "model_info": f"LNN ({model.input_size}in/{model.output_size}out/{model.hidden_units}hidden)"
            }
        }

    def _parse_message(self, message):
        """Parse JSON or natural language message."""
        if isinstance(message, dict):
            return message

        if isinstance(message, str):
            try:
                return json.loads(message)
            except json.JSONDecodeError:
                pass

            result = {'input_sensors_read': {}}
            sensors_match = re.search(r'input sensors read:\s*\n?\s*\(([^)]*)\)', message, re.IGNORECASE)
            if sensors_match:
                sensor_text = sensors_match.group(1).strip()
                if sensor_text and 'no input sensors' not in sensor_text.lower():
                    for pair in sensor_text.split(','):
                        pair = pair.strip()
                        if ':' in pair:
                            key, val = pair.split(':', 1)
                            key = key.strip()
                            val = val.strip()
                            try:
                                val = float(val)
                            except ValueError:
                                pass
                            result['input_sensors_read'][key] = val

            outputs_match = re.search(r'What do you want to do to:\s*\n?\s*\(([^)]*)\)', message, re.IGNORECASE)
            if outputs_match:
                output_text = outputs_match.group(1).strip()
                if output_text and 'no output modules' not in output_text.lower():
                    result['output_modules_available'] = [m.strip().rstrip('.') for m in output_text.split(',')]

            return result

        return {'input_sensors_read': {}}


# ==================== WEBSOCKET SERVER ====================

brain = MultiModelBrainServer()


async def _process_request(path, request_headers):
    """Handle HTTP requests alongside WebSocket connections."""
    if path == '/health' or path == '/':
        response_data = {
            "status": "healthy",
            "service": "airone-brain-server",
            "mode": "multi-model",
            "models_loaded": len(brain.models),
            "robots": list(brain.models.keys()),
            "model_details": {
                name: {
                    "inputs": m.input_size,
                    "outputs": m.output_size,
                    "hidden": m.hidden_units,
                    "has_trained_weights": m.config.get('weights', {}).get('W_in') is not None
                }
                for name, m in brain.models.items()
            }
        }
        body = json.dumps(response_data, indent=2).encode()
        return (200, [
            ("Content-Type", "application/json"),
            ("Content-Length", str(len(body)))
        ], body)

    return None


async def handle_websocket(websocket):
    """Handle WebSocket connection with robot routing."""
    robot_name = 'default'

    # Extract robot name from query parameter
    try:
        request_path = websocket.request.path if hasattr(websocket.request, 'path') else '/'
        if '?' in request_path:
            query = request_path.split('?', 1)[1]
            params = parse_qs(query)
            robot_name = params.get('robot', params.get('name', ['default']))[0]
    except Exception:
        pass

    logger.info(f"WebSocket connected for robot: {robot_name}")
    model = brain.get_model(robot_name)
    if model:
        logger.info(f"Using model: {model.input_size}in/{model.output_size}out")
    else:
        logger.warning(f"No model available for robot: {robot_name}")

    try:
        async for raw_message in websocket:
            try:
                # Try to parse as JSON to check for robot_id override
                try:
                    msg_data = json.loads(raw_message)
                    if isinstance(msg_data, dict):
                        msg_robot = msg_data.get('robot_id') or msg_data.get('robot_name')
                        if msg_robot and msg_robot in brain.models:
                            robot_name = msg_robot
                except json.JSONDecodeError:
                    pass

                result = brain.process_message(robot_name, raw_message)
                result['robot'] = robot_name
                result['timestamp'] = time.time()
                await websocket.send(json.dumps(result))

            except Exception as e:
                logger.error(f"Error processing message: {e}")
                await websocket.send(json.dumps({"error": str(e)}))

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"WebSocket disconnected for robot: {robot_name}")


# ==================== MAIN ====================

async def main():
    port = int(os.environ.get('PORT', 10000))

    logger.info(f"Starting Airone Multi-Model Brain Server on port {port}")
    logger.info(f"Models loaded: {list(brain.models.keys())}")

    if websockets is None:
        logger.error("websockets library not installed! Run: pip install websockets")
        return

    async with websockets.serve(handle_websocket, "0.0.0.0", port,
                                 process_request=_process_request):
        logger.info(f"WebSocket server listening on ws://0.0.0.0:{port}")
        logger.info(f"Connect robots via: ws://0.0.0.0:{port}/?robot=<robot-name>")
        await asyncio.Future()  # Run forever


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server shutting down...")
