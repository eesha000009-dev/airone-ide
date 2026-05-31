"""
Airone Deploy API — LNN Generation, Training, Deployment, and Inference Server.

This FastAPI service handles:
1. LNN model generation via NVIDIA Kimi K2.6 API (with SSE streaming)
2. LNN training using Evolutionary Strategy with Kimi-generated training data
3. Brain deployment to Render via Render API (new service + fallback)
4. WebSocket LNN inference for testing and robot connections
5. Health checks

Dual-mode operation:
- When RENDER_API_KEY is set: Full deploy API + inference
- When MODEL_CONFIG is set (brain-template mode): Acts as brain server
  with root WebSocket endpoint for robot connections

Environment Variables:
    RENDER_API_KEY  - Render API key for deploying brain services
    NVIDIA_API_KEY  - NVIDIA AI API key for Kimi K2.6
    MODEL_CONFIG    - JSON LNN config (for brain-template mode)
    ROBOT_NAME      - Name of the robot (for brain-template mode)
    PORT            - Port to listen on (default: 8000)
"""

import os
import sys
import json
import math
import random
import re
import asyncio
import logging
import uuid
import time
import copy
from datetime import datetime
from pathlib import Path
from typing import Optional, AsyncGenerator

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed. Run: pip install httpx")
    sys.exit(1)

try:
    from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
except ImportError:
    print("ERROR: fastapi not installed. Run: pip install fastapi uvicorn")
    sys.exit(1)

try:
    import uvicorn
except ImportError:
    print("ERROR: uvicorn not installed. Run: pip install uvicorn")
    sys.exit(1)

# ─── Configuration ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('DeployAPI')

RENDER_API_KEY = os.environ.get('RENDER_API_KEY', '')
NVIDIA_API_KEY = os.environ.get('NVIDIA_API_KEY', '')
RENDER_API_URL = "https://api.render.com/v1"
NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_MODEL = "moonshotai/kimi-k2.6"
BRAIN_REPO = "https://github.com/eesha000009-dev/airone-ide"
BRAIN_BRANCH = "main"
BRAIN_ROOT_DIR = "render-brain-server"
RENDER_OWNER_ID = "tea-d8dh89s2m8qs7388ajb0"
BRAIN_TEMPLATE_ID = "srv-d8dh9esm0tmc73duts10"

# Kimi API settings
KIMI_TIMEOUT = 120.0       # seconds per attempt (increased for Kimi K2.6)
KIMI_MAX_RETRIES = 2       # Retry once on failure
KIMI_BACKOFF_BASE = 2.0    # exponential backoff base

# Detect brain-template mode
MODEL_CONFIG_RAW = os.environ.get('MODEL_CONFIG', '')
ROBOT_NAME = os.environ.get('ROBOT_NAME', 'brain-template')
BRAIN_MODE = bool(MODEL_CONFIG_RAW and MODEL_CONFIG_RAW != '{}')

# ─── SSE Event Helpers ──────────────────────────────────────────────────────

def sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ─── LNN Model (Lightweight Pure-Python) ────────────────────────────────────

