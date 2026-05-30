@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   AIRONE BRAIN PING SERVICE
echo   Keeps Render brains awake
echo ==========================================
echo.

:: Check if venv exists
if not exist "venv" (
    echo [ERROR] Virtual environment not found. Run setup.bat first.
    exit /b 1
)

:: Activate and run
call venv\Scripts\activate.bat
python ping_service.py
