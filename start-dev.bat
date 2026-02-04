@echo off
echo ======================================
echo    GridBot - Development Setup
echo ======================================
echo.

REM Check if MongoDB is running
echo [1/4] Checking MongoDB...
where mongod >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo MongoDB not found. Please install MongoDB or use Docker:
    echo   docker run -d -p 27017:27017 --name mongodb mongo:7
    echo.
)

REM Install auth-service dependencies
echo [2/4] Installing auth-service dependencies...
cd auth-service
call npm install
cd ..

REM Install frontend dependencies
echo [3/4] Installing frontend dependencies...
cd frontend
call npm install
cd ..

echo [4/4] Starting services...
echo.
echo Starting in separate terminals:
echo   - Auth Service: cd auth-service ^&^& npm run dev
echo   - Trading Engine: cd trading-engine ^&^& mvnw spring-boot:run
echo   - Frontend: cd frontend ^&^& npm run dev
echo.
echo Or use Docker Compose:
echo   docker-compose up --build
echo.

pause
