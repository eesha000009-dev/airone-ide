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
                command = self._format_output(name, raw_val)
                commands[name] = command

        return commands

    def _format_output(self, name, raw_val, out_type=None):
        """Format raw output (0-1) into appropriate command format.
        Checks output_types from config first, then falls back to out_type parameter.
        """
        # Prefer output_types from the model config over the passed parameter
        effective_type = self.output_types.get(name, out_type) or 'digital'

        if effective_type == 'pwm' or effective_type == 'motor':
            pwm_value = int(raw_val * 255)
            pwm_value = max(0, min(255, pwm_value))
            return {"action": "pwm", "value": pwm_value}
        elif effective_type == 'servo':
            angle = int(raw_val * 180)
            angle = max(0, min(180, angle))
            return {"action": "servo", "angle": angle}
        else:
            value = 1 if raw_val > 0.5 else 0
            return {"action": "digitalwrite", "value": value}

    def reset_state(self):
        """Reset hidden state."""
        self.hidden_state = [0.0] * self.hidden_units


class RuleBasedFallback:
    """Rule-based fallback controller when LNN training accuracy is too low (< 0.85).
    Uses if-then rules with left/right motor differentiation for obstacle avoidance.
    """

    def __init__(self, config):
        self.config = config
        self.input_mapping = config.get('input_mapping', {})
        self.output_mapping = config.get('output_mapping', {})
        self.output_types = config.get('output_types', {})
        self.rules = config.get('behavior_rules', [])
        self.output_reverse = {v: k for k, v in self.output_mapping.items()}

    def forward(self, inputs):
        """Apply rules to generate output commands with left/right motor differentiation.

        Obstacle avoidance logic:
        - Obstacle close on LEFT  -> stop LEFT motor, keep RIGHT motor -> turns RIGHT
        - Obstacle close on RIGHT -> stop RIGHT motor, keep LEFT motor -> turns LEFT
        - Obstacle close in FRONT -> stop BOTH motors -> then turn
        """
        if isinstance(inputs, dict):
            sensor_data = inputs
        else:
            sensor_data = {}

        # Identify left/right/front sensors by name patterns
        left_sensors = []
        right_sensors = []
        front_sensors = []

        for name, val in sensor_data.items():
            if not isinstance(val, (int, float)):
                continue
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'lft']):
                left_sensors.append((name, val))
            elif any(kw in name_lower for kw in ['right', 'rgt']):
                right_sensors.append((name, val))
            elif any(kw in name_lower for kw in ['front', 'center', 'mid']):
                front_sensors.append((name, val))

        # If no directional sensors found, split generic distance sensors
        if not left_sensors and not right_sensors and not front_sensors:
            dist_entries = [(k, v) for k, v in sensor_data.items()
                            if isinstance(v, (int, float)) and
                            ('ultrasonic' in k.lower() or 'distance' in k.lower() or
                             'proximity' in k.lower() or 'ir' in k.lower() or
                             'sonar' in k.lower())]
            if len(dist_entries) >= 2:
                half = len(dist_entries) // 2
                left_sensors = dist_entries[:half]
                right_sensors = dist_entries[half:]
            elif dist_entries:
                front_sensors = dist_entries

        # Compute proximity per direction (lower value = closer obstacle)
        left_min = min((v for _, v in left_sensors), default=1.0)
        right_min = min((v for _, v in right_sensors), default=1.0)
        front_min = min((v for _, v in front_sensors), default=1.0)
        overall_min = min(left_min, right_min, front_min)

        # Identify left/right motor outputs by name patterns
        left_motor_name = None
        right_motor_name = None
        other_outputs = []

        for name in self.output_mapping:
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'lft']):
                left_motor_name = name
            elif any(kw in name_lower for kw in ['right', 'rgt']):
                right_motor_name = name

        if not left_motor_name or not right_motor_name:
            # Assign by index: first output = left, second = right
            motor_names = [n for n in self.output_mapping
                           if self.output_types.get(n, 'digital') in ('pwm', 'motor')
                           or 'motor' in n.lower()]
            if len(motor_names) >= 2:
                if not left_motor_name:
                    left_motor_name = motor_names[0]
                if not right_motor_name:
                    right_motor_name = motor_names[1]
                other_outputs = [n for n in self.output_mapping
                                 if n not in (left_motor_name, right_motor_name)]
            else:
                other_outputs = list(self.output_mapping.keys())
        else:
            other_outputs = [n for n in self.output_mapping if n not in (left_motor_name, right_motor_name)]

        OBSTACLE_THRESHOLD = 0.4  # Below this = obstacle detected

        # Obstacle avoidance with directional awareness
        if overall_min > OBSTACLE_THRESHOLD:
            # Clear path: go forward at full speed
            left_speed = 0.9
            right_speed = 0.9
        elif left_min < OBSTACLE_THRESHOLD and right_min >= OBSTACLE_THRESHOLD:
            # Obstacle on LEFT -> stop LEFT motor, keep RIGHT motor going -> turns RIGHT
            left_speed = 0.1
            right_speed = 0.8
        elif right_min < OBSTACLE_THRESHOLD and left_min >= OBSTACLE_THRESHOLD:
            # Obstacle on RIGHT -> stop RIGHT motor, keep LEFT motor going -> turns LEFT
            left_speed = 0.8
            right_speed = 0.1
        elif front_min < OBSTACLE_THRESHOLD:
            # Obstacle in FRONT -> stop BOTH motors, then turn
            left_speed = 0.0
            right_speed = 0.0
        else:
            # Obstacles on both sides -> slight right turn to escape
            left_speed = 0.7
            right_speed = 0.2

        # Scale speed by how close the nearest obstacle is (safety factor)
        safety_factor = max(0.3, overall_min)
        left_speed *= safety_factor
        right_speed *= safety_factor

        # Clamp to [0, 1]
        left_speed = max(0.0, min(1.0, left_speed))
        right_speed = max(0.0, min(1.0, right_speed))

        # Build output values
        outputs = {}
        if left_motor_name:
            outputs[left_motor_name] = left_speed
        if right_motor_name:
            outputs[right_motor_name] = right_speed

        # Handle other outputs (LEDs, buzzers, servos, etc.)
        for name in other_outputs:
            out_type = self.output_types.get(name, 'digital')
            name_lower = name.lower()
            if out_type == 'servo' or 'servo' in name_lower:
                if overall_min < OBSTACLE_THRESHOLD:
                    outputs[name] = 0.8  # Turn servo away
                else:
                    outputs[name] = 0.5  # Center
            elif 'led' in name_lower or 'buzzer' in name_lower:
                outputs[name] = 1.0 if overall_min < OBSTACLE_THRESHOLD else 0.0
            elif out_type in ('pwm', 'motor') or 'motor' in name_lower:
                # Extra motors without direction: moderate speed with safety
                outputs[name] = 0.7 * safety_factor
            else:
                outputs[name] = 0.0  # Default off

        # Convert to command format
        commands = {}
        for name, val in outputs.items():
            if name in self.output_mapping:
                out_type = self.output_types.get(name, 'digital')
                if out_type in ('pwm', 'motor') or 'motor' in name.lower():
                    pwm_value = int(val * 255)
                    pwm_value = max(0, min(255, pwm_value))
                    commands[name] = {"action": "pwm", "value": pwm_value}
                elif out_type == 'servo' or 'servo' in name.lower():
                    angle = int(val * 180)
                    angle = max(0, min(180, angle))
                    commands[name] = {"action": "servo", "angle": angle}
                else:
                    value = 1 if val > 0.5 else 0
                    commands[name] = {"action": "digitalwrite", "value": value}

        return commands


