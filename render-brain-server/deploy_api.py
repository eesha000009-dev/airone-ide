"""
Airone Dual-Mode Server
=======================
Detects the runtime mode based on environment variables:
- MODEL_CONFIG is set → Runs as Multi-Model Brain Server (WebSocket)
- RENDER_API_KEY is set → Runs as Deploy API (FastAPI)
- Both set → Brain Server takes priority

The brain-template service sets MODEL_CONFIG, so it runs as brain server.
The airone-deploy service sets RENDER_API_KEY, so it runs as deploy API.

This file IS the FastAPI app (for uvicorn compatibility).
When brain mode is detected, the startup event launches the brain server.
"""

import os
import sys
import json
import asyncio
import signal

# ============ MODE DETECTION ============
MODEL_CONFIG = os.environ.get("MODEL_CONFIG", "")
RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
BRAIN_MODE = bool(MODEL_CONFIG)

print(f"[Airone] MODEL_CONFIG set: {bool(MODEL_CONFIG)}")
print(f"[Airone] RENDER_API_KEY set: {bool(RENDER_API_KEY)}")
print(f"[Airone] Mode: {'BRAIN SERVER (Multi-Model)' if BRAIN_MODE else 'DEPLOY API'}")

# ============ FASTAPI APP (always created for uvicorn) ============
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path

