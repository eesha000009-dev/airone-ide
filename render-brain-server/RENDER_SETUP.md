# Airone Render Setup Guide

## Prerequisites
- GitHub account
- Render account (free, no credit card)
- Windows CMD (or PowerShell)

## Step 1: Create Render Account
1. Go to https://render.com
2. Sign up with GitHub
3. Verify email

## Step 2: Push Code to GitHub
```cmd
cd airone-render
git init
git add .
git commit -m "Initial commit"
gh repo create airone-render --public --source=. --push
```

## Step 3: Deploy to Render (Blueprint)
1. Go to https://dashboard.render.com/blueprints
2. Click "New Blueprint Instance"
3. Connect your GitHub repo
4. Render reads `render.yaml` and creates services
5. Wait for deploy (2-3 minutes)

## Step 4: Get Your URLs
- Deploy API: `https://airone-deploy-xxx.onrender.com`
- Brain Template: `https://airone-brain-template-xxx.onrender.com`

## Step 5: Test
```cmd
curl https://airone-deploy-xxx.onrender.com/health
curl https://airone-brain-template-xxx.onrender.com/health
```

## For Each New Robot Brain

### Option A: Manual (Render Dashboard)
1. Go to Render Dashboard
2. Click "New" → "Web Service"
3. Connect same GitHub repo
4. Set environment variables:
   - `MODEL_PATH`: `models/universal_v1.pt`
   - `ROBOT_NAME`: `Eesha`
5. Deploy

### Option B: Render API (from Deploy API)
Your Deploy API can call Render API to create services programmatically.

## Keep Brain Alive (Free Tier)

Render free tier spins down after 15 minutes of inactivity.

### Solution: Self-Ping
The brain_server.py has built-in self-ping every 10 minutes.

### Alternative: External Ping
Use cron-job.org (free) to ping your brain URL every 10 minutes.

## Troubleshooting

### "Service failed to start"
Check logs in Render Dashboard → Service → Logs

### "Model not found"
Ensure `models/universal_v1.pt` exists in your repo or is created at build time.

### "WebSocket connection refused"
Render Web Services support WebSocket on the same port as HTTP.
Make sure your client connects to `wss://` not `ws://`.

## Costs
- Deploy API (free tier): $0
- Each Brain (free tier): $0
- **Limit**: 750 hours/month per service (enough for 1 always-on service)
- For multiple brains: they share the 750-hour pool
