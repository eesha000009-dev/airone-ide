import asyncio
import json
import re
import os
import sys
import signal
import torch
import websockets
from ncps.torch import CfC
from ncps.wirings import AutoNCP
from pathlib import Path
from http import HTTPStatus

# ============ RENDER COMPATIBILITY ============
# Render sets PORT env var. Default to 10000 for local testing.
PORT = int(os.environ.get("PORT", 10000))
HOST = "0.0.0.0"  # Required by Render

# Model path from env var
MODEL_PATH = os.environ.get("MODEL_PATH", "models/universal_v1.pt")
ROBOT_NAME = os.environ.get("ROBOT_NAME", "unknown")

# ============ LOAD MODEL ============
model = None
config = {}
hidden_states = {}  # robot_id -> hidden_state

def load_model():
    global model, config

    if not Path(MODEL_PATH).exists():
        print(f"ERROR: Model not found at {MODEL_PATH}")
        print("Creating dummy model for testing...")
        create_dummy_model()

    checkpoint = torch.load(MODEL_PATH, map_location="cpu")
    config = checkpoint.get("config", {
        "input_size": 4,
        "output_size": 4,
        "hidden_units": 16,
        "input_sensors": [
            {"name": "distance_front", "unit": "cm"},
            {"name": "distance_rear", "unit": "cm"},
            {"name": "gyro", "unit": "deg/s"},
            {"name": "battery", "unit": "percent"}
        ],
        "output_actuators": [
            {"name": "left_motor", "range": [0, 255], "mode": "pwm"},
            {"name": "right_motor", "range": [0, 255], "mode": "pwm"},
            {"name": "led", "range": [0, 1], "mode": "digital"},
            {"name": "buzzer", "range": [0, 1], "mode": "digital"}
        ]
    })

    wiring = AutoNCP(units=config["hidden_units"], output_size=config["output_size"])
    model = CfC(input_size=config["input_size"], units=wiring, batch_first=True)
    model.load_state_dict(checkpoint.get("state_dict", checkpoint))
    model.eval()

    print(f"Loaded model: {MODEL_PATH}")
    print(f"Config: {config}")

def create_dummy_model():
    """Create a simple obstacle avoidance model for testing."""
    os.makedirs("models", exist_ok=True)

    config = {
        "input_size": 4,
        "output_size": 4,
        "hidden_units": 16,
        "input_sensors": [
            {"name": "distance_front", "unit": "cm"},
            {"name": "distance_rear", "unit": "cm"},
            {"name": "gyro", "unit": "deg/s"},
            {"name": "battery", "unit": "percent"}
        ],
        "output_actuators": [
            {"name": "left_motor", "range": [0, 255], "mode": "pwm"},
            {"name": "right_motor", "range": [0, 255], "mode": "pwm"},
            {"name": "led", "range": [0, 1], "mode": "digital"},
            {"name": "buzzer", "range": [0, 1], "mode": "digital"}
        ]
    }

    wiring = AutoNCP(units=16, output_size=4)
    model = CfC(input_size=4, units=wiring, batch_first=True)

    # Initialize with sensible weights for obstacle avoidance
    with torch.no_grad():
        for param in model.parameters():
            param.normal_(0, 0.1)

    torch.save({"state_dict": model.state_dict(), "config": config}, MODEL_PATH)
    print(f"Created dummy model at {MODEL_PATH}")

