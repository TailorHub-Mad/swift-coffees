#!/bin/bash

echo "🚀 Deploying Swift Coffees to Fly.io..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl could not be found. Please install it first:"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if user is logged in
if ! flyctl auth whoami &> /dev/null; then
    echo "🔐 Please log in to Fly.io first:"
    echo "   flyctl auth login"
    exit 1
fi

# Build and deploy
echo "📦 Building and deploying..."
flyctl deploy

echo "✅ Deployment complete!"
echo "📋 Check your app status with: flyctl status"
echo "📊 View logs with: flyctl logs" 