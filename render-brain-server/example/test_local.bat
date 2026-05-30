@echo off
echo ==========================================
echo   AIRONE TEST SUITE
echo ==========================================
echo.

set SERVER=http://localhost:10000

if not "%1"=="" set SERVER=%1

echo Testing server: %SERVER%
echo.

:: Test 1: Health check
echo [TEST 1] Health check...
curl -s %SERVER%/health
echo.
echo.

:: Test 2: WebSocket connection (requires websocat or similar)
echo [TEST 2] WebSocket test...
echo Sending: {"test": "hello"}
echo.

:: If you have Python with websockets installed:
python -c "
import asyncio
import websockets
import json

async def test():
    try:
        uri = '%SERVER%'.replace('http://', 'ws://')
        async with websockets.connect(uri) as ws:
            await ws.send('Currently, the input sensors read [distance_front: 45, distance_rear: 120, gyro: -12, battery: 85]')
            response = await ws.recv()
            print('Response:', response)
    except Exception as e:
        print('WebSocket test failed:', e)

asyncio.run(test())
"

echo.
echo ==========================================
echo   TESTS COMPLETE
echo ==========================================
pause
