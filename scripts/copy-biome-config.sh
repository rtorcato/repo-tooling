#!/bin/bash

# Copy Biome configuration from repo-tooling
# Usage: ./scripts/copy-biome-config.sh

echo "📋 Copying Biome configuration from repo-tooling..."

# Check if this is being run from a project that has repo-tooling as dependency
if [ ! -d "node_modules/@rtorcato/repo-tooling" ]; then
    echo "❌ Error: @rtorcato/repo-tooling not found in node_modules"
    echo "   Please install it first: npm install @rtorcato/repo-tooling"
    exit 1
fi

# Copy the base configuration
cp node_modules/@rtorcato/repo-tooling/tooling/biome/preset.json ./biome.json

echo "✅ Biome configuration copied successfully!"
echo ""
echo "📁 Created: ./biome.json"
echo ""
echo "🔧 You can now customize the configuration for your project:"
echo "   - Add project-specific file patterns"
echo "   - Override rules as needed" 
echo "   - Modify formatter settings"
echo ""
echo "🚀 To run Biome:"
echo "   npx biome check ."
echo "   npx biome format ."
echo "   npx biome lint ."