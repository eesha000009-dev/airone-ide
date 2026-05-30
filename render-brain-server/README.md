# Airone - Render Edition

Cloud LNN brains for AI-driven robotics. Deployed on Render.com (free tier, no credit card needed).

## Quick Start (Windows CMD)

```cmd
:: 1. Run setup
setup.bat

:: 2. Test locally
example\test_local.bat

:: 3. Deploy to Render (see RENDER_SETUP.md)
```

## Architecture

```
AI Backbone (Electron) → Deploy API (Render) → Brain Server (Render per robot)
                                                        ↓
                                                  Robot (ESP32 via WebSocket)
```

## Files

| File | Purpose |
|------|---------|
| `brain_server.py` | LNN inference engine (one per robot) |
| `deploy_api.py` | Backend API for managing brains |
| `render.yaml` | Render Blueprint (Infrastructure as Code) |
| `setup.bat` | Windows setup script |
| `ping_service.py` | Keeps free tier brains awake |
| `requirements.txt` | Python dependencies |

## Deploy Flow

1. User clicks **Deploy** in AI Backbone
2. AI Backbone calls Deploy API
3. Deploy API returns brain URL
4. User pastes URL into `.airo` file
5. Compiler generates C++ with WebSocket client
6. Robot connects directly to brain URL

## Render Free Tier Notes

- **Sleep after 15 min inactivity** → Use ping service to keep awake
- **750 hours/month** → Enough for 1 always-on service
- **Multiple brains** → Share the hour pool (they sleep when not in use)

## GitHub Auto-Deploy

Push to `main` branch → GitHub Actions → Auto-deploy to Render

Set these secrets in GitHub:
- `RENDER_API_KEY` - From Render dashboard
- `RENDER_DEPLOY_API_SERVICE_ID` - From Render dashboard
- `RENDER_BRAIN_TEMPLATE_SERVICE_ID` - From Render dashboard