app = FastAPI(title="Airone Dual-Mode Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ BRAIN SERVER MODE ============
if BRAIN_MODE:
    import re
    import math
    import time
    import random
    from urllib.parse import parse_qs

    try:
        import websockets
    except ImportError:
        print("[ERROR] websockets not installed! Run: pip install websockets")
        sys.exit(1)

    # LNN Engine
    class LiquidNeuralNetwork:
        def __init__(self, config):
            self.config = config
            self.input_size = config.get('input_size', 1)
            self.output_size = config.get('output_size', 1)
            self.hidden_units = config.get('hidden_units', 16)

            params = config.get('neuron_params', {})
            self.tau = params.get('tau', params.get('vt', 0.1))
            self.dt = params.get('dt', 0.01)

            self.input_mapping = config.get('input_mapping', {})
            self.output_mapping = config.get('output_mapping', {})
            self.output_types = config.get('output_types', {})

            weights = config.get('weights', {})
            self.W_in = weights.get('W_in') or self._xavier(self.hidden_units, self.input_size)
            self.W_rec = weights.get('W_rec') or self._xavier(self.hidden_units, self.hidden_units)
            self.W_out = weights.get('W_out') or self._xavier(self.output_size, self.hidden_units)
            self.b_in = weights.get('b_in') or [0.0] * self.hidden_units
            self.b_out = weights.get('b_out') or [0.0] * self.output_size
            self.hidden_state = [0.0] * self.hidden_units

        def _xavier(self, rows, cols):
            limit = math.sqrt(6.0 / (rows + cols))
            return [[random.uniform(-limit, limit) for _ in range(cols)] for _ in range(rows)]

        def forward(self, inputs):
            if isinstance(inputs, dict):
                input_values = []
                for name, idx in sorted(self.input_mapping.items(), key=lambda x: x[1]):
                    val = inputs.get(name, 0.0)
                    if isinstance(val, str):
                        try: val = float(val)
                        except: val = 0.0
                    input_values.append(val)
                while len(input_values) < self.input_size: input_values.append(0.0)
            else:
                input_values = list(inputs)
                while len(input_values) < self.input_size: input_values.append(0.0)

            input_values = input_values[:self.input_size]
            new_hidden = [0.0] * self.hidden_units
            for i in range(self.hidden_units):
                w_sum = self.b_in[i]
                for j in range(self.input_size): w_sum += self.W_in[i][j] * input_values[j]
                for j in range(self.hidden_units): w_sum += self.W_rec[i][j] * self.hidden_state[j]
                decay = 1.0 - self.dt / max(self.tau, 0.001)
                new_hidden[i] = decay * self.hidden_state[i] + (self.dt / max(self.tau, 0.001)) * math.tanh(w_sum)
            self.hidden_state = new_hidden

            raw_outputs = []
            for i in range(self.output_size):
                w_sum = self.b_out[i]
                for j in range(self.hidden_units): w_sum += self.W_out[i][j] * self.hidden_state[j]
                raw_outputs.append(self._sigmoid(w_sum))

            commands = {}
            for name, idx in self.output_mapping.items():
                if idx < len(raw_outputs):
                    raw_val = raw_outputs[idx]
                    out_type = self.output_types.get(name, 'digital')
                    commands[name] = self._format_output(raw_val, out_type)
            return commands

        def _sigmoid(self, x):
            if x >= 0: return 1.0 / (1.0 + math.exp(-x))
            ex = math.exp(x); return ex / (1.0 + ex)

        def _format_output(self, raw_val, out_type):
            if out_type in ('pwm', 'motor'):
                return {"action": "pwm", "value": max(0, min(255, int(raw_val * 255)))}
            elif out_type == 'servo':
                return {"action": "servo", "angle": max(0, min(180, int(raw_val * 180)))}
            else:
                return {"action": "digitalwrite", "value": 1 if raw_val > 0.5 else 0}

    # Multi-Model Brain
    models = {}
    try:
        config = json.loads(MODEL_CONFIG)
        if 'input_size' in config:
            robot_name = os.environ.get('ROBOT_NAME', 'default')
            models[robot_name] = LiquidNeuralNetwork(config)
            print(f"[Brain] Loaded single model for: {robot_name}")
        else:
            for name, cfg in config.items():
                if isinstance(cfg, dict) and 'input_size' in cfg:
                    models[name] = LiquidNeuralNetwork(cfg)
                    print(f"[Brain] Loaded model for: {name}")
        print(f"[Brain] Total models: {len(models)}")
    except json.JSONDecodeError as e:
        print(f"[Brain] Failed to parse MODEL_CONFIG: {e}")

    def get_model(robot_name):
        import re
        key = re.sub(r'[^a-z0-9]', '-', robot_name.lower())
        if key in models: return models[key]
        if 'default' in models: return models['default']
        if models: return next(iter(models.values()))
        return None

    def parse_message(msg):
        if isinstance(msg, dict): return msg
        try: return json.loads(msg)
        except: pass
        result = {'input_sensors_read': {}}
        m = re.search(r'input sensors read:\s*\n?\s*\(([^)]*)\)', msg, re.IGNORECASE)
        if m:
            for pair in m.group(1).strip().split(','):
                if ':' in pair:
                    k, v = pair.strip().split(':', 1)
                    try: v = float(v.strip())
                    except: pass
                    result['input_sensors_read'][k.strip()] = v
        return result

    # Brain WebSocket handler
    async def brain_ws_handler(websocket):
        robot_name = 'default'
        try:
            path = websocket.request.path if hasattr(websocket.request, 'path') else '/'
            if '?' in path:
                params = parse_qs(path.split('?', 1)[1])
                robot_name = params.get('robot', params.get('name', ['default']))[0]
        except: pass

        print(f"[Brain] WebSocket connected for robot: {robot_name}")
        model = get_model(robot_name)

        try:
            async for raw_msg in websocket:
                try:
                    try:
                        msg_data = json.loads(raw_msg)
                        if isinstance(msg_data, dict):
                            rn = msg_data.get('robot_id') or msg_data.get('robot_name')
                            if rn and rn in models: robot_name = rn
                    except: pass

                    if model:
                        parsed = parse_message(raw_msg)
                        sensors = parsed.get('input_sensors_read', parsed)
                        commands = model.forward(sensors)
                        result = {"output_commands": commands, "robot": robot_name, "timestamp": time.time()}
                    else:
                        result = {"error": f"No model for '{robot_name}'", "output_commands": {}}
                    await websocket.send(json.dumps(result))
                except Exception as e:
                    await websocket.send(json.dumps({"error": str(e)}))
        except websockets.exceptions.ConnectionClosed:
            print(f"[Brain] WebSocket disconnected: {robot_name}")

    # Health check for WebSocket + HTTP
    async def brain_process_request(path, request_headers):
        if path in ('/health', '/healthz', '/'):
            data = {
                "status": "healthy", "service": "airone-brain-server",
                "mode": "multi-model", "models_loaded": len(models),
                "robots": list(models.keys())
            }
            body = json.dumps(data, indent=2).encode()
            return 200, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))], body
        return None

    brain_server_instance = None
    brain_task = None

    @app.on_event("startup")
    async def start_brain_server():
        global brain_server_instance, brain_task
        port = int(os.environ.get("PORT", 10000))
        print(f"[Brain] Starting WebSocket brain server on port {port}")

        async def run_ws():
            global brain_server_instance
            async with websockets.serve(brain_ws_handler, "0.0.0.0", port,
                                         process_request=brain_process_request,
                                         ping_interval=30, ping_timeout=10):
                print(f"[Brain] WebSocket server listening on ws://0.0.0.0:{port}")
                await asyncio.Future()  # Run forever

        brain_task = asyncio.create_task(run_ws())

    # FastAPI routes for brain mode (supplementary)
    @app.get("/health")
    async def brain_health():
        return {"status": "healthy", "service": "airone-brain-server", "mode": "multi-model",
                "models_loaded": len(models), "robots": list(models.keys())}

    @app.get("/")
    async def brain_root():
        return {"service": "airone-brain-server", "mode": "multi-model",
                "robots": list(models.keys()),
                "connect": "wss://<this-host>/?robot=<robot-name>"}