class MultiModelBrainServer:
    """Brain server that hosts multiple LNN models, routing by robot name."""

    def __init__(self):
        self.models = {}  # robot_name -> LiquidNeuralNetwork
        self.fallbacks = {}  # robot_name -> RuleBasedFallback (when accuracy < 0.85)
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
                    lnn = LiquidNeuralNetwork(model_config)
                    self.models[robot_name] = lnn

                    # Check training accuracy - use rule-based fallback if too low
                    training_info = model_config.get('training_info', {})
                    accuracy = training_info.get('accuracy', 1.0)
                    if accuracy < 0.85:
                        logger.warning(f"Robot '{robot_name}' training accuracy {accuracy:.1%} is below 0.85 threshold, enabling rule-based fallback")
                        self.fallbacks[robot_name] = RuleBasedFallback(model_config)
                    else:
                        logger.info(f"Loaded model for robot: {robot_name} (inputs={model_config.get('input_size')}, outputs={model_config.get('output_size')}, accuracy={accuracy:.1%})")

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
        """Process a sensor data message and return commands.
        Uses rule-based fallback if LNN training accuracy was below threshold.
        """
        model = self.get_model(robot_name)
        if not model:
            return {"error": f"No model found for robot '{robot_name}'", "output_commands": {}}

        parsed = self._parse_message(message)
        sensor_data = parsed.get('input_sensors_read', parsed)

        # Use rule-based fallback if accuracy was too low
        if robot_name in self.fallbacks:
            logger.debug(f"Using rule-based fallback for robot '{robot_name}'")
            commands = self.fallbacks[robot_name].forward(sensor_data)
            mode = "rule-based-fallback"
            confidence = 0.7  # Rule-based fallback has decent reliability
        else:
            commands = model.forward(sensor_data)
            mode = "lnn"
            # Reflect actual training accuracy as confidence when LNN is well-trained
            training_info = model.config.get('training_info', {})
            accuracy = training_info.get('accuracy', None)
            if accuracy is not None and accuracy >= 0.85:
                confidence = accuracy
            else:
                confidence = 0.85  # Default confidence for LNN without accuracy info

        return {
            "output_commands": commands,
            "metadata": {
                "robot": robot_name,
                "confidence": confidence,
                "mode": mode,
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
                    "has_trained_weights": m.config.get('weights', {}).get('W_in') is not None,
                    "output_types": m.output_types,
                    "using_fallback": name in brain.fallbacks,
                    "training_accuracy": m.config.get('training_info', {}).get('accuracy', None)
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