class LiquidNeuralNetwork:
    """
    Liquid Neural Network inference and training engine.

    Uses a CfC-inspired architecture with continuous-time dynamics.
    The network maintains hidden state across time steps, enabling temporal
    reasoning about sensor data streams.

    Training uses Evolutionary Strategy (ES) with Kimi-generated scenarios.
    """

    def __init__(self, config: dict):
        self.input_size = config.get('input_size', 4)
        self.output_size = config.get('output_size', 4)
        self.hidden_units = config.get('hidden_units', 16)
        self.time_steps = config.get('time_steps', 1)
        # Support both 'vt' and 'tau' parameter names
        neuron_params = config.get('neuron_params', {})
        if 'tau' in neuron_params and 'vt' not in neuron_params:
            neuron_params['vt'] = neuron_params.pop('tau')
        self.neuron_params = neuron_params
        self.input_mapping = config.get('input_mapping', {})
        self.output_mapping = config.get('output_mapping', {})
        self.description = config.get('description', '')
        # Pin definitions for output type info
        self.pin_definitions = config.get('pin_definitions', {})

        # Xavier initialization
        limit_in = math.sqrt(6.0 / (self.input_size + self.hidden_units))
        limit_out = math.sqrt(6.0 / (self.hidden_units + self.output_size))

        random.seed(42)
        self.weights_input = [[random.uniform(-limit_in, limit_in)
                               for _ in range(self.input_size)]
                              for _ in range(self.hidden_units)]
        self.weights_recurrent = [[random.uniform(-0.5, 0.5)
                                   for _ in range(self.hidden_units)]
                                  for _ in range(self.hidden_units)]
        self.weights_output = [[random.uniform(-limit_out, limit_out)
                                for _ in range(self.hidden_units)]
                               for _ in range(self.output_size)]

        self.hidden_state = [0.0] * self.hidden_units

        self.input_name_to_idx = {name: idx for name, idx in self.input_mapping.items()}
        self.idx_to_output_name = {idx: name for name, idx in self.output_mapping.items()}

        # Determine output types from pin_definitions
        self.output_types = {}
        if self.pin_definitions and 'outputs' in self.pin_definitions:
            for pin in self.pin_definitions['outputs']:
                name = pin.get('name', '') if isinstance(pin, dict) else str(pin)
                pin_type = pin.get('type', 'pwm_output') if isinstance(pin, dict) else 'pwm_output'
                if name:
                    self.output_types[name] = pin_type

        # Training metadata
        self.trained = config.get('trained', False)
        self.training_accuracy = config.get('training_accuracy', None)
        self.training_iterations = config.get('training_iterations', None)
        self.training_loss = config.get('training_loss', None)

        logger.info(f"LNN initialized: {self.input_size} inputs -> "
                    f"{self.hidden_units} hidden -> {self.output_size} outputs")
        if self.output_types:
            logger.info(f"Output types: {self.output_types}")

    def _sigmoid(self, x: float) -> float:
        if x >= 0:
            return 1.0 / (1.0 + math.exp(-x))
        else:
            ex = math.exp(x)
            return ex / (1.0 + ex)

    def _tanh(self, x: float) -> float:
        return math.tanh(x)

    def forward(self, input_values: list) -> list:
        """Run forward pass through the LNN."""
        vt = self.neuron_params.get('vt', 0.1)
        dt = self.neuron_params.get('dt', 0.01)
        sensitivity = self.neuron_params.get('sensitivity', 0.5)

        input_contribution = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            for i in range(min(len(input_values), self.input_size)):
                input_contribution[h] += self.weights_input[h][i] * input_values[i]

        recurrent_contribution = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            for j in range(self.hidden_units):
                recurrent_contribution[h] += self.weights_recurrent[h][j] * self.hidden_state[j]

        new_hidden = [0.0] * self.hidden_units
        for h in range(self.hidden_units):
            total_input = input_contribution[h] + recurrent_contribution[h]
            tau = vt + sensitivity * self._sigmoid(total_input)
            activation = self._tanh(total_input)
            new_hidden[h] = self.hidden_state[h] + dt * (activation - self.hidden_state[h]) / tau

        self.hidden_state = new_hidden

        outputs = [0.0] * self.output_size
        for o in range(self.output_size):
            for h in range(self.hidden_units):
                outputs[o] += self.weights_output[o][h] * self.hidden_state[h]
            outputs[o] = self._sigmoid(outputs[o])

        return outputs

    def forward_with_state(self, input_values: list, hidden_state: list,
                           weights_input: list, weights_recurrent: list,
                           weights_output: list) -> tuple:
        """
        Run forward pass with explicit state and weights (for training).

        Returns:
            (outputs, new_hidden_state)
        """
        vt = self.neuron_params.get('vt', 0.1)
        dt = self.neuron_params.get('dt', 0.01)
        sensitivity = self.neuron_params.get('sensitivity', 0.5)
        hidden_units = len(hidden_state)
        input_size = len(weights_input[0]) if weights_input else self.input_size
        output_size = len(weights_output)

        input_contribution = [0.0] * hidden_units
        for h in range(hidden_units):
            for i in range(min(len(input_values), input_size)):
                input_contribution[h] += weights_input[h][i] * input_values[i]

        recurrent_contribution = [0.0] * hidden_units
        for h in range(hidden_units):
            for j in range(hidden_units):
                recurrent_contribution[h] += weights_recurrent[h][j] * hidden_state[j]

        new_hidden = [0.0] * hidden_units
        for h in range(hidden_units):
            total_input = input_contribution[h] + recurrent_contribution[h]
            tau = vt + sensitivity * self._sigmoid(total_input)
            activation = self._tanh(total_input)
            new_hidden[h] = hidden_state[h] + dt * (activation - hidden_state[h]) / tau

        outputs = [0.0] * output_size
        for o in range(output_size):
            for h in range(hidden_units):
                outputs[o] += weights_output[o][h] * new_hidden[h]
            outputs[o] = self._sigmoid(outputs[o])

        return outputs, new_hidden

    def compute_loss(self, training_data: list,
                     weights_input: list = None,
                     weights_recurrent: list = None,
                     weights_output: list = None) -> float:
        """
        Compute MSE loss on training data.

        Args:
            training_data: List of dicts with 'inputs' and 'expected_outputs'
            weights_input, weights_recurrent, weights_output: Optional weight
                overrides. If None, uses self weights.

        Returns:
            Mean squared error across all scenarios.
        """
        wi = weights_input if weights_input is not None else self.weights_input
        wr = weights_recurrent if weights_recurrent is not None else self.weights_recurrent
        wo = weights_output if weights_output is not None else self.weights_output

        total_loss = 0.0
        total_outputs = 0

        for scenario in training_data:
            inputs_dict = scenario.get('inputs', {})
            expected = scenario.get('expected_outputs', {})

            # Build input vector from named inputs
            input_values = [0.0] * self.input_size
            for name, val in inputs_dict.items():
                if name in self.input_mapping:
                    idx = self.input_mapping[name]
                    input_values[idx] = max(0.0, min(1.0, float(val)))

            # Reset hidden state for each scenario evaluation
            hidden = [0.0] * self.hidden_units

            outputs, hidden = self.forward_with_state(
                input_values, hidden, wi, wr, wo
            )

            # Compute loss against expected outputs
            for name, expected_val in expected.items():
                if name in self.output_mapping:
                    idx = self.output_mapping[name]
                    if idx < len(outputs):
                        diff = outputs[idx] - float(expected_val)
                        total_loss += diff * diff
                        total_outputs += 1

        if total_outputs == 0:
            return float('inf')

        return total_loss / total_outputs

    def evaluate_accuracy(self, training_data: list, tolerance: float = 0.2) -> float:
        """
        Evaluate accuracy as the percentage of outputs within tolerance
        of expected values.

        Args:
            training_data: List of dicts with 'inputs' and 'expected_outputs'
            tolerance: Fraction of expected value considered acceptable (0.2 = 20%)

        Returns:
            Accuracy as a float between 0.0 and 1.0.
        """
        correct = 0
        total = 0

        for scenario in training_data:
            inputs_dict = scenario.get('inputs', {})
            expected = scenario.get('expected_outputs', {})

            # Build input vector
            input_values = [0.0] * self.input_size
            for name, val in inputs_dict.items():
                if name in self.input_mapping:
                    idx = self.input_mapping[name]
                    input_values[idx] = max(0.0, min(1.0, float(val)))

            # Reset hidden state for evaluation
            self.hidden_state = [0.0] * self.hidden_units
            outputs = self.forward(input_values)

            for name, expected_val in expected.items():
                if name in self.output_mapping:
                    idx = self.output_mapping[name]
                    if idx < len(outputs):
                        ev = float(expected_val)
                        actual = outputs[idx]
                        # Avoid division by zero; if expected is near zero, use absolute tolerance
                        if abs(ev) < 0.01:
                            if abs(actual - ev) < tolerance:
                                correct += 1
                        else:
                            if abs(actual - ev) / max(abs(ev), 0.01) <= tolerance:
                                correct += 1
                        total += 1

        if total == 0:
            return 0.0

        return correct / total

    def train(self, training_data: list, iterations: int = 300,
              population: int = 30, sigma: float = 0.15,
              learning_rate: float = 0.04,
              progress_callback=None) -> dict:
        """
        Train LNN weights using Evolutionary Strategy (ES) followed by
        gradient-descent fine-tuning.

        The algorithm:
        1. Start with current (Xavier-initialized) weights
        2. For each ES iteration:
           a. Generate N perturbations by adding Gaussian noise to weights
           b. Evaluate each perturbation on training data (MSE loss)
           c. Update weights as weighted average of perturbations,
              weighted by negative loss improvement
           d. Adaptive sigma: decrease sigma over iterations for refinement
           e. Early stopping when loss < 0.01
        3. After ES, run gradient-descent fine-tuning for 100 epochs
        4. Track best loss throughout training

        Args:
            training_data: List of training scenarios with 'inputs' and
                'expected_outputs' (normalized to [0,1]).
            iterations: Number of ES iterations (default 300).
            population: Number of perturbations per iteration (default 30).
            sigma: Initial standard deviation of Gaussian noise (default 0.15).
            learning_rate: Step size for weight updates (default 0.04).
            progress_callback: Optional callable(iteration, loss, best_loss)
                called every 10 iterations for progress reporting.

        Returns:
            Dict with training results: final_loss, best_loss, iterations,
            accuracy.
        """
        if not training_data:
            logger.warning("No training data provided; skipping training.")
            return {"final_loss": None, "best_loss": None, "iterations": 0, "accuracy": 0.0}

        initial_sigma = sigma
        logger.info(f"Starting ES training: {iterations} iterations, "
                    f"population={population}, sigma={sigma}, lr={learning_rate}")

        # Flatten all weight matrices into a single vector for ES
        def flatten_weights(wi, wr, wo):
            flat = []
            for row in wi:
                flat.extend(row)
            for row in wr:
                flat.extend(row)
            for row in wo:
                flat.extend(row)
            return flat

        def unflatten_weights(flat, hu, ins, outs):
            idx = 0
            wi = []
            for h in range(hu):
                row = flat[idx:idx + ins]
                wi.append(row[:])
                idx += ins
            wr = []
            for h in range(hu):
                row = flat[idx:idx + hu]
                wr.append(row[:])
                idx += hu
            wo = []
            for o in range(outs):
                row = flat[idx:idx + hu]
                wo.append(row[:])
                idx += hu
            return wi, wr, wo

        hu = self.hidden_units
        ins = self.input_size
        outs = self.output_size

        best_weights = flatten_weights(self.weights_input, self.weights_recurrent, self.weights_output)
        best_loss = self.compute_loss(training_data)

        n_params = len(best_weights)
        es_iterations_completed = 0

        for iteration in range(iterations):
            # Adaptive sigma: decrease over iterations for finer refinement
            # sigma starts at initial_sigma and decays to initial_sigma * 0.1
            current_sigma = initial_sigma * (0.1 ** (iteration / max(iterations, 1)))

            # Generate perturbations and evaluate
            perturbations = []
            losses = []

            for p in range(population):
                # Generate noise vector with adaptive sigma
                noise = [random.gauss(0, current_sigma) for _ in range(n_params)]

                # Create perturbed weights
                perturbed = [best_weights[i] + noise[i] for i in range(n_params)]

                # Unflatten and evaluate
                p_wi, p_wr, p_wo = unflatten_weights(perturbed, hu, ins, outs)
                loss = self.compute_loss(training_data, p_wi, p_wr, p_wo)

                perturbations.append(noise)
                losses.append(loss)

            # Compute reward-weighted update (rank-normalized)
            # Sort by loss (lower is better), weight inversely
            indexed = sorted(enumerate(losses), key=lambda x: x[1])

            # Use rank-based weighting
            update = [0.0] * n_params
            total_weight = 0.0

            for rank, (idx, loss) in enumerate(indexed):
                # Higher weight for lower loss (better performance)
                # Using rank normalization: best gets weight = population-1, worst gets 0
                weight = (population - 1 - rank) / (population - 1) if population > 1 else 1.0
                total_weight += weight

                for i in range(n_params):
                    update[i] += weight * perturbations[idx][i]

            if total_weight > 0:
                # Normalize and apply learning rate
                for i in range(n_params):
                    update[i] = (update[i] / total_weight) * learning_rate / max(current_sigma, 1e-6)

                # Always update from best weights (greedy ES)
                new_weights = [best_weights[i] + update[i] for i in range(n_params)]

                # Evaluate updated weights
                n_wi, n_wr, n_wo = unflatten_weights(new_weights, hu, ins, outs)
                new_loss = self.compute_loss(training_data, n_wi, n_wr, n_wo)

                if new_loss <= best_loss:
                    # Accept improvement
                    best_weights = new_weights
                    best_loss = new_loss
                # else: reject, keep best_weights unchanged (greedy)

            es_iterations_completed = iteration + 1

            # Early stopping: if loss is very low, stop ES
            if best_loss < 0.01:
                logger.info(f"ES early stopping at iteration {iteration+1}: loss={best_loss:.6f} < 0.01")
                break

            # Progress callback
            if progress_callback and (iteration % 10 == 0 or iteration == iterations - 1):
                progress_callback(iteration + 1, best_loss, best_loss)

        # ── Gradient-descent fine-tuning after ES ──────────────────────
        logger.info(f"ES training done ({es_iterations_completed} iters, loss={best_loss:.6f}). "
                    f"Starting gradient-descent fine-tuning for 100 epochs...")
        gd_epochs = 100
        gd_lr = 0.01

        # Apply best ES weights before GD fine-tuning
        best_wi, best_wr, best_wo = unflatten_weights(best_weights, hu, ins, outs)

        for epoch in range(gd_epochs):
            # Compute gradients numerically via finite differences
            grad_wi = [[0.0] * ins for _ in range(hu)]
            grad_wr = [[0.0] * hu for _ in range(hu)]
            grad_wo = [[0.0] * hu for _ in range(outs)]

            eps = 1e-4
            base_loss = self.compute_loss(training_data, best_wi, best_wr, best_wo)

            # Gradient for weights_input
            for h in range(hu):
                for i in range(ins):
                    wi_plus = [row[:] for row in best_wi]
                    wi_plus[h][i] += eps
                    loss_plus = self.compute_loss(training_data, wi_plus, best_wr, best_wo)
                    grad_wi[h][i] = (loss_plus - base_loss) / eps

            # Gradient for weights_recurrent
            for h in range(hu):
                for j in range(hu):
                    wr_plus = [row[:] for row in best_wr]
                    wr_plus[h][j] += eps
                    loss_plus = self.compute_loss(training_data, best_wi, wr_plus, best_wo)
                    grad_wr[h][j] = (loss_plus - base_loss) / eps

            # Gradient for weights_output
            for o in range(outs):
                for h in range(hu):
                    wo_plus = [row[:] for row in best_wo]
                    wo_plus[o][h] += eps
                    loss_plus = self.compute_loss(training_data, best_wi, best_wr, wo_plus)
                    grad_wo[o][h] = (loss_plus - base_loss) / eps

            # Apply gradient descent update
            for h in range(hu):
                for i in range(ins):
                    best_wi[h][i] -= gd_lr * grad_wi[h][i]
            for h in range(hu):
                for j in range(hu):
                    best_wr[h][j] -= gd_lr * grad_wr[h][j]
            for o in range(outs):
                for h in range(hu):
                    best_wo[o][h] -= gd_lr * grad_wo[o][h]

            # Check new loss
            new_loss = self.compute_loss(training_data, best_wi, best_wr, best_wo)
            if new_loss < best_loss:
                best_loss = new_loss
                best_weights = flatten_weights(best_wi, best_wr, best_wo)
            else:
                # Revert if worse
                best_wi, best_wr, best_wo = unflatten_weights(best_weights, hu, ins, outs)

            if progress_callback and epoch % 20 == 0:
                progress_callback(es_iterations_completed + epoch + 1, best_loss, best_loss)

            # Early stopping
            if best_loss < 0.005:
                logger.info(f"GD early stopping at epoch {epoch+1}: loss={best_loss:.6f} < 0.005")
                break

        # Apply best weights to the model
        best_wi, best_wr, best_wo = unflatten_weights(best_weights, hu, ins, outs)
        self.weights_input = best_wi
        self.weights_recurrent = best_wr
        self.weights_output = best_wo

        # Reset hidden state after training
        self.hidden_state = [0.0] * self.hidden_units

        # Evaluate final accuracy
        accuracy = self.evaluate_accuracy(training_data)

        # Update training metadata
        self.trained = True
        self.training_accuracy = round(accuracy, 4)
        self.training_iterations = es_iterations_completed
        self.training_loss = round(best_loss, 6)

        logger.info(f"Training complete: best_loss={best_loss:.6f}, "
                    f"accuracy={accuracy:.2%}, ES_iters={es_iterations_completed}, "
                    f"+ GD fine-tuning")

        return {
            "final_loss": round(best_loss, 6),
            "best_loss": round(best_loss, 6),
            "iterations": es_iterations_completed,
            "accuracy": round(accuracy, 4),
        }

    def _get_output_action(self, name: str, output_val: float) -> dict:
        """
        Generate the appropriate action for an output module based on its type.

        Output types:
        - pwm_output: PWM motor speed (0-255)
        - servo: Servo angle (0-180)
        - digital_output: On/Off (0 or 1)
        - Default: PWM if name contains 'motor', otherwise servo
        """
        output_type = self.output_types.get(name, '')

        # Auto-detect from name if no explicit type
        if not output_type:
            name_lower = name.lower()
            if 'motor' in name_lower or 'pwm' in name_lower or 'speed' in name_lower:
                output_type = 'pwm_output'
            elif 'led' in name_lower or 'buzzer' in name_lower or 'relay' in name_lower:
                output_type = 'digital_output'
            else:
                output_type = 'servo'

        if output_type == 'pwm_output':
            # Map [0,1] to PWM range [0,255]
            pwm_value = int(output_val * 255)
            pwm_value = max(0, min(255, pwm_value))
            return {"action": "pwm", "value": pwm_value}
        elif output_type == 'digital_output':
            # Threshold at 0.5
            return {"action": "digitalwrite", "value": 1 if output_val > 0.5 else 0}
        else:
            # Servo: map [0,1] to angle [0,180]
            angle = int(output_val * 180)
            angle = max(0, min(180, angle))
            return {"action": "servo", "angle": angle}

    def process_sensor_data(self, sensor_data: dict, output_modules: list) -> dict:
        """Process sensor data and generate commands.
        
        If LNN training accuracy < 60%, falls back to rule-based processing.
        """
        # Default output_modules to all output mapping keys if empty
        if not output_modules:
            output_modules = list(self.output_mapping.keys())
            logger.info(f"output_modules empty, defaulting to all outputs: {output_modules}")

        # Encode inputs to [0, 1] range
        input_values = [0.0] * self.input_size
        for name, idx in self.input_mapping.items():
            if name in sensor_data:
                val = sensor_data[name]
                if isinstance(val, (int, float)):
                    # Normalize: if value > 1.0, assume raw ADC (0-4095), else already normalized
                    if abs(float(val)) > 1.0:
                        input_values[idx] = min(1.0, max(0.0, float(val) / 4095.0))
                    else:
                        input_values[idx] = min(1.0, max(0.0, float(val)))
                elif isinstance(val, str):
                    try:
                        fv = float(val)
                        if abs(fv) > 1.0:
                            input_values[idx] = min(1.0, max(0.0, fv / 4095.0))
                        else:
                            input_values[idx] = min(1.0, max(0.0, fv))
                    except (ValueError, TypeError):
                        pass

        # Run LNN forward pass
        raw_outputs = self.forward(input_values)

        # Check if LNN accuracy is too low — use rule-based fallback
        if self.training_accuracy is None or self.training_accuracy < 0.6:
            rule_outputs = RuleBasedProcessor.process(
                sensor_data, input_values, self.input_mapping,
                self.output_mapping, self.output_types, self.description
            )
            if rule_outputs:
                # Blend: 70% rule-based, 30% LNN for exploration
                blended = {}
                for idx, name in self.idx_to_output_name.items():
                    if name in output_modules:
                        lnn_val = raw_outputs[idx] if idx < len(raw_outputs) else 0.5
                        rule_val = rule_outputs.get(name, lnn_val)
                        blended_val = 0.7 * rule_val + 0.3 * lnn_val
                        blended[name] = blended_val
                commands = {}
                for name, val in blended.items():
                    commands[name] = self._get_output_action(name, val)
                logger.info(f"Using rule-based fallback (LNN accuracy={self.training_accuracy:.2%})")
                return commands

        # Decode outputs to commands (normal LNN path)
        commands = {}
        for idx, name in self.idx_to_output_name.items():
            if idx < len(raw_outputs) and name in output_modules:
                output_val = raw_outputs[idx]
                commands[name] = self._get_output_action(name, output_val)

        return commands

    def get_config(self) -> dict:
        """Return the model configuration including training metadata."""
        config = {
            'input_size': self.input_size,
            'output_size': self.output_size,
            'hidden_units': self.hidden_units,
            'time_steps': self.time_steps,
            'neuron_params': self.neuron_params,
            'input_mapping': self.input_mapping,
            'output_mapping': self.output_mapping,
            'description': self.description,
        }
        if self.pin_definitions:
            config['pin_definitions'] = self.pin_definitions
        if self.trained:
            config['trained'] = self.trained
            config['training_accuracy'] = self.training_accuracy
            config['training_iterations'] = self.training_iterations
            config['training_loss'] = self.training_loss
        return config



