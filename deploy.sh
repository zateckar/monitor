#!/bin/bash

# Endpoint Monitor Deployment Script
# This script helps you deploy the endpoint monitor application using Docker

set -e

echo "🚀 Endpoint Monitor Deployment Script"
echo "======================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📋 Creating environment configuration file..."
    cp .env.example .env
    
    echo "⚠️  IMPORTANT SECURITY SETUP REQUIRED!"
    echo "   Please edit the .env file and change these values:"
    echo "   - JWT_SECRET (use a strong random string, min 32 characters)"
    echo "   - DEFAULT_ADMIN_PASSWORD (use a secure password)"
    echo ""
    echo "   Example secure JWT_SECRET generation:"
    echo "   openssl rand -base64 32"
    echo ""
    read -p "Press Enter after you've updated the .env file..."
else
    echo "✅ Environment file (.env) already exists"
fi

# Ask user which deployment mode
echo ""
echo "Select deployment mode:"
echo "1) Production (pulls image from GitHub Container Registry)"
echo "2) Development (builds image locally)"
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        echo "🐳 Starting production deployment..."
        
        # Update docker-compose.yml with user's GitHub username if needed
        if grep -q "your-username" docker-compose.yml; then
            echo "⚠️  Please update docker-compose.yml and change 'your-username' to your actual GitHub username"
            echo "   Or build locally by running this script again and choosing option 2"
            read -p "Press Enter after updating docker-compose.yml, or Ctrl+C to exit..."
        fi
        
        # Pull and start containers
        docker compose pull
        docker compose up -d
        ;;
    2)
        echo "🔨 Starting development deployment (building locally)..."
        docker compose -f docker-compose.dev.yml up --build -d
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "⏳ Waiting for application to start..."
sleep 10

# Check if container is running
if docker compose ps | grep -q "Up"; then
    echo "✅ Application deployed successfully!"
    echo ""
    echo "🌐 Access your monitoring dashboard at: http://localhost:3001"
    echo ""
    echo "🔐 Default admin credentials:"
    echo "   Username: admin"
    echo "   Password: Check your .env file (DEFAULT_ADMIN_PASSWORD)"
    echo ""
    echo "⚠️  IMPORTANT: Change the admin password after first login!"
    echo ""
    echo "📊 Useful commands:"
    echo "   View logs:    docker compose logs -f"
    echo "   Stop app:     docker compose down"
    echo "   Restart:      docker compose restart"
    echo "   Update:       docker compose pull && docker compose up -d"
    echo ""
    echo "📖 For more information, see README.md"
else
    echo "❌ Deployment failed. Check the logs:"
    echo "   docker compose logs"
    exit 1
fi