# ============ INFERENCE ============
async def run_inference(robot_id, sensor_text):
    global hidden_states

    if model is None:
        return None, "Model not loaded"

    # Extract numbers from sensor text
    numbers = re.findall(r"[-+]?\d*\.\d+|\d+", sensor_text)
    if len(numbers) < config["input_size"]:
        return None, f"Need {config['input_size']} sensors, got {len(numbers)}"

    # Build input tensor
    inputs = [float(numbers[i]) for i in range(config["input_size"])]
    input_tensor = torch.tensor([[[inputs]]], dtype=torch.float32)

    # Get or create hidden state
    if robot_id not in hidden_states:
        hidden_states[robot_id] = torch.zeros(1, config["hidden_units"])

    hidden_state = hidden_states[robot_id]

    # Run LNN
    with torch.no_grad():
        output, new_hidden = model(input_tensor, hidden_state)

    # Save hidden state
    hidden_states[robot_id] = new_hidden

    # Convert output to commands
    commands = {}
    values = output[0][0].tolist()

    for i, actuator in enumerate(config.get("output_actuators", [])):
        if i >= len(values):
            break
        raw_value = values[i]
        min_val, max_val = actuator["range"]
        scaled = int((raw_value + 1.0) / 2.0 * (max_val - min_val) + min_val)
        scaled = max(min_val, min(min_val, scaled))  # Clamp

        commands[actuator["name"]] = {
            "value": scaled,
            "mode": actuator.get("mode", "pwm")
        }

    return commands, None

# ============ HEALTH CHECK (Required by Render) ============
async def health_check(path, request_headers):
    if path == "/health" or path == "/healthz":
        return HTTPStatus.OK, [("Content-Type", "text/plain")], b"OK\n"
    return None

# ============ WEBSOCKET HANDLER ============
async def handle_robot(websocket, path):
    robot_id = None

    try:
        # For PoC: no auth. Just accept connection.
        # In production, first message could contain robot_id
        robot_id = f"robot_{id(websocket)}"

        print(f"Robot connected: {robot_id}")

        # Send ready signal
        await websocket.send(json.dumps({
            "status": "connected",
            "robot_id": robot_id,
            "model": Path(MODEL_PATH).stem,
            "robot_name": ROBOT_NAME
        }))

        # Main loop
        async for message in websocket:
            try:
                commands, error = await run_inference(robot_id, message)

                if error:
                    await websocket.send(json.dumps({"error": error}))
                    continue

                response = {
                    "status": "OK",
                    "commands": commands,
                    "timestamp": asyncio.get_event_loop().time()
                }

                await websocket.send(json.dumps(response))

            except Exception as e:
                print(f"Inference error: {e}")
                await websocket.send(json.dumps({"error": str(e)}))

    except websockets.exceptions.ConnectionClosed:
        print(f"Robot disconnected: {robot_id}")
    except Exception as e:
        print(f"Handler error: {e}")
    finally:
        # Optional: clear hidden state after disconnect
        if robot_id and robot_id in hidden_states:
            # Keep for 5 minutes in case of reconnect
            pass

# ============ SELF-PING (Keep Render awake) ============
async def self_ping():
    """Send HTTP request to self every 10 minutes to keep Render alive."""
    import aiohttp
    while True:
        await asyncio.sleep(600)  # 10 minutes
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{PORT}/health") as resp:
                    print(f"Self-ping: {resp.status}")
        except Exception as e:
            print(f"Self-ping failed: {e}")

# ============ GRACEFUL SHUTDOWN ============
stop_event = asyncio.Event()

def handle_signal(sig, frame):
    print(f"Received signal {sig}, shutting down...")
    stop_event.set()

# ============ MAIN ============
async def main():
    # Setup signal handlers for Render graceful shutdown
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    # Load model
    load_model()

    print(f"Starting brain server for: {ROBOT_NAME}")
    print(f"Listening on {HOST}:{PORT}")
    print(f"Model: {MODEL_PATH}")

    # Start WebSocket server with health check
    async with websockets.serve(
        handle_robot, 
        HOST, 
        PORT,
        process_request=health_check,
        ping_interval=30,  # Keep connections alive
        ping_timeout=10
    ):
        # Start self-ping task
        ping_task = asyncio.create_task(self_ping())

        print("Brain server ready!")
        print(f"Health check: http://{HOST}:{PORT}/health")

        # Wait for shutdown signal
        await stop_event.wait()

        ping_task.cancel()
        print("Shutdown complete.")

if __name__ == "__main__":
    asyncio.run(main())