# ─── Rule-Based Processor (Fallback) ────────────────────────────────────────

class RuleBasedProcessor:
    """
    Rule-based fallback processor for when LNN accuracy is low.
    
    Handles common robot types directly:
    - Obstacle avoidance robots: turn away from closest obstacle
    - Line-following robots: follow the line based on sensor values
    - Generic robots: use behavior rules from description
    """

    # Keywords for detecting robot type
    OBSTACLE_KEYWORDS = ['obstacle', 'avoid', 'ultrasonic', 'distance', 'proximity', 'ir_sensor', 'sonar', 'range']
    LINE_KEYWORDS = ['line', 'follow', 'track', 'ir', 'infrared', 'reflectance', 'qtr']

    @staticmethod
    def detect_robot_type(input_names: list, output_names: list, description: str) -> str:
        """Detect robot type from sensor/actuator names and description."""
        all_text = ' '.join(input_names + output_names).lower() + ' ' + description.lower()
        
        obstacle_score = sum(1 for kw in RuleBasedProcessor.OBSTACLE_KEYWORDS if kw in all_text)
        line_score = sum(1 for kw in RuleBasedProcessor.LINE_KEYWORDS if kw in all_text)
        
        if obstacle_score > line_score:
            return 'obstacle_avoidance'
        elif line_score > 0:
            return 'line_following'
        else:
            return 'generic'

    @staticmethod
    def process(sensor_data: dict, input_values: list, input_mapping: dict,
                output_mapping: dict, output_types: dict, description: str) -> dict:
        """
        Process sensor data using rule-based logic.
        
        Returns dict of {output_name: normalized_value} or empty dict if no rules apply.
        """
        input_names = list(input_mapping.keys())
        output_names = list(output_mapping.keys())
        
        robot_type = RuleBasedProcessor.detect_robot_type(input_names, output_names, description)
        
        if robot_type == 'obstacle_avoidance':
            return RuleBasedProcessor._obstacle_avoidance_rules(
                sensor_data, input_values, input_mapping, output_mapping, description
            )
        elif robot_type == 'line_following':
            return RuleBasedProcessor._line_following_rules(
                sensor_data, input_values, input_mapping, output_mapping, description
            )
        else:
            return RuleBasedProcessor._generic_rules(
                sensor_data, input_values, input_mapping, output_mapping, description
            )

    @staticmethod
    def _obstacle_avoidance_rules(sensor_data: dict, input_values: list,
                                   input_mapping: dict, output_mapping: dict,
                                   description: str) -> dict:
        """
        Obstacle avoidance: IF front sensor < threshold -> turn away from closest obstacle.
        
        Sensors: proximity/distance sensors (0.0 = very close, 1.0 = far)
        Outputs: motor_left, motor_right (0.0 = stopped, 1.0 = full speed)
        """
        input_names = list(input_mapping.keys())
        output_names = list(output_mapping.keys())
        
        # Get normalized sensor values (0 = obstacle close, 1 = clear)
        sensor_vals = {}
        for name, idx in input_mapping.items():
            if idx < len(input_values):
                sensor_vals[name] = input_values[idx]
            else:
                sensor_vals[name] = 0.5
        
        # Find left/right/front sensors by name patterns
        left_sensors = []
        right_sensors = []
        front_sensors = []
        
        for name, val in sensor_vals.items():
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'l']):
                left_sensors.append((name, val))
            elif any(kw in name_lower for kw in ['right', 'r']):
                right_sensors.append((name, val))
            else:
                front_sensors.append((name, val))
        
        # If no left/right distinction, split sensors evenly
        if not left_sensors and not right_sensors:
            n = len(list(sensor_vals.values()))
            half = n // 2
            all_vals = list(sensor_vals.items())
            left_sensors = all_vals[:half]
            right_sensors = all_vals[half:]
            front_sensors = []
        
        # Compute left/right obstacle proximity (lower value = closer obstacle)
        left_min = min((v for _, v in left_sensors), default=1.0)
        right_min = min((v for _, v in right_sensors), default=1.0)
        front_min = min((v for _, v in front_sensors), default=1.0)
        
        # Overall minimum (closest obstacle)
        overall_min = min(left_min, right_min, front_min)
        
        # Determine motor outputs by name patterns
        left_motor_name = None
        right_motor_name = None
        other_outputs = []
        
        for name in output_names:
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'l_']):
                left_motor_name = name
            elif any(kw in name_lower for kw in ['right', 'r_']):
                right_motor_name = name
        
        if not left_motor_name or not right_motor_name:
            # Assign by index: first output = left, second = right
            if len(output_names) >= 2:
                left_motor_name = output_names[0]
                right_motor_name = output_names[1]
            other_outputs = output_names[2:]
        else:
            other_outputs = [n for n in output_names if n not in (left_motor_name, right_motor_name)]
        
        # Obstacle avoidance logic:
        # - Clear path (all sensors high): both motors full speed
        # - Obstacle left: turn right (slow down right motor, speed up left)
        # - Obstacle right: turn left (slow down left motor, speed up right)
        # - Obstacle front/both: sharp turn
        
        OBSTACLE_THRESHOLD = 0.4  # Below this = obstacle detected
        
        if overall_min > OBSTACLE_THRESHOLD:
            # Clear path: go forward
            left_speed = 0.9
            right_speed = 0.9
        elif left_min < OBSTACLE_THRESHOLD and right_min >= OBSTACLE_THRESHOLD:
            # Obstacle on left: turn right
            left_speed = 0.9
            right_speed = 0.2 + 0.3 * right_min
        elif right_min < OBSTACLE_THRESHOLD and left_min >= OBSTACLE_THRESHOLD:
            # Obstacle on right: turn left
            left_speed = 0.2 + 0.3 * left_min
            right_speed = 0.9
        elif front_min < OBSTACLE_THRESHOLD:
            # Obstacle in front: sharp turn (turn right by default)
            left_speed = 0.8
            right_speed = 0.1
        else:
            # Obstacles on both sides: slight right turn
            left_speed = 0.7
            right_speed = 0.3
        
        # Scale speed by how close the nearest obstacle is
        safety_factor = max(0.3, overall_min)
        left_speed *= safety_factor
        right_speed *= safety_factor
        
        # Clamp
        left_speed = max(0.0, min(1.0, left_speed))
        right_speed = max(0.0, min(1.0, right_speed))
        
        outputs = {}
        if left_motor_name:
            outputs[left_motor_name] = left_speed
        if right_motor_name:
            outputs[right_motor_name] = right_speed
        
        # Other outputs: use threshold logic
        for name in other_outputs:
            name_lower = name.lower()
            if 'led' in name_lower or 'buzzer' in name_lower:
                outputs[name] = 1.0 if overall_min < OBSTACLE_THRESHOLD else 0.0
            else:
                outputs[name] = 0.5
        
        return outputs

    @staticmethod
    def _line_following_rules(sensor_data: dict, input_values: list,
                               input_mapping: dict, output_mapping: dict,
                               description: str) -> dict:
        """
        Line following: follow the line based on sensor values.
        
        Sensors: IR/reflectance sensors (0.0 = on line/dark, 1.0 = off line/light)
        Outputs: motor_left, motor_right (0.0 = stopped, 1.0 = full speed)
        """
        input_names = list(input_mapping.keys())
        output_names = list(output_mapping.keys())
        
        sensor_vals = {}
        for name, idx in input_mapping.items():
            if idx < len(input_values):
                sensor_vals[name] = input_values[idx]
            else:
                sensor_vals[name] = 0.5
        
        # Find left/right/center sensors
        left_sensors = []
        right_sensors = []
        center_sensors = []
        
        for name, val in sensor_vals.items():
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'l']):
                left_sensors.append((name, val))
            elif any(kw in name_lower for kw in ['right', 'r']):
                right_sensors.append((name, val))
            else:
                center_sensors.append((name, val))
        
        # Compute average sensor values (for line: low value = on line)
        left_avg = sum(v for _, v in left_sensors) / max(len(left_sensors), 1)
        right_avg = sum(v for _, v in right_sensors) / max(len(right_sensors), 1)
        center_avg = sum(v for _, v in center_sensors) / max(len(center_sensors), 1)
        
        # Determine motor names
        left_motor_name = None
        right_motor_name = None
        for name in output_names:
            name_lower = name.lower()
            if any(kw in name_lower for kw in ['left', 'l_']):
                left_motor_name = name
            elif any(kw in name_lower for kw in ['right', 'r_']):
                right_motor_name = name
        if not left_motor_name or not right_motor_name:
            if len(output_names) >= 2:
                left_motor_name = output_names[0]
                right_motor_name = output_names[1]
        
        # Line following logic: on_line = low value (0.0), off_line = high value (1.0)
        # If line is to the left (left sensor on line): turn left
        # If line is to the right (right sensor on line): turn right
        # If line is centered: go straight
        
        LINE_THRESHOLD = 0.5
        
        left_on_line = left_avg < LINE_THRESHOLD
        right_on_line = right_avg < LINE_THRESHOLD
        center_on_line = center_avg < LINE_THRESHOLD
        
        if center_on_line or (not left_on_line and not right_on_line):
            # Go straight
            left_speed = 0.8
            right_speed = 0.8
        elif left_on_line and not right_on_line:
            # Line to the left: turn left
            left_speed = 0.4
            right_speed = 0.8
        elif right_on_line and not left_on_line:
            # Line to the right: turn right
            left_speed = 0.8
            right_speed = 0.4
        else:
            # Both sensors on line: go straight
            left_speed = 0.7
            right_speed = 0.7
        
        outputs = {}
        if left_motor_name:
            outputs[left_motor_name] = max(0.0, min(1.0, left_speed))
        if right_motor_name:
            outputs[right_motor_name] = max(0.0, min(1.0, right_speed))
        
        # Other outputs
        other_names = [n for n in output_names if n not in outputs]
        for name in other_names:
            outputs[name] = 0.5
        
        return outputs

    @staticmethod
    def _generic_rules(sensor_data: dict, input_values: list,
                        input_mapping: dict, output_mapping: dict,
                        description: str) -> dict:
        """
        Generic robot: react to sensor inputs with proportional responses.
        Higher input -> higher output for corresponding actuator.
        """
        input_names = list(input_mapping.keys())
        output_names = list(output_mapping.keys())
        
        sensor_vals = [input_values[idx] if idx < len(input_values) else 0.5 
                       for idx in range(len(input_names))]
        
        outputs = {}
        for i, name in enumerate(output_names):
            # Map corresponding input to output (or average if inputs < outputs)
            if i < len(sensor_vals):
                outputs[name] = 1.0 - sensor_vals[i]  # Inverse: close obstacle -> fast motor
            else:
                avg = sum(sensor_vals) / max(len(sensor_vals), 1)
                outputs[name] = 1.0 - avg
            outputs[name] = max(0.0, min(1.0, outputs[name]))
        
        return outputs

    @staticmethod
    def generate_training_scenarios(config: dict) -> list:
        """
        Generate rule-based training scenarios for a robot config.
        Produces 50+ diverse scenarios with strong input-output correlations.
        """
        input_mapping = config.get('input_mapping', {})
        output_mapping = config.get('output_mapping', {})
        description = config.get('description', '')
        input_names = list(input_mapping.keys())
        output_names = list(output_mapping.keys())
        
        robot_type = RuleBasedProcessor.detect_robot_type(input_names, output_names, description)
        scenarios = []
        
        if robot_type == 'obstacle_avoidance':
            scenarios = RuleBasedProcessor._obstacle_training_scenarios(
                input_names, output_names
            )
        elif robot_type == 'line_following':
            scenarios = RuleBasedProcessor._line_training_scenarios(
                input_names, output_names
            )
        else:
            scenarios = RuleBasedProcessor._generic_training_scenarios(
                input_names, output_names
            )
        
        return scenarios

    @staticmethod
    def _obstacle_training_scenarios(input_names: list, output_names: list) -> list:
        """Generate obstacle avoidance training scenarios with strong signals."""
        scenarios = []
        
        # Find motor output names
        left_motor = None
        right_motor = None
        for name in output_names:
            nl = name.lower()
            if any(kw in nl for kw in ['left', 'l_']):
                left_motor = name
            elif any(kw in nl for kw in ['right', 'r_']):
                right_motor = name
        if not left_motor or not right_motor:
            left_motor = output_names[0] if len(output_names) > 0 else None
            right_motor = output_names[1] if len(output_names) > 1 else None
        
        # Scenario 1: Clear path - all sensors high (far from obstacles)
        # Both motors: full speed
        for _ in range(8):
            inputs = {n: round(random.uniform(0.8, 1.0), 3) for n in input_names}
            expected = {left_motor: round(random.uniform(0.85, 1.0), 3),
                       right_motor: round(random.uniform(0.85, 1.0), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 2: Obstacle on left - turn right
        # Left sensors low, right sensors high
        left_input_names = [n for n in input_names if any(kw in n.lower() for kw in ['left', 'l'])]
        right_input_names = [n for n in input_names if any(kw in n.lower() for kw in ['right', 'r'])]
        other_input_names = [n for n in input_names if n not in left_input_names and n not in right_input_names]
        
        if not left_input_names and not right_input_names:
            half = len(input_names) // 2
            left_input_names = input_names[:half]
            right_input_names = input_names[half:]
        
        for _ in range(8):
            inputs = {}
            for n in left_input_names:
                inputs[n] = round(random.uniform(0.0, 0.3), 3)
            for n in right_input_names:
                inputs[n] = round(random.uniform(0.6, 1.0), 3)
            for n in other_input_names:
                inputs[n] = round(random.uniform(0.4, 0.7), 3)
            # Obstacle left: left motor fast, right motor slow
            expected = {left_motor: round(random.uniform(0.8, 1.0), 3),
                       right_motor: round(random.uniform(0.1, 0.3), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 3: Obstacle on right - turn left
        for _ in range(8):
            inputs = {}
            for n in left_input_names:
                inputs[n] = round(random.uniform(0.6, 1.0), 3)
            for n in right_input_names:
                inputs[n] = round(random.uniform(0.0, 0.3), 3)
            for n in other_input_names:
                inputs[n] = round(random.uniform(0.4, 0.7), 3)
            expected = {left_motor: round(random.uniform(0.1, 0.3), 3),
                       right_motor: round(random.uniform(0.8, 1.0), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 4: Obstacle in front (all sensors low) - sharp turn
        for _ in range(6):
            inputs = {n: round(random.uniform(0.0, 0.25), 3) for n in input_names}
            # Sharp right turn to escape
            expected = {left_motor: round(random.uniform(0.7, 0.9), 3),
                       right_motor: round(random.uniform(0.0, 0.15), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 5: Obstacle approaching (medium range)
        for _ in range(6):
            inputs = {n: round(random.uniform(0.3, 0.6), 3) for n in input_names}
            # Moderate speed
            expected = {left_motor: round(random.uniform(0.4, 0.6), 3),
                       right_motor: round(random.uniform(0.4, 0.6), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 6: Obstacle very close left only
        for _ in range(5):
            inputs = {}
            for n in left_input_names:
                inputs[n] = round(random.uniform(0.0, 0.15), 3)
            for n in right_input_names:
                inputs[n] = round(random.uniform(0.9, 1.0), 3)
            for n in other_input_names:
                inputs[n] = round(random.uniform(0.7, 1.0), 3)
            expected = {left_motor: round(random.uniform(0.9, 1.0), 3),
                       right_motor: round(random.uniform(0.0, 0.1), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Scenario 7: Obstacle very close right only
        for _ in range(5):
            inputs = {}
            for n in left_input_names:
                inputs[n] = round(random.uniform(0.9, 1.0), 3)
            for n in right_input_names:
                inputs[n] = round(random.uniform(0.0, 0.15), 3)
            for n in other_input_names:
                inputs[n] = round(random.uniform(0.7, 1.0), 3)
            expected = {left_motor: round(random.uniform(0.0, 0.1), 3),
                       right_motor: round(random.uniform(0.9, 1.0), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Add remaining output names to scenarios
        for s in scenarios:
            for name in output_names:
                if name not in s['expected_outputs']:
                    s['expected_outputs'][name] = 0.5
        
        return scenarios

    @staticmethod
    def _line_training_scenarios(input_names: list, output_names: list) -> list:
        """Generate line following training scenarios."""
        scenarios = []
        
        left_motor = output_names[0] if len(output_names) > 0 else None
        right_motor = output_names[1] if len(output_names) > 1 else None
        
        # Line centered
        for _ in range(10):
            inputs = {n: round(random.uniform(0.0, 0.3), 3) for n in input_names}
            expected = {left_motor: 0.8, right_motor: 0.8} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Line to the left
        left_inputs = [n for n in input_names if 'left' in n.lower() or 'l' in n.lower()]
        right_inputs = [n for n in input_names if 'right' in n.lower() or 'r' in n.lower()]
        other_inputs = [n for n in input_names if n not in left_inputs and n not in right_inputs]
        
        for _ in range(8):
            inputs = {}
            for n in left_inputs: inputs[n] = round(random.uniform(0.0, 0.2), 3)
            for n in right_inputs: inputs[n] = round(random.uniform(0.7, 1.0), 3)
            for n in other_inputs: inputs[n] = round(random.uniform(0.3, 0.6), 3)
            expected = {left_motor: round(random.uniform(0.3, 0.5), 3),
                       right_motor: round(random.uniform(0.7, 0.9), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # Line to the right
        for _ in range(8):
            inputs = {}
            for n in left_inputs: inputs[n] = round(random.uniform(0.7, 1.0), 3)
            for n in right_inputs: inputs[n] = round(random.uniform(0.0, 0.2), 3)
            for n in other_inputs: inputs[n] = round(random.uniform(0.3, 0.6), 3)
            expected = {left_motor: round(random.uniform(0.7, 0.9), 3),
                       right_motor: round(random.uniform(0.3, 0.5), 3)} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        # No line (all sensors high)
        for _ in range(5):
            inputs = {n: round(random.uniform(0.8, 1.0), 3) for n in input_names}
            expected = {left_motor: 0.5, right_motor: 0.5} if left_motor and right_motor else {}
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        
        for s in scenarios:
            for name in output_names:
                if name not in s['expected_outputs']:
                    s['expected_outputs'][name] = 0.5
        
        return scenarios

    @staticmethod
    def _generic_training_scenarios(input_names: list, output_names: list) -> list:
        """Generate generic inverse-response training scenarios."""
        scenarios = []
        for _ in range(50):
            inputs = {}
            for n in input_names:
                inputs[n] = round(random.random(), 3)
            expected = {}
            for i, name in enumerate(output_names):
                if i < len(input_names):
                    expected[name] = round(1.0 - inputs[input_names[i]], 3)
                else:
                    avg = sum(inputs.values()) / len(inputs)
                    expected[name] = round(1.0 - avg, 3)
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})
        return scenarios


# ─── In-Memory Store ────────────────────────────────────────────────────────

class ModelStore:
    """In-memory store for generated LNN models."""

    def __init__(self):
        self.models = {}  # model_id -> {config, lnn, created_at, robot_name}
        self.brains = {}  # brain_id -> {model_id, service_id, url, status, robot_name}

    def add_model(self, model_id: str, config: dict, robot_name: str) -> LiquidNeuralNetwork:
        lnn = LiquidNeuralNetwork(config)
        self.models[model_id] = {
            'config': config,
            'lnn': lnn,
            'created_at': datetime.now().isoformat(),
            'robot_name': robot_name,
        }
        return lnn

    def update_model_config(self, model_id: str, config: dict):
        """Update stored config for a model (e.g. after training)."""
        if model_id in self.models:
            self.models[model_id]['config'] = config

    def get_model(self, model_id: str) -> Optional[dict]:
        return self.models.get(model_id)

    def get_lnn(self, model_id: str) -> Optional[LiquidNeuralNetwork]:
        m = self.models.get(model_id)
        return m['lnn'] if m else None

    def add_brain(self, brain_id: str, model_id: str, service_id: str, url: str, robot_name: str):
        self.brains[brain_id] = {
            'model_id': model_id,
            'service_id': service_id,
            'url': url,
            'ws_url': f"wss://{url.replace('https://', '').replace('http://', '')}",
            'status': 'deploying',
            'robot_name': robot_name,
            'created_at': datetime.now().isoformat(),
        }

    def update_brain_status(self, brain_id: str, status: str):
        if brain_id in self.brains:
            self.brains[brain_id]['status'] = status

    def get_brain(self, brain_id: str) -> Optional[dict]:
        return self.brains.get(brain_id)

    def list_models(self) -> list:
        return [
            {
                'model_id': mid,
                'robot_name': m['robot_name'],
                'input_size': m['config'].get('input_size'),
                'output_size': m['config'].get('output_size'),
                'trained': m['config'].get('trained', False),
                'training_accuracy': m['config'].get('training_accuracy'),
                'created_at': m['created_at'],
            }
            for mid, m in self.models.items()
        ]

    def list_brains(self) -> list:
        return [
            {
                'brain_id': bid,
                **b,
            }
            for bid, b in self.brains.items()
        ]


store = ModelStore()

# Robot name to model_id mapping for multi-model routing
ROBOT_MODEL_MAP = {}  # robot_name -> model_id

# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(title="Airone Deploy API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Load MODEL_CONFIG from env on startup ──────────────────────────────────

# The default model ID for brain-template mode
ENV_MODEL_ID = None

@app.on_event("startup")
async def load_model_from_env():
    """Load LNN model from MODEL_CONFIG environment variable if present.
    
    Supports both single-model and multi-model formats:
    - Single: {"input_size": 2, "output_size": 2, ...}
    - Multi: {"robot-name": {"input_size": 2, ...}, "other-robot": {...}}
    """
    global ENV_MODEL_ID

    model_config_raw = os.environ.get('MODEL_CONFIG', '')
    robot_name = os.environ.get('ROBOT_NAME', 'brain-template')

    if model_config_raw and model_config_raw != '{}':
        try:
            config = json.loads(model_config_raw)
            if config.get('input_size'):
                # Single model format
                ENV_MODEL_ID = f"lnn_{robot_name.lower().replace(' ', '_')}_env"
                store.add_model(ENV_MODEL_ID, config, robot_name)
                ROBOT_MODEL_MAP[robot_name.lower().replace(' ', '-')] = ENV_MODEL_ID
                logger.info(f"Loaded LNN from MODEL_CONFIG: {ENV_MODEL_ID} "
                           f"({config.get('input_size')} inputs -> {config.get('output_size')} outputs)")
                logger.info(f"Brain mode: Robot '{robot_name}' ready for WebSocket connections")
                # Check training accuracy and warn if low
                trained_acc = config.get('training_accuracy')
                if trained_acc is None or trained_acc < 0.6:
                    logger.warning(f"Robot '{robot_name}' LNN accuracy={trained_acc:.2%} < 60%: "
                                   f"rule-based fallback will be used for inference")
                elif trained_acc is None:
                    logger.warning(f"Robot '{robot_name}' LNN is not trained: "
                                   f"rule-based fallback will be used for inference")
            else:
                # Multi-model format: {"robot-name": {...config...}, ...}
                for rname, rconfig in config.items():
                    if isinstance(rconfig, dict) and rconfig.get('input_size'):
                        mid = f"lnn_{rname.lower().replace(' ', '_')}_env"
                        store.add_model(mid, rconfig, rname)
                        ROBOT_MODEL_MAP[rname.lower().replace(' ', '-')] = mid
                        if not ENV_MODEL_ID:
                            ENV_MODEL_ID = mid  # Default to first model
                        logger.info(f"Loaded multi-model: {mid} for robot '{rname}' "
                                   f"({rconfig.get('input_size')} inputs -> {rconfig.get('output_size')} outputs)")
                logger.info(f"Brain mode: {len(ROBOT_MODEL_MAP)} robot(s) loaded: {list(ROBOT_MODEL_MAP.keys())}")
                # Check training accuracy for all loaded models
                for rname, mid in ROBOT_MODEL_MAP.items():
                    m = store.get_model(mid)
                    if m:
                        acc = m['config'].get('training_accuracy')
                        if acc is None or acc < 0.6:
                            logger.warning(f"Robot '{rname}' LNN accuracy={acc:.2%} < 60%: "
                                           f"rule-based fallback will be used")
                        elif acc is None:
                            logger.warning(f"Robot '{rname}' LNN is not trained: "
                                           f"rule-based fallback will be used")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse MODEL_CONFIG: {e}")

# ─── Request Models ──────────────────────────────────────────────────────────

class GenerateLNNRequest(BaseModel):
    user_id: str = "default"
    robot_name: str = "my-robot"
    description: str = ""
    pin_definitions: Optional[dict] = None  # {"inputs": [...], "outputs": [...]}
    sensor_count: int = 2
    actuator_count: int = 2

class DeployBrainRequest(BaseModel):
    model_id: str
    robot_name: str = "my-robot"
    user_id: str = "default"

class TestInferenceRequest(BaseModel):
    model_id: str
    sensor_data: dict  # {"sensor_name": value, ...}
    output_modules: list  # ["motor_left", "motor_right", ...]

# ─── Health Check ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    result = {
        "status": "ok",
        "service": "airone-brain" if BRAIN_MODE else "airone-deploy",
        "models_count": len(store.models),
        "brains_count": len(store.brains),
        "robots_loaded": list(ROBOT_MODEL_MAP.keys()),
        "render_api_configured": bool(RENDER_API_KEY),
        "nvidia_api_configured": bool(NVIDIA_API_KEY),
    }
    if BRAIN_MODE:
        result["brain_mode"] = True
        result["robot_name"] = ROBOT_NAME
        if ENV_MODEL_ID:
            lnn = store.get_lnn(ENV_MODEL_ID)
            if lnn:
                result["model_info"] = {
                    "model_id": ENV_MODEL_ID,
                    "input_size": lnn.input_size,
                    "output_size": lnn.output_size,
                    "input_mapping": list(lnn.input_mapping.keys()),
                    "output_mapping": list(lnn.output_mapping.keys()),
                    "trained": lnn.trained,
                    "training_accuracy": lnn.training_accuracy,
                }
    return result

# ─── Root WebSocket (Brain Mode) ────────────────────────────────────────────
# When running as brain-template, robots connect to / for inference

@app.websocket("/")
async def brain_websocket(websocket: WebSocket):
    """
    Root WebSocket endpoint for brain-template mode.
    Robots connect here to send sensor data and receive commands.
    Supports multi-model routing via ?robot=name query parameter.
    """
    await websocket.accept()

    # Check for ?robot=name query parameter
    robot_key = None
    try:
        query_string = websocket.query_params.get("robot") or websocket.query_params.get("name")
        if query_string:
            robot_key = query_string.lower().replace(' ', '-')
    except:
        pass

    # Find the right model for this robot
    model_id = None
    if robot_key and robot_key in ROBOT_MODEL_MAP:
        model_id = ROBOT_MODEL_MAP[robot_key]
    elif ENV_MODEL_ID:
        model_id = ENV_MODEL_ID
    
    lnn = store.get_lnn(model_id) if model_id else None

    if not lnn:
        await websocket.send_text(json.dumps({
            "error": f"No LNN model found for robot '{robot_key}'. Set MODEL_CONFIG env var.",
            "status": "no_model"
        }))
        await websocket.close()
        return

    connected_robot_name = robot_key or ROBOT_NAME
    logger.info(f"Robot connected to brain: {connected_robot_name} (model: {model_id})")

    # Send welcome message
    accuracy_info = ""
    if lnn.training_accuracy is None or lnn.training_accuracy < 0.6:
        accuracy_info = " (rule-based fallback active: LNN accuracy too low)"
    await websocket.send_text(json.dumps({
        "status": "connected",
        "robot_name": connected_robot_name,
        "model_id": model_id,
        "input_sensors": list(lnn.input_mapping.keys()),
        "output_actuators": list(lnn.output_mapping.keys()),
        "training_accuracy": lnn.training_accuracy,
        "processing_mode": "rule_based_fallback" if (lnn.training_accuracy is None or lnn.training_accuracy < 0.6) else "lnn",
        "info": accuracy_info,
    }))
    if lnn.training_accuracy is None or lnn.training_accuracy < 0.6:
        logger.warning(f"LNN accuracy {lnn.training_accuracy:.2%} < 60%, using rule-based fallback for {connected_robot_name}")

    command_counter = 0

    try:
        while True:
            data = await websocket.receive_text()

            try:
                parsed = None
                try:
                    parsed = json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    pass

                if parsed and isinstance(parsed, dict):
                    sensor_data = parsed.get('input_sensors_read', {})
                    output_modules = parsed.get('output_modules_available', list(lnn.output_mapping.keys()))
                else:
                    # Natural language format from ESP32
                    sensors_match = re.search(
                        r'Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)', data, re.IGNORECASE
                    )
                    outputs_match = re.search(
                        r'What do you want to do to:\s*\n?\s*\(([^)]*)\)', data, re.IGNORECASE
                    )

                    sensor_data = {}
                    if sensors_match:
                        for pair in sensors_match.group(1).split(','):
                            if ':' in pair:
                                key, val = pair.split(':', 1)
                                try:
                                    sensor_data[key.strip()] = float(val.strip())
                                except ValueError:
                                    sensor_data[key.strip()] = val.strip()

                    output_modules = []
                    if outputs_match:
                        output_modules = [
                            m.strip().replace('.', '')
                            for m in outputs_match.group(1).split(',') if m.strip()
                        ]

                    if not output_modules:
                        output_modules = list(lnn.output_mapping.keys())

                # Run inference
                commands = lnn.process_sensor_data(sensor_data, output_modules)

                command_counter += 1
                response = {
                    "command_id": f"cmd_{command_counter}",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "output_commands": commands,
                    "metadata": {
                        "model": "LNN (Liquid Neural Network)",
                        "model_id": model_id,
                        "robot_name": ROBOT_NAME,
                        "inputs_processed": len(sensor_data),
                        "outputs_generated": len(commands),
                        "processing_mode": "rule_based_fallback" if (lnn.training_accuracy is None or lnn.training_accuracy < 0.6) else "lnn",
                        "hidden_state_norm": round(
                            sum(h*h for h in lnn.hidden_state) ** 0.5, 4
                        ),
                    }
                }

                await websocket.send_text(json.dumps(response))
                logger.info(f"Sent commands: {list(commands.keys())}")

            except Exception as e:
                logger.error(f"Error processing message: {e}")
                try:
                    await websocket.send_text(json.dumps({
                        "error": str(e),
                        "command_id": f"cmd_error_{command_counter}"
                    }))
                except:
                    pass

    except WebSocketDisconnect:
        logger.info(f"Robot disconnected from brain: {ROBOT_NAME}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        logger.info(f"Connection closed for brain: {ROBOT_NAME}")

# ─── Kimi K2.6 API with Retry Logic ─────────────────────────────────────────

async def call_kimi_api(system_prompt: str, user_prompt: str,
                       max_tokens: int = 2048) -> str:
    """
    Call NVIDIA Kimi K2.6 API with streaming support, retry logic,
    and fallback to Llama 3.1 8B if Kimi times out.

    Features:
    - Streaming: Uses stream=true to avoid timeout on long responses
    - Retry with exponential backoff on transient failures
    - Fallback: If Kimi K2.6 fails, tries meta/llama-3.1-8b-instruct

    Args:
        system_prompt: System message for the LLM
        user_prompt: User message for the LLM
        max_tokens: Maximum tokens to generate (default 2048)

    Raises:
        Exception: If all retries and fallbacks are exhausted.
    """
    # Try Kimi K2.6 first with streaming
    try:
        result = await _call_nvidia_api_streaming(
            NVIDIA_MODEL, system_prompt, user_prompt, max_tokens
        )
        return result
    except Exception as e:
        logger.warning(f"Kimi K2.6 failed: {e}. Trying Llama 3.1 8B fallback...")

    # Fallback to Llama 3.1 8B Instruct (faster, more available)
    try:
        result = await _call_nvidia_api_streaming(
            "meta/llama-3.1-8b-instruct", system_prompt, user_prompt, max_tokens
        )
        logger.info("Llama 3.1 8B fallback succeeded")
        return result
    except Exception as e2:
        logger.error(f"Llama fallback also failed: {e2}")
        raise Exception(f"Both Kimi K2.6 and Llama fallback failed: {e2}")


async def _call_nvidia_api_streaming(model: str, system_prompt: str,
                                      user_prompt: str, max_tokens: int) -> str:
    """
    Call NVIDIA API with streaming support.
    Collects chunks to avoid timeout on long responses.
    """
    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "top_p": 1.0,
        "stream": True,
    }

    last_error = None

    for attempt in range(1, KIMI_MAX_RETRIES + 1):
        logger.info(f"Calling {model} API (attempt {attempt}/{KIMI_MAX_RETRIES}, streaming)...")

        try:
            # Use streaming to collect response incrementally
            collected_content = []
            async with httpx.AsyncClient(timeout=KIMI_TIMEOUT) as client:
                async with client.stream("POST", NVIDIA_API_URL, headers=headers, json=payload) as response:
                    if response.status_code == 200:
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data_str = line[6:].strip()
                                if data_str == "[DONE]":
                                    break
                                try:
                                    chunk = json.loads(data_str)
                                    delta = chunk.get('choices', [{}])[0].get('delta', {})
                                    content_piece = delta.get('content', '')
                                    if content_piece:
                                        collected_content.append(content_piece)
                                except json.JSONDecodeError:
                                    continue
                        full_content = ''.join(collected_content)
                        if full_content:
                            logger.info(f"{model} streaming response received: {len(full_content)} chars")
                            return full_content
                        else:
                            logger.warning(f"{model} returned empty streaming response")
                            last_error = Exception("Empty streaming response")
                    elif response.status_code in (429, 500, 502, 503, 504):
                        error_body = await response.aread()
                        error_detail = error_body.decode()[:300]
                        last_error = Exception(f"API error (retryable): {response.status_code} - {error_detail}")
                        logger.warning(f"{model} returned {response.status_code}, retrying...")
                    else:
                        error_body = await response.aread()
                        error_detail = error_body.decode()[:500]
                        logger.error(f"{model} API error (non-retryable): {response.status_code} - {error_detail}")
                        raise Exception(f"API error: {response.status_code} - {error_detail}")

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_error = e
            logger.warning(f"{model} timeout/connection error on attempt "
                           f"{attempt}/{KIMI_MAX_RETRIES}: {e}")

        # Exponential backoff before next retry
        if attempt < KIMI_MAX_RETRIES:
            backoff = KIMI_BACKOFF_BASE ** attempt
            logger.info(f"Retrying in {backoff}s...")
            await asyncio.sleep(backoff)

    # All retries exhausted
    raise Exception(f"{model} unavailable after {KIMI_MAX_RETRIES} retries: {last_error}")


# ─── LNN Config Extraction ──────────────────────────────────────────────────

def extract_lnn_config_from_kimi_response(response_text: str, request: GenerateLNNRequest) -> dict:
    """
    Extract LNN configuration from Kimi's response.
    Kimi should return a JSON block with the model configuration.
    If JSON extraction fails, construct config from the request parameters.
    """
    config = None

    # Look for JSON in markdown code blocks
    json_patterns = [
        r'```json\s*\n(.*?)\n\s*```',
        r'```\s*\n(\{.*?\})\n\s*```',
        r'(\{[^{}]*"input_size"[^{}]*\})',
        r'(\{[^{}]*"input_mapping"[^{}]*\})',
    ]

    for pattern in json_patterns:
        matches = re.findall(pattern, response_text, re.DOTALL)
        for match in matches:
            try:
                parsed = json.loads(match)
                if 'input_size' in parsed or 'input_mapping' in parsed:
                    config = parsed
                    break
            except json.JSONDecodeError:
                continue
        if config:
            break

    # Build pin mappings from request
    input_mapping = {}
    output_mapping = {}

    if request.pin_definitions:
        inputs = request.pin_definitions.get('inputs', [])
        outputs = request.pin_definitions.get('outputs', [])

        for i, pin in enumerate(inputs):
            name = pin if isinstance(pin, str) else pin.get('name', f'sensor_{i}')
            input_mapping[name] = i

        for i, pin in enumerate(outputs):
            name = pin if isinstance(pin, str) else pin.get('name', f'actuator_{i}')
            output_mapping[name] = i

    if not input_mapping:
        for i in range(request.sensor_count):
            input_mapping[f'sensor_{i}'] = i

    if not output_mapping:
        for i in range(request.actuator_count):
            output_mapping[f'actuator_{i}'] = i

    if config:
        # Merge extracted config with request data
        config.setdefault('input_size', len(input_mapping) or request.sensor_count)
        config.setdefault('output_size', len(output_mapping) or request.actuator_count)
        config.setdefault('hidden_units', max(16, (config['input_size'] + config['output_size']) * 4))
        config.setdefault('input_mapping', input_mapping)
        config.setdefault('output_mapping', output_mapping)
        config.setdefault('description', request.description)
        config.setdefault('neuron_params', {'vt': 0.1, 'dt': 0.01, 'sensitivity': 0.5})
    else:
        # Construct config from request parameters + Kimi description
        config = {
            'input_size': len(input_mapping) or request.sensor_count,
            'output_size': len(output_mapping) or request.actuator_count,
            'hidden_units': max(16, (len(input_mapping) + len(output_mapping)) * 4),
            'time_steps': 1,
            'neuron_params': {'vt': 0.1, 'dt': 0.01, 'sensitivity': 0.5},
            'input_mapping': input_mapping,
            'output_mapping': output_mapping,
            'description': request.description,
            'kimi_response': response_text[:2000],
        }

    # Always include pin_definitions for output type info
    if request.pin_definitions:
        config['pin_definitions'] = request.pin_definitions

    return config


# ─── Generate LNN (Non-Streaming) ───────────────────────────────────────────

@app.post("/generate")
async def generate_lnn(req: GenerateLNNRequest):
    """Generate a new LNN model using Kimi K2.6 AI."""

    # Build the system prompt for Kimi
    pin_info = ""
    if req.pin_definitions:
        pin_info = f"""
Pin Definitions:
- Input sensors: {json.dumps(req.pin_definitions.get('inputs', []))}
- Output actuators: {json.dumps(req.pin_definitions.get('outputs', []))}
"""

    system_prompt = """You are an expert in Liquid Neural Networks (LNNs) and robotics. You design LNN model configurations for robots.

A Liquid Neural Network (LNN) uses continuous-time dynamics with ODE-inspired neuron updates:
  dh/dt = (activation - h) / tau
where tau is a time constant modulated by input.

You must return a JSON configuration with these fields:
{
  "input_size": <number of sensor inputs>,
  "output_size": <number of actuator outputs>,
  "hidden_units": <number of hidden units (typically 4-8x total IO)>,
  "neuron_params": {
    "vt": <time constant base, typically 0.05-0.2>,
    "dt": <time step, typically 0.01>,
    "sensitivity": <input sensitivity, typically 0.3-0.8>
  },
  "input_mapping": {"sensor_name": index, ...},
  "output_mapping": {"actuator_name": index, ...},
  "description": "<brief description of the robot behavior>",
  "behavior_notes": "<notes about expected behavior>"
}

The neuron_params should be tuned for the robot's task:
- Fast-reacting robots (obstacle avoidance): lower vt (0.05), higher sensitivity (0.7)
- Smooth control (arm movement): higher vt (0.15), lower sensitivity (0.4)
- Balancing robots: medium vt (0.1), medium sensitivity (0.5)

Return ONLY the JSON configuration, no extra text."""

    user_prompt = f"""Design an LNN model configuration for this robot:

Robot Name: {req.robot_name}
Description: {req.description}
Number of sensors: {req.sensor_count}
Number of actuators: {req.actuator_count}
{pin_info}

Return the JSON configuration."""

    kimi_response = ""
    kimi_used = False
    if NVIDIA_API_KEY:
        try:
            kimi_response = await call_kimi_api(system_prompt, user_prompt)
            kimi_used = True
        except Exception as e:
            logger.warning(f"Kimi API failed, generating config locally as fallback: {e}")
    else:
        logger.info("No NVIDIA_API_KEY configured, generating config locally")

    config = extract_lnn_config_from_kimi_response(kimi_response, req)

    # Generate model ID and store
    model_id = f"lnn_{req.robot_name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    lnn = store.add_model(model_id, config, req.robot_name)

    # Generate training data and train the LNN
    training_data = generate_synthetic_training_data(config)
    training_accuracy = 0.0
    training_loss = None
    training_iterations = 0

    if training_data:
        # Optionally enhance with Kimi
        if NVIDIA_API_KEY and kimi_used:
            try:
                training_system_prompt = """You are an expert in robotics and Liquid Neural Networks. Generate training scenarios for a robot.
For each scenario, provide inputs and expected_outputs as dictionaries mapping names to normalized [0.0,1.0] values.
Return ONLY a JSON object with a "scenarios" array of at least 30 scenarios."""
                training_user_prompt = f"""Robot: {req.robot_name}\nDescription: {req.description}\nSensors: {list(config.get('input_mapping', {}).keys())}\nActuators: {list(config.get('output_mapping', {}).keys())}"""
                training_response = await asyncio.wait_for(
                    call_kimi_api(training_system_prompt, training_user_prompt),
                    timeout=30.0
                )
                kimi_data = extract_training_data_from_kimi_response(training_response)
                if kimi_data:
                    training_data.extend(kimi_data)
            except Exception:
                pass  # Use synthetic data only

        # Train using evolutionary strategy
        train_result = lnn.train(training_data, iterations=300, population=30,
                                  sigma=0.15, learning_rate=0.04)
        training_accuracy = train_result.get('accuracy', 0.0)
        training_loss = train_result.get('best_loss')
        training_iterations = train_result.get('iterations', 0)

        # Update stored model config with training info
        config['trained'] = True
        config['training_accuracy'] = training_accuracy
        config['training_loss'] = training_loss
        config['training_iterations'] = training_iterations
        store.update_model_config(model_id, config)

    return {
        "status": "generated",
        "model_id": model_id,
        "config": config,
        "message": f"LNN model '{model_id}' generated and trained successfully for '{req.robot_name}'",
        "kimi_used": kimi_used,
        "training_accuracy": training_accuracy,
        "training_loss": training_loss,
        "training_iterations": training_iterations,
    }


# ─── Generate LNN with SSE Streaming ────────────────────────────────────────

async def generate_lnn_stream(req: GenerateLNNRequest) -> AsyncGenerator[str, None]:
    """
    Generate an LNN model with SSE progress streaming.

    Steps:
    1. Generating LNN architecture (Kimi K2.6 call for config)
    2. Creating training data (Kimi generates scenarios)
    3. Training LNN (Evolutionary Strategy)
    4. Checking for errors (validate model)
    5. Testing LNN behavior (run test scenarios)
    6. Finalizing model (store and return)
    """
    total_steps = 6
    model_id = f"lnn_{req.robot_name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    kimi_used = False
    training_accuracy = 0.0
    config = None

    # ── Step 1: Generating LNN architecture ──────────────────────────────
    yield sse_event("progress", {
        "step": "generating",
        "step_number": 1,
        "total_steps": total_steps,
        "message": "Generating LNN architecture with Kimi K2.6...",
        "progress": 16,
    })

    # Build system prompt
    pin_info = ""
    if req.pin_definitions:
        pin_info = f"""
Pin Definitions:
- Input sensors: {json.dumps(req.pin_definitions.get('inputs', []))}
- Output actuators: {json.dumps(req.pin_definitions.get('outputs', []))}
"""

    system_prompt_config = """You are an expert in Liquid Neural Networks (LNNs) and robotics. You design LNN model configurations for robots.

A Liquid Neural Network (LNN) uses continuous-time dynamics with ODE-inspired neuron updates:
  dh/dt = (activation - h) / tau
where tau is a time constant modulated by input.

You must return a JSON configuration with these fields:
{
  "input_size": <number of sensor inputs>,
  "output_size": <number of actuator outputs>,
  "hidden_units": <number of hidden units (typically 4-8x total IO)>,
  "neuron_params": {
    "vt": <time constant base, typically 0.05-0.2>,
    "dt": <time step, typically 0.01>,
    "sensitivity": <input sensitivity, typically 0.3-0.8>
  },
  "input_mapping": {"sensor_name": index, ...},
  "output_mapping": {"actuator_name": index, ...},
  "description": "<brief description of the robot behavior>",
  "behavior_notes": "<notes about expected behavior>"
}

The neuron_params should be tuned for the robot's task:
- Fast-reacting robots (obstacle avoidance): lower vt (0.05), higher sensitivity (0.7)
- Smooth control (arm movement): higher vt (0.15), lower sensitivity (0.4)
- Balancing robots: medium vt (0.1), medium sensitivity (0.5)

Return ONLY the JSON configuration, no extra text."""

    user_prompt_config = f"""Design an LNN model configuration for this robot:

Robot Name: {req.robot_name}
Description: {req.description}
Number of sensors: {req.sensor_count}
Number of actuators: {req.actuator_count}
{pin_info}

Return the JSON configuration."""

    kimi_response = ""
    if NVIDIA_API_KEY:
        try:
            # Use shorter timeout in SSE context to avoid hanging the stream
            kimi_response = await asyncio.wait_for(
                call_kimi_api(system_prompt_config, user_prompt_config),
                timeout=60.0
            )
            kimi_used = True
            yield sse_event("progress", {
                "step": "generating",
                "step_number": 1,
                "total_steps": total_steps,
                "message": "LNN architecture generated by Kimi K2.6",
                "progress": 16,
                "detail": "Kimi config received successfully",
            })
        except Exception as e:
            logger.warning(f"Kimi API failed for config generation: {e}")
            yield sse_event("progress", {
                "step": "generating",
                "step_number": 1,
                "total_steps": total_steps,
                "message": f"Kimi API unavailable, generating config locally: {str(e)[:100]}",
                "progress": 16,
            })
    else:
        yield sse_event("progress", {
            "step": "generating",
            "step_number": 1,
            "total_steps": total_steps,
            "message": "No NVIDIA_API_KEY configured, generating config locally",
            "progress": 16,
        })

    config = extract_lnn_config_from_kimi_response(kimi_response, req)

    # ── Step 2: Creating training data ───────────────────────────────────
    yield sse_event("progress", {
        "step": "creating_data",
        "step_number": 2,
        "total_steps": total_steps,
        "message": "Creating training data with Kimi K2.6...",
        "progress": 33,
    })

    training_data = []

    training_system_prompt = """You are an expert in robotics and Liquid Neural Networks. Generate training scenarios for a robot.

For each scenario, provide:
- inputs: Dictionary mapping sensor names to NORMALIZED values (0.0 = minimum reading, 1.0 = maximum reading)
  For proximity sensors: 0.0 = very close/obstacle, 1.0 = far/clear
  For IR line sensors: 0.0 = on line (black), 1.0 = off line (white)
- expected_outputs: Dictionary mapping actuator names to NORMALIZED values (0.0 = off/minimum, 1.0 = full speed/maximum)
  For motors: 0.0 = stopped, 1.0 = full speed forward
  For LEDs: 0.0 = off, 1.0 = on

Generate at least 50 diverse scenarios covering:
1. Normal operation (no obstacles, following line)
2. Edge cases (obstacle very close, sharp turns)
3. Gradual transitions (obstacle approaching, line curving)
4. Extreme scenarios (all sensors triggered, no sensors triggered)

Return ONLY a JSON object with a "scenarios" array."""

    input_names = list(config.get('input_mapping', {}).keys())
    output_names = list(config.get('output_mapping', {}).keys())

    training_user_prompt = f"""Generate training scenarios for this robot:

Robot Name: {req.robot_name}
Description: {req.description}
Input sensors: {json.dumps(input_names)}
Output actuators: {json.dumps(output_names)}

Return ONLY a JSON object with a "scenarios" array containing at least 50 scenarios.
Each scenario must have "inputs" and "expected_outputs" dictionaries mapping
sensor/actuator names to normalized float values in [0.0, 1.0]."""

    # Generate synthetic data first (fast, reliable) then optionally enhance with Kimi
    training_data = generate_synthetic_training_data(config)
    yield sse_event("progress", {
        "step": "creating_data",
        "step_number": 2,
        "total_steps": total_steps,
        "message": f"Generated {len(training_data)} base training scenarios",
        "progress": 33,
        "detail": f"synthetic scenarios: {len(training_data)}",
    })

    # Optionally enhance with Kimi-generated scenarios (non-blocking, with timeout)
    if NVIDIA_API_KEY:
        try:
            training_response = await asyncio.wait_for(
                call_kimi_api(training_system_prompt, training_user_prompt),
                timeout=45.0  # Short timeout to avoid blocking
            )
            kimi_data = extract_training_data_from_kimi_response(training_response)
            if kimi_data:
                training_data.extend(kimi_data)
                yield sse_event("progress", {
                    "step": "creating_data",
                    "step_number": 2,
                    "total_steps": total_steps,
                    "message": f"Enhanced with {len(kimi_data)} Kimi scenarios (total: {len(training_data)})",
                    "progress": 33,
                    "detail": f"kimi_scenarios: {len(kimi_data)}, total: {len(training_data)}",
                })
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"Kimi API skipped for training data: {e}")
            yield sse_event("progress", {
                "step": "creating_data",
                "step_number": 2,
                "total_steps": total_steps,
                "message": f"Using {len(training_data)} synthetic scenarios (Kimi timed out)",
                "progress": 33,
                "detail": f"fallback: synthetic only, scenarios: {len(training_data)}",
            })

    # Store the model now so we can train it
    lnn = store.add_model(model_id, config, req.robot_name)

    # ── Step 3: Training LNN ─────────────────────────────────────────────
    yield sse_event("progress", {
        "step": "training",
        "step_number": 3,
        "total_steps": total_steps,
        "message": "Training LNN (Evolutionary Strategy)...",
        "progress": 50,
    })

    # Create a queue for training progress events
    training_progress_queue = asyncio.Queue()

    def on_training_progress(iteration: int, current_loss: float, best_loss: float):
        """Callback for training progress updates."""
        try:
            training_progress_queue.put_nowait((iteration, current_loss, best_loss))
        except Exception:
            pass

    # Start training in a thread (since it's CPU-bound)
    training_iterations = 300

    async def run_training():
        """Run ES training and send progress events."""
        loop = asyncio.get_event_loop()

        def _train():
            return lnn.train(
                training_data,
                iterations=training_iterations,
                population=30,
                sigma=0.15,
                learning_rate=0.04,
                progress_callback=on_training_progress,
            )

        result = await loop.run_in_executor(None, _train)
        return result

    # Run training and stream progress concurrently
    training_task = asyncio.create_task(run_training())
    last_progress_sent = 0

    while not training_task.done():
        try:
            # Check for progress updates with timeout
            iteration, current_loss, best_loss = await asyncio.wait_for(
                training_progress_queue.get(), timeout=2.0
            )
            progress_pct = int(50 + (iteration / training_iterations) * 16)
            yield sse_event("progress", {
                "step": "training",
                "step_number": 3,
                "total_steps": total_steps,
                "message": f"Training LNN (iteration {iteration}/{training_iterations})...",
                "progress": progress_pct,
                "detail": f"current_loss: {current_loss:.6f}, best_loss: {best_loss:.6f}",
            })
            last_progress_sent = iteration
        except asyncio.TimeoutError:
            # No progress update received; check if training is still running
            if training_task.done():
                break
            # Send a keepalive progress event
            yield sse_event("progress", {
                "step": "training",
                "step_number": 3,
                "total_steps": total_steps,
                "message": "Training LNN (still running)...",
                "progress": 50,
            })

    # Get training result
    try:
        training_result = training_task.result()
    except Exception as e:
        logger.error(f"Training failed: {e}")
        training_result = {
            "final_loss": None,
            "best_loss": None,
            "iterations": 0,
            "accuracy": 0.0,
        }

    training_accuracy = training_result.get('accuracy', 0.0)

    yield sse_event("progress", {
        "step": "training",
        "step_number": 3,
        "total_steps": total_steps,
        "message": f"Training complete: accuracy={training_accuracy:.2%}, "
                   f"best_loss={training_result.get('best_loss', 'N/A')}",
        "progress": 66,
        "detail": training_result,
    })

    # Update stored config with training results
    updated_config = lnn.get_config()
    store.update_model_config(model_id, updated_config)

    # ── Step 4: Checking for errors ──────────────────────────────────────
    yield sse_event("progress", {
        "step": "checking",
        "step_number": 4,
        "total_steps": total_steps,
        "message": "Checking for errors in trained model...",
        "progress": 72,
    })

    # Validate the model
    errors = validate_lnn_model(lnn, config)
    if errors:
        yield sse_event("progress", {
            "step": "checking",
            "step_number": 4,
            "total_steps": total_steps,
            "message": f"Found {len(errors)} issues (non-critical): {'; '.join(errors[:3])}",
            "progress": 72,
            "warnings": errors,
        })
    else:
        yield sse_event("progress", {
            "step": "checking",
            "step_number": 4,
            "total_steps": total_steps,
            "message": "Model validation passed - no errors found",
            "progress": 72,
        })

    # ── Step 5: Testing LNN behavior ─────────────────────────────────────
    yield sse_event("progress", {
        "step": "testing",
        "step_number": 5,
        "total_steps": total_steps,
        "message": "Testing LNN behavior with test scenarios...",
        "progress": 85,
    })

    # Run test scenarios through the LNN
    test_results = test_lnn_behavior(lnn, config, training_data)

    yield sse_event("progress", {
        "step": "testing",
        "step_number": 5,
        "total_steps": total_steps,
        "message": f"Testing complete: {test_results['passed']}/{test_results['total']} scenarios passed",
        "progress": 90,
        "detail": test_results,
    })

    # ── Step 6: Finalizing model ─────────────────────────────────────────
    yield sse_event("progress", {
        "step": "finalizing",
        "step_number": 6,
        "total_steps": total_steps,
        "message": "Finalizing model and storing results...",
        "progress": 95,
    })

    # Final config update
    final_config = lnn.get_config()
    store.update_model_config(model_id, final_config)

    yield sse_event("complete", {
        "step": "complete",
        "model_id": model_id,
        "config": final_config,
        "kimi_used": kimi_used,
        "training_accuracy": training_accuracy,
        "training_loss": training_result.get('best_loss'),
        "training_iterations": training_result.get('iterations'),
        "test_results": test_results,
        "validation_errors": errors,
    })


def extract_training_data_from_kimi_response(response_text: str) -> list:
    """
    Extract training scenarios from Kimi's response.
    Expected format: {"scenarios": [{"inputs": {...}, "expected_outputs": {...}}, ...]}
    """
    # Try to find JSON in the response
    json_patterns = [
        r'```json\s*\n(.*?)\n\s*```',
        r'```\s*\n(\{.*?\})\n\s*```',
        r'(\{[^{}]*"scenarios"\s*:\s*\[.*?\][^{}]*\})',
    ]

    for pattern in json_patterns:
        matches = re.findall(pattern, response_text, re.DOTALL)
        for match in matches:
            try:
                parsed = json.loads(match)
                if 'scenarios' in parsed:
                    scenarios = parsed['scenarios']
                    # Validate and clean scenarios
                    valid = []
                    for s in scenarios:
                        if isinstance(s, dict) and 'inputs' in s and 'expected_outputs' in s:
                            # Ensure values are floats
                            clean_inputs = {}
                            for k, v in s['inputs'].items():
                                try:
                                    clean_inputs[k] = max(0.0, min(1.0, float(v)))
                                except (ValueError, TypeError):
                                    continue
                            clean_outputs = {}
                            for k, v in s['expected_outputs'].items():
                                try:
                                    clean_outputs[k] = max(0.0, min(1.0, float(v)))
                                except (ValueError, TypeError):
                                    continue
                            if clean_inputs and clean_outputs:
                                valid.append({
                                    'inputs': clean_inputs,
                                    'expected_outputs': clean_outputs,
                                })
                    if valid:
                        logger.info(f"Extracted {len(valid)} valid training scenarios from Kimi")
                        return valid
            except json.JSONDecodeError:
                continue

    # Fallback: try to parse the entire response as JSON
    try:
        parsed = json.loads(response_text)
        if 'scenarios' in parsed:
            return parsed['scenarios']
    except json.JSONDecodeError:
        pass

    logger.warning("Could not extract training data from Kimi response")
    return []


def generate_synthetic_training_data(config: dict) -> list:
    """
    Generate synthetic training scenarios as fallback when Kimi is unavailable.
    Uses RuleBasedProcessor to generate scenarios with strong input-output
    correlations for the detected robot type. Falls back to generic data
    if rule-based generation doesn't apply.
    """
    input_mapping = config.get('input_mapping', {})
    output_mapping = config.get('output_mapping', {})
    input_names = list(input_mapping.keys())
    output_names = list(output_mapping.keys())
    description = config.get('description', '')

    if not input_names or not output_names:
        return []

    # Try rule-based training data generation first
    rule_scenarios = RuleBasedProcessor.generate_training_scenarios(config)
    if rule_scenarios and len(rule_scenarios) >= 20:
        logger.info(f"Generated {len(rule_scenarios)} rule-based training scenarios "
                    f"for detected robot type")
        return rule_scenarios

    # Fallback: generate basic scenarios with inverse correlation
    # (high sensor = far from obstacle = go fast; low sensor = close = slow/turn)
    scenarios = []
    num_scenarios = 60

    for i in range(num_scenarios):
        inputs = {}
        for name in input_names:
            inputs[name] = round(random.random(), 3)

        # Generate expected outputs with inverse correlation to inputs
        expected = {}
        for j, name in enumerate(output_names):
            if j < len(input_names):
                # Inverse: when sensor reads high (far), output high (go)
                # when sensor reads low (close), output low (stop/turn)
                base = 1.0 - inputs[input_names[j]]
                noise = random.gauss(0, 0.08)
                val = max(0.0, min(1.0, base + noise))
                expected[name] = round(val, 3)
            else:
                avg_input = sum(inputs.values()) / len(inputs) if inputs else 0.5
                noise = random.gauss(0, 0.08)
                val = max(0.0, min(1.0, 1.0 - avg_input + noise))
                expected[name] = round(val, 3)

        scenarios.append({
            'inputs': inputs,
            'expected_outputs': expected,
        })

    # Add structured scenarios with strong signals
    # All sensors high (clear path) -> motors fast
    for _ in range(5):
        inputs = {name: round(random.uniform(0.85, 1.0), 3) for name in input_names}
        expected = {name: round(random.uniform(0.8, 1.0), 3) for name in output_names}
        scenarios.append({'inputs': inputs, 'expected_outputs': expected})

    # All sensors low (obstacle very close) -> stop/turn
    for _ in range(5):
        inputs = {name: round(random.uniform(0.0, 0.15), 3) for name in input_names}
        expected = {name: round(random.uniform(0.0, 0.2), 3) for name in output_names}
        scenarios.append({'inputs': inputs, 'expected_outputs': expected})

    # Obstacle left (left sensors low, right high) -> turn right
    left_names = [n for n in input_names if any(kw in n.lower() for kw in ['left', 'l'])]
    right_names = [n for n in input_names if any(kw in n.lower() for kw in ['right', 'r'])]
    if left_names and right_names:
        for _ in range(5):
            inputs = {}
            for n in left_names: inputs[n] = round(random.uniform(0.0, 0.2), 3)
            for n in right_names: inputs[n] = round(random.uniform(0.8, 1.0), 3)
            expected = {}
            left_motor = [n for n in output_names if any(kw in n.lower() for kw in ['left', 'l'])]
            right_motor = [n for n in output_names if any(kw in n.lower() for kw in ['right', 'r'])]
            if left_motor: expected[left_motor[0]] = round(random.uniform(0.8, 1.0), 3)
            if right_motor: expected[right_motor[0]] = round(random.uniform(0.0, 0.2), 3)
            for n in output_names:
                if n not in expected: expected[n] = 0.5
            scenarios.append({'inputs': inputs, 'expected_outputs': expected})

    logger.info(f"Generated {len(scenarios)} synthetic training scenarios")
    return scenarios


def validate_lnn_model(lnn: LiquidNeuralNetwork, config: dict) -> list:
    """
    Validate the trained LNN model for common issues.
    Returns a list of error/warning strings (empty if no issues).
    """
    errors = []

    # Check for NaN or Inf in weights
    for weight_matrix_name in ['weights_input', 'weights_recurrent', 'weights_output']:
        matrix = getattr(lnn, weight_matrix_name)
        for i, row in enumerate(matrix):
            for j, val in enumerate(row):
                if math.isnan(val) or math.isinf(val):
                    errors.append(f"Invalid weight in {weight_matrix_name}[{i}][{j}]: {val}")
                    break
            if len(errors) >= 5:
                break
        if len(errors) >= 5:
            break

    # Check config consistency
    if lnn.input_size != config.get('input_size', lnn.input_size):
        errors.append(f"Input size mismatch: LNN={lnn.input_size}, config={config.get('input_size')}")
    if lnn.output_size != config.get('output_size', lnn.output_size):
        errors.append(f"Output size mismatch: LNN={lnn.output_size}, config={config.get('output_size')}")

    # Check for dead neurons (all weights near zero)
    for i, row in enumerate(lnn.weights_input):
        if all(abs(v) < 1e-6 for v in row):
            errors.append(f"Hidden neuron {i} has near-zero input weights (may be dead)")

    # Check hidden state stability
    hidden_norm = sum(h*h for h in lnn.hidden_state) ** 0.5
    if hidden_norm > 100:
        errors.append(f"Hidden state norm is very large ({hidden_norm:.2f}), may indicate instability")

    return errors


def test_lnn_behavior(lnn: LiquidNeuralNetwork, config: dict, training_data: list) -> dict:
    """
    Test the LNN by running through training scenarios and checking outputs.
    Returns a summary dict with test results.
    """
    total = len(training_data)
    passed = 0
    failed_scenarios = []

    # Reset hidden state for testing
    lnn.hidden_state = [0.0] * lnn.hidden_units

    for i, scenario in enumerate(training_data):
        inputs_dict = scenario.get('inputs', {})
        expected = scenario.get('expected_outputs', {})

        # Build input vector
        input_values = [0.0] * lnn.input_size
        for name, val in inputs_dict.items():
            if name in lnn.input_mapping:
                idx = lnn.input_mapping[name]
                input_values[idx] = max(0.0, min(1.0, float(val)))

        outputs = lnn.forward(input_values)

        # Check each expected output
        scenario_pass = True
        for name, expected_val in expected.items():
            if name in lnn.output_mapping:
                idx = lnn.output_mapping[name]
                if idx < len(outputs):
                    if abs(outputs[idx] - float(expected_val)) > 0.3:
                        scenario_pass = False

        if scenario_pass:
            passed += 1
        elif len(failed_scenarios) < 3:
            failed_scenarios.append({
                "scenario_index": i,
                "inputs": inputs_dict,
                "expected": expected,
            })

    accuracy = passed / total if total > 0 else 0.0

    return {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "accuracy": round(accuracy, 4),
        "sample_failures": failed_scenarios,
    }


@app.post("/generate/stream")
async def generate_lnn_stream_endpoint(req: GenerateLNNRequest):
    """
    Generate a new LNN model with SSE progress streaming.

    Streams progress events through 6 steps:
    1. Generating LNN architecture
    2. Creating training data
    3. Training LNN
    4. Checking for errors
    5. Testing LNN behavior
    6. Finalizing model

    Returns text/event-stream with progress and complete events.
    """
    return StreamingResponse(
        generate_lnn_stream(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Deploy Brain to Render ─────────────────────────────────────────────────

@app.post("/deploy")
async def deploy_brain(req: DeployBrainRequest):
    """
    Deploy an LNN model as a brain server on Render.

    Tries to create a new Render web service first. If that fails
    (e.g., payment required, limit reached), falls back to updating
    the existing brain-template service's env vars and redeploying.
    """

    if not RENDER_API_KEY:
        raise HTTPException(500, "RENDER_API_KEY not configured on server")

    model_data = store.get_model(req.model_id)
    if not model_data:
        raise HTTPException(404, f"Model '{req.model_id}' not found. Generate it first.")

    config = model_data['config']

    # Create brain ID and service name
    robot_slug = req.robot_name.lower().replace(' ', '_')
    brain_id = f"brain-{robot_slug}-{uuid.uuid4().hex[:6]}"
    service_name = f"airone-brain-{robot_slug}"

    # Prepare env vars for the brain server
    model_config_json = json.dumps(config)
    env_vars = [
        {"key": "MODEL_CONFIG", "value": model_config_json},
        {"key": "ROBOT_NAME", "value": req.robot_name},
        {"key": "RENDER_EXTERNAL_URL", "value": f"https://{service_name}.onrender.com"},
    ]

    # ── Try creating a new Render web service ────────────────────────────
    create_payload = {
        "type": "web_service",
        "name": service_name,
        "ownerId": RENDER_OWNER_ID,
        "repo": BRAIN_REPO,
        "branch": BRAIN_BRANCH,
        "rootDir": BRAIN_ROOT_DIR,
        "plan": "free",
        "region": "oregon",
        "serviceDetails": {
            "runtime": "python",
            "envSpecificDetails": {
                "buildCommand": "pip install -r requirements.txt",
                "startCommand": "uvicorn deploy_api:app --host 0.0.0.0 --port $PORT",
            },
            "envVars": env_vars,
            "healthCheckPath": "/health",
        },
    }

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    logger.info(f"Creating Render service: {service_name}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{RENDER_API_URL}/services",
                headers=headers,
                json=create_payload,
            )

            if response.status_code not in (200, 201):
                error_detail = response.text[:500]
                logger.error(f"Render API error creating new service: "
                             f"{response.status_code} - {error_detail}")
                raise Exception(
                    f"Render API returned {response.status_code}: {error_detail}"
                )

        result = response.json()
        service = result.get('service', result)
        service_id = service.get('id', '')
        service_url = service.get('serviceDetails', {}).get(
            'url', f'https://{service_name}.onrender.com'
        )

        # Store brain info
        store.add_brain(brain_id, req.model_id, service_id, service_url, req.robot_name)

        return {
            "status": "deploying",
            "brain_id": brain_id,
            "service_id": service_id,
            "url": service_url,
            "ws_url": f"wss://{service_url.replace('https://', '').replace('http://', '')}",
            "model_id": req.model_id,
            "message": f"Brain '{brain_id}' is deploying to Render as new service",
            "deploy_method": "new_service",
        }

    except Exception as e:
        logger.warning(f"Failed to create new Render service: {e}")
        logger.info("Falling back to updating existing brain-template service...")
        try:
            return await deploy_to_existing_brain(req, config, brain_id)
        except Exception as e2:
            logger.error(f"Fallback deploy also failed: {e2}")
            raise HTTPException(500, f"Deploy failed (new service + fallback): {str(e2)}")


async def deploy_to_existing_brain(req: DeployBrainRequest, config: dict, brain_id: str) -> dict:
    """
    Fallback: Update the existing airone-brain-template service's env vars
    and trigger a redeploy.
    """
    BRAIN_TEMPLATE_URL = "https://airone-brain-template.onrender.com"

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    # Update MODEL_CONFIG env var
    # Convert to multi-model format for proper routing
    multi_model_config = {req.robot_name: config}
    model_config_json = json.dumps(multi_model_config)
    logger.info(f"Setting MODEL_CONFIG in multi-model format for robot: {req.robot_name}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Set MODEL_CONFIG env var
        env_response = await client.put(
            f"{RENDER_API_URL}/services/{BRAIN_TEMPLATE_ID}/env-vars/MODEL_CONFIG",
            headers=headers,
            json={"value": model_config_json},
        )

        if env_response.status_code not in (200, 201, 204):
            # Try creating the env var if it doesn't exist
            env_response = await client.post(
                f"{RENDER_API_URL}/services/{BRAIN_TEMPLATE_ID}/env-vars",
                headers=headers,
                json={"key": "MODEL_CONFIG", "value": model_config_json},
            )

        # Set ROBOT_NAME env var
        await client.put(
            f"{RENDER_API_URL}/services/{BRAIN_TEMPLATE_ID}/env-vars/ROBOT_NAME",
            headers=headers,
            json={"value": req.robot_name},
        )

        # Trigger a deploy
        deploy_response = await client.post(
            f"{RENDER_API_URL}/services/{BRAIN_TEMPLATE_ID}/deploys",
            headers=headers,
            json={},
        )

        deploy_data = deploy_response.json() if deploy_response.status_code in (200, 201) else {}

    # Store brain info
    store.add_brain(brain_id, req.model_id, BRAIN_TEMPLATE_ID, BRAIN_TEMPLATE_URL, req.robot_name)

    return {
        "status": "deploying",
        "brain_id": brain_id,
        "service_id": BRAIN_TEMPLATE_ID,
        "url": BRAIN_TEMPLATE_URL,
        "ws_url": f"wss://airone-brain-template.onrender.com",
        "model_id": req.model_id,
        "message": f"Brain '{brain_id}' is redeploying on existing brain-template service",
        "deploy_method": "brain_template_fallback",
        "note": "Using existing brain-template service (fallback mode). "
                "Robots connect via WebSocket to wss://airone-brain-template.onrender.com/",
    }

# ─── Test Inference ──────────────────────────────────────────────────────────

@app.post("/inference")
async def test_inference(req: TestInferenceRequest):
    """Test LNN inference with sensor data (HTTP endpoint for quick testing)."""

    lnn = store.get_lnn(req.model_id)
    if not lnn:
        raise HTTPException(404, f"Model '{req.model_id}' not found. Generate it first.")

    commands = lnn.process_sensor_data(req.sensor_data, req.output_modules)

    return {
        "model_id": req.model_id,
        "input_sensors_read": req.sensor_data,
        "output_modules_available": req.output_modules,
        "output_commands": commands,
        "hidden_state_norm": round(sum(h*h for h in lnn.hidden_state) ** 0.5, 4),
    }

# ─── WebSocket Inference (Deploy API mode) ──────────────────────────────────

@app.websocket("/ws/{model_id}")
async def websocket_inference(websocket: WebSocket, model_id: str):
    """WebSocket endpoint for real-time LNN inference (deploy API mode)."""

    await websocket.accept()
    logger.info(f"WebSocket client connected for model: {model_id}")

    lnn = store.get_lnn(model_id)
    if not lnn:
        await websocket.send_text(json.dumps({"error": f"Model '{model_id}' not found"}))
        await websocket.close()
        return

    try:
        while True:
            data = await websocket.receive_text()

            try:
                parsed = None
                try:
                    parsed = json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    pass

                if parsed and isinstance(parsed, dict):
                    sensor_data = parsed.get('input_sensors_read', {})
                    output_modules = parsed.get('output_modules_available', list(lnn.output_mapping.keys()))
                else:
                    # Natural language format
                    sensors_match = re.search(
                        r'Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)', data, re.IGNORECASE
                    )
                    outputs_match = re.search(
                        r'What do you want to do to:\s*\n?\s*\(([^)]*)\)', data, re.IGNORECASE
                    )

                    sensor_data = {}
                    if sensors_match:
                        for pair in sensors_match.group(1).split(','):
                            if ':' in pair:
                                key, val = pair.split(':', 1)
                                try:
                                    sensor_data[key.strip()] = float(val.strip())
                                except ValueError:
                                    sensor_data[key.strip()] = val.strip()

                    output_modules = []
                    if outputs_match:
                        output_modules = [
                            m.strip().replace('.', '')
                            for m in outputs_match.group(1).split(',') if m.strip()
                        ]

                    if not output_modules:
                        output_modules = list(lnn.output_mapping.keys())

                # Run inference
                commands = lnn.process_sensor_data(sensor_data, output_modules)

                response = {
                    "command_id": f"cmd_{uuid.uuid4().hex[:8]}",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "output_commands": commands,
                    "metadata": {
                        "model": "LNN (Liquid Neural Network)",
                        "model_id": model_id,
                        "inputs_processed": len(sensor_data),
                        "outputs_generated": len(commands),
                    }
                }

                await websocket.send_text(json.dumps(response))

            except Exception as e:
                import traceback
                logger.error(f"WebSocket error: {e}")
                logger.error(traceback.format_exc())
                try:
                    await websocket.send_text(json.dumps({"error": str(e)}))
                except:
                    pass

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from model: {model_id}")
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")

# ─── List Models & Brains ───────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    return {"models": store.list_models()}

@app.get("/brains")
async def list_brains():
    return {"brains": store.list_brains()}

@app.get("/brain/{brain_id}")
async def brain_status(brain_id: str):
    brain = store.get_brain(brain_id)
    if not brain:
        raise HTTPException(404, "Brain not found")
    return brain

@app.get("/model/{model_id}")
async def model_status(model_id: str):
    model = store.get_model(model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    return {
        "model_id": model_id,
        "config": model['config'],
        "robot_name": model['robot_name'],
        "created_at": model['created_at'],
    }

# ─── Render Service Status ──────────────────────────────────────────────────

@app.get("/render/services")
async def list_render_services():
    """List all Render services (for debugging)."""
    if not RENDER_API_KEY:
        raise HTTPException(500, "RENDER_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{RENDER_API_URL}/services", headers=headers)

        if response.status_code != 200:
            raise HTTPException(response.status_code, f"Render API error: {response.text[:300]}")

        services = response.json()
        return {
            "services": [
                {
                    "id": s['service']['id'],
                    "name": s['service']['name'],
                    "url": s['service']['serviceDetails']['url'],
                    "suspended": s['service']['suspended'],
                    "type": s['service']['type'],
                }
                for s in services
            ]
        }

# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 8000))
    mode = "BRAIN (robot WebSocket server)" if BRAIN_MODE else "DEPLOY API (LNN generation + deploy)"
    logger.info(f"Starting Airone service on port {port} -- Mode: {mode}")
    uvicorn.run(app, host="0.0.0.0", port=port)
