#!/bin/bash
set -e

echo "🚀 Starting Hybrid Build Process..."

# 1. Build frontend
echo "📦 Building frontend PWA..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
cd ..

# 2. Prepare iOS Assets
echo "📂 Copying frontend assets to iOS project..."
rm -rf ios/ReadApp/www
cp -r frontend/dist ios/ReadApp/www

echo "✅ Hybrid build complete! PWA assets are now in ios/ReadApp/www"
