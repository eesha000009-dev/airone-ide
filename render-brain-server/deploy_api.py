import os
import json
import uuid
import httpx
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from pathlib import Path

app = FastAPI(title="Airone Deploy API")

# CORS for AI Backbone (Electron app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ CONFIGURATION ============
RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
RENDER_API_URL = "https://api.render.com/v1"

# For PoC: we use Render's Git-based deploy
# Each brain is a separate Render Web Service deployed from the same repo
# but with different env vars

# Track deployed brains
BRAINS_FILE = Path("brains.json")

def load_brains():
    if BRAINS_FILE.exists():
        with open(BRAINS_FILE) as f:
            return json.load(f)
    return {}

def save_brains(brains):
    with open(BRAINS_FILE, "w") as f:
        json.dump(brains, f, indent=2)

brains = load_brains()

# ============ MODELS ============
class DeployRequest(BaseModel):
    user_id: str
    robot_name: str
    model_id: Optional[str] = "universal_v1"
    sensor_count: int = 2
    actuator_count: int = 2

class GenerateRequest(BaseModel):
    user_id: str
    robot_name: str
    prompt: str
    sensor_count: int = 2
    actuator_count: int = 2

# ============ HEALTH CHECK ============
@app.get("/health")
async def health():
    return {"status": "ok", "service": "airone-deploy"}

# ============ LIST MODELS ============
@app.get("/models")
async def list_models():
    """List available pre-made models."""
    models_dir = Path("models")
    if not models_dir.exists():
        return {"models": []}

    models = []
    for pt_file in models_dir.glob("*.pt"):
        models.append({
            "id": pt_file.stem,
            "name": pt_file.stem.replace("_", " ").title(),
            "size_kb": pt_file.stat().st_size // 1024
        })

    return {"models": models}

# ============ GENERATE MODEL ============
@app.post("/generate")
async def generate_model(req: GenerateRequest):
    """Generate a new LNN model from user description."""

    # For PoC: create a model based on template
    # In production: use LLM to generate architecture + training data

    model_id = f"{req.user_id}_{req.robot_name.lower()}_{uuid.uuid4().hex[:8]}"
    model_path = f"models/{model_id}.pt"

    os.makedirs("models", exist_ok=True)

    # Create model config based on user specs
    config = {
        "input_size": req.sensor_count,
        "output_size": req.actuator_count,
        "hidden_units": max(16, (req.sensor_count + req.actuator_count) * 4),
        "input_sensors": [
            {"name": f"sensor_{i}", "unit": "raw"}
            for i in range(req.sensor_count)
        ],
        "output_actuators": [
            {"name": f"motor_{i}", "range": [0, 255], "mode": "pwm"}
            for i in range(req.actuator_count)
        ],
        "behavior": req.prompt,
        "created_by": req.user_id,
        "robot_name": req.robot_name
    }

    # Create and save model
    from ncps.torch import CfC
    from ncps.wirings import AutoNCP
    import torch

    wiring = AutoNCP(units=config["hidden_units"], output_size=config["output_size"])
    model = CfC(input_size=config["input_size"], units=wiring, batch_first=True)

    # Initialize with small random weights
    with torch.no_grad():
        for param in model.parameters():
            param.normal_(0, 0.1)

    torch.save({"state_dict": model.state_dict(), "config": config}, model_path)

    return {
        "status": "generated",
        "model_id": model_id,
        "message": f"Model '{req.robot_name}' generated successfully",
        "config": config
    }

# ============ DEPLOY BRAIN ============
@app.post("/deploy")
async def deploy_brain(req: DeployRequest):
    """Deploy a brain server for this robot."""

    # For PoC on Render: we return instructions for manual deploy
    # In production: this would call Render API to spin up a new service

    brain_id = f"{req.robot_name.lower()}-{uuid.uuid4().hex[:6]}"

    # Store brain info
    brains[brain_id] = {
        "user_id": req.user_id,
        "robot_name": req.robot_name,
        "model_id": req.model_id,
        "created": str(asyncio.get_event_loop().time()),
        "deploy_url": "https://airone-brain-template.onrender.com",
        "status": "pending"
    }
    save_brains(brains)

    # For Render PoC: User needs to manually create service or use Blueprint
    # Return the env vars they need to set

    return {
        "status": "ready_for_deploy",
        "brain_id": brain_id,
        "message": "Use Render Blueprint to deploy this brain",
        "instructions": {
            "method": "render_blueprint",
            "env_vars": {
                "MODEL_PATH": f"models/{req.model_id}.pt",
                "ROBOT_NAME": req.robot_name,
                "PORT": "10000"
            },
            "repo": "https://github.com/eesha000009-dev/airone-ide"
        }
    }

# ============ GET BRAIN STATUS ============
@app.get("/brain/{brain_id}")
async def brain_status(brain_id: str):
    if brain_id not in brains:
        raise HTTPException(404, "Brain not found")
    return brains[brain_id]

# ============ LIST ALL BRAINS ============
@app.get("/brains")
async def list_brains():
    return {"brains": brains}

# ============ DELETE BRAIN ============
@app.delete("/brain/{brain_id}")
async def delete_brain(brain_id: str):
    if brain_id not in brains:
        raise HTTPException(404, "Brain not found")
    del brains[brain_id]
    save_brains(brains)
    return {"status": "deleted"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