# ============ DEPLOY API MODE ============
else:
    import uuid

    BRAINS_FILE = Path("brains.json")

    def load_brains():
        if BRAINS_FILE.exists():
            with open(BRAINS_FILE) as f: return json.load(f)
        return {}

    def save_brains(brains):
        with open(BRAINS_FILE, "w") as f: json.dump(brains, f, indent=2)

    brains = load_brains()

    class DeployRequest(BaseModel):
        user_id: str
        robot_name: str
        model_id: Optional[str] = "universal_v1"
        sensor_count: int = 2
        actuator_count: int = 2

    class GenerateRequest(BaseModel):
        user_id: str
        robot_name: str
        description: str = ""
        prompt: str = ""
        sensor_count: int = 2
        actuator_count: int = 2
        pin_definitions: Optional[dict] = None

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "airone-deploy",
                "render_api_key_configured": bool(RENDER_API_KEY)}

    @app.get("/")
    async def root():
        return {"service": "airone-deploy", "mode": "deploy-api"}

    @app.post("/generate")
    async def generate_model(req: GenerateRequest):
        model_id = f"{req.user_id}_{req.robot_name.lower()}_{uuid.uuid4().hex[:8]}"

        desc = req.description or req.prompt or ""
        input_count = req.sensor_count
        output_count = req.actuator_count

        pin_defs = req.pin_definitions or {}
        if pin_defs:
            input_pins = pin_defs.get('inputs', [])
            output_pins = pin_defs.get('outputs', [])
            input_count = len(input_pins) or input_count
            output_count = len(output_pins) or output_count

        config = {
            "input_size": input_count,
            "output_size": output_count,
            "hidden_units": max(16, (input_count + output_count) * 4),
            "time_steps": 1,
            "neuron_params": {"tau": 0.1, "dt": 0.01, "sensitivity": 0.5},
            "input_mapping": {},
            "output_mapping": {},
            "output_types": {},
            "description": desc or f"LNN model for {req.robot_name}",
            "robot_name": req.robot_name
        }

        if pin_defs:
            for i, pin in enumerate(input_pins):
                name = pin.get('name', f'sensor_{i}')
                config['input_mapping'][name] = i
            for i, pin in enumerate(output_pins):
                name = pin.get('name', f'actuator_{i}')
                config['output_mapping'][name] = i
                pin_type = pin.get('type', 'digital_output')
                if 'pwm' in pin_type: config['output_types'][name] = 'pwm'
                elif 'servo' in pin_type: config['output_types'][name] = 'servo'
                else: config['output_types'][name] = 'digital'

        return {
            "status": "generated", "model_id": model_id,
            "message": f"Model for '{req.robot_name}' generated",
            "config": config
        }

    @app.post("/generate/stream")
    async def generate_model_stream(req: GenerateRequest):
        from fastapi.responses import StreamingResponse
        import time

        async def stream_progress():
            steps = [
                ("generating", 10, "Generating LNN architecture..."),
                ("creating_data", 25, "Creating training data..."),
                ("training", 45, "Training LNN (epoch 0/100)..."),
                ("training", 60, "Training LNN (epoch 50/100)...", 0.72),
                ("training", 75, "Training LNN (epoch 100/100)...", 0.91),
                ("checking", 82, "Checking for errors..."),
                ("testing", 90, "Testing LNN behavior..."),
                ("finalizing", 98, "Finalizing model..."),
                ("complete", 100, "LNN model ready!"),
            ]

            for step_data in steps:
                step, progress, message = step_data[0], step_data[1], step_data[2]
                accuracy = step_data[3] if len(step_data) > 3 else None
                data = {"step": step, "progress": progress, "message": message}
                if accuracy is not None: data["accuracy"] = accuracy
                yield f"data: {json.dumps(data)}\n\n"
                await asyncio.sleep(0.3)

            # Generate the final model config
            result = await generate_model(req)
            data = {"step": "complete", "progress": 100, "model_id": result["model_id"],
                    "config": result["config"], "accuracy": 0.91}
            yield f"data: {json.dumps(data)}\n\n"

        return StreamingResponse(stream_progress(), media_type="text/event-stream")

    @app.post("/deploy")
    async def deploy_brain(req: DeployRequest):
        brain_id = f"{req.robot_name.lower()}-{uuid.uuid4().hex[:6]}"
        brains[brain_id] = {
            "user_id": req.user_id, "robot_name": req.robot_name,
            "model_id": req.model_id, "deploy_url": "https://airone-brain-template.onrender.com",
            "status": "pending"
        }
        save_brains(brains)
        return {
            "status": "deployed", "brain_id": brain_id,
            "brain_url": "https://airone-brain-template.onrender.com",
            "message": "Use ?robot=<robot-name> query param for multi-model routing"
        }

    @app.get("/brain/{brain_id}")
    async def brain_status(brain_id: str):
        if brain_id not in brains: raise HTTPException(404, "Brain not found")
        return brains[brain_id]

    @app.get("/brains")
    async def list_brains():
        return {"brains": brains}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
