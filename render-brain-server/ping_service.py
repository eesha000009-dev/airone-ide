import asyncio
import aiohttp
import sys
import time

# List of brain URLs to keep alive
# Add your deployed brain URLs here
BRAIN_URLS = [
    # "https://your-brain-1.onrender.com/health",
    # "https://your-brain-2.onrender.com/health",
]

# Ping interval (seconds) - Render sleeps after 15 min (900 sec)
# So we ping every 10 minutes (600 sec) to be safe
PING_INTERVAL = 600

async def ping_url(session, url):
    """Ping a single URL."""
    try:
        async with session.get(url, timeout=30) as response:
            status = response.status
            print(f"[{time.strftime('%H:%M:%S')}] {url} -> {status}")
            return status == 200
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] {url} -> ERROR: {e}")
        return False

async def ping_all():
    """Ping all URLs."""
    if not BRAIN_URLS:
        print("No brain URLs configured. Add them to BRAIN_URLS list.")
        return

    async with aiohttp.ClientSession() as session:
        tasks = [ping_url(session, url) for url in BRAIN_URLS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        success = sum(1 for r in results if r is True)
        print(f"Pinged {len(BRAIN_URLS)} brains, {success} OK")

async def main():
    print("=" * 50)
    print("Airone Brain Ping Service")
    print("Keeps your Render brains awake")
    print("=" * 50)
    print(f"Brains: {len(BRAIN_URLS)}")
    print(f"Interval: {PING_INTERVAL} seconds ({PING_INTERVAL/60} minutes)")
    print("=" * 50)

    while True:
        await ping_all()
        print(f"Next ping in {PING_INTERVAL/60} minutes...")
        print("-" * 50)
        await asyncio.sleep(PING_INTERVAL)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPing service stopped.")
        sys.exit(0)
