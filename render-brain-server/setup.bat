@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   AIRONE RENDER SETUP (Windows CMD)
echo ==========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org
    exit /b 1
)
echo [OK] Python found

:: Check Git
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git not found. Install from https://git-scm.com
    exit /b 1
)
echo [OK] Git found

:: Check if in the right directory
if not exist "brain_server.py" (
    echo [ERROR] Run this script from the airone-render folder
    echo Current: %CD%
    exit /b 1
)

echo.
echo ==========================================
echo   STEP 1: Create Virtual Environment
echo ==========================================
python -m venv venv
if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment
    exit /b 1
)
echo [OK] Virtual environment created

echo.
echo ==========================================
echo   STEP 2: Install Dependencies
echo ==========================================
call venv\Scripts\activate.bat
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    exit /b 1
)
echo [OK] Dependencies installed

echo.
echo ==========================================
echo   STEP 3: Create Dummy Model (for testing)
echo ==========================================
python -c "import torch; from ncps.torch import CfC; from ncps.wirings import AutoNCP; import os; os.makedirs('models', exist_ok=True); config = {'input_size': 4, 'output_size': 4, 'hidden_units': 16, 'input_sensors': [{'name': 'distance_front', 'unit': 'cm'}, {'name': 'distance_rear', 'unit': 'cm'}, {'name': 'gyro', 'unit': 'deg/s'}, {'name': 'battery', 'unit': 'percent'}], 'output_actuators': [{'name': 'left_motor', 'range': [0, 255], 'mode': 'pwm'}, {'name': 'right_motor', 'range': [0, 255], 'mode': 'pwm'}, {'name': 'led', 'range': [0, 1], 'mode': 'digital'}, {'name': 'buzzer', 'range': [0, 1], 'mode': 'digital'}]}; wiring = AutoNCP(units=16, output_size=4); model = CfC(input_size=4, units=wiring, batch_first=True); torch.save({'state_dict': model.state_dict(), 'config': config}, 'models/universal_v1.pt'); print('Created models/universal_v1.pt')"
if errorlevel 1 (
    echo [ERROR] Failed to create model
    exit /b 1
)
echo [OK] Test model created

echo.
echo ==========================================
echo   STEP 4: Test Brain Server Locally
echo ==========================================
start "Brain Server" cmd /k "call venv\Scripts\activate.bat && python brain_server.py"
timeout /t 3 /nobreak >nul

echo.
echo ==========================================
echo   SETUP COMPLETE!
echo ==========================================
echo.
echo Next steps:
echo   1. Test brain server: curl http://localhost:10000/health
echo   2. Deploy to Render: see RENDER_SETUP.md
echo   3. Push to GitHub for auto-deploy
echo.
echo Local brain server is running on port 10000
echo Press any key to exit this window...
pause >nul
