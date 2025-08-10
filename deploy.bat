@echo off
REM Endpoint Monitor Deployment Script for Windows
REM This script helps you deploy the endpoint monitor application using Docker

echo 🚀 Endpoint Monitor Deployment Script (Windows)
echo ================================================

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not installed. Please install Docker Desktop first.
    echo    Visit: https://docs.docker.com/desktop/install/windows-install/
    pause
    exit /b 1
)

REM Check if Docker Compose is available
docker compose version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose is not available. Please ensure Docker Desktop is running.
    pause
    exit /b 1
)

echo ✅ Docker and Docker Compose are available

REM Check if .env file exists
if not exist ".env" (
    echo 📋 Creating environment configuration file...
    copy .env.example .env >nul
    
    echo.
    echo ⚠️  IMPORTANT SECURITY SETUP REQUIRED!
    echo    Please edit the .env file and change these values:
    echo    - JWT_SECRET ^(use a strong random string, min 32 characters^)
    echo    - DEFAULT_ADMIN_PASSWORD ^(use a secure password^)
    echo.
    echo    You can generate a secure JWT_SECRET online or use a password manager.
    echo.
    pause
) else (
    echo ✅ Environment file (.env) already exists
)

REM Ask user which deployment mode
echo.
echo Select deployment mode:
echo 1^) Production ^(pulls image from GitHub Container Registry^)
echo 2^) Development ^(builds image locally^)
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    echo 🐳 Starting production deployment...
    
    REM Check if docker-compose.yml needs updating
    findstr /C:"your-username" docker-compose.yml >nul
    if not errorlevel 1 (
        echo ⚠️  Please update docker-compose.yml and change 'your-username' to your actual GitHub username
        echo    Or build locally by running this script again and choosing option 2
        pause
    )
    
    REM Pull and start containers
    docker compose pull
    docker compose up -d
) else if "%choice%"=="2" (
    echo 🔨 Starting development deployment ^(building locally^)...
    docker compose -f docker-compose.dev.yml up --build -d
) else (
    echo ❌ Invalid choice. Exiting.
    pause
    exit /b 1
)

echo.
echo ⏳ Waiting for application to start...
timeout /t 10 /nobreak >nul

REM Check if container is running
docker compose ps | findstr "Up" >nul
if not errorlevel 1 (
    echo ✅ Application deployed successfully!
    echo.
    echo 🌐 Access your monitoring dashboard at: http://localhost:3001
    echo.
    echo 🔐 Default admin credentials:
    echo    Username: admin
    echo    Password: Check your .env file ^(DEFAULT_ADMIN_PASSWORD^)
    echo.
    echo ⚠️  IMPORTANT: Change the admin password after first login!
    echo.
    echo 📊 Useful commands:
    echo    View logs:    docker compose logs -f
    echo    Stop app:     docker compose down
    echo    Restart:      docker compose restart
    echo    Update:       docker compose pull ^&^& docker compose up -d
    echo.
    echo 📖 For more information, see README.md
) else (
    echo ❌ Deployment failed. Check the logs:
    echo    docker compose logs
    pause
    exit /b 1
)

pause
