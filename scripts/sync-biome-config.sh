#!/bin/bash

# Sync root biome config with tooling version
echo "🔄 Syncing Biome configurations..."

# Copy the base config to root (removing comments for compatibility)
jq '.' tooling/biome/preset.json > biome.json

# Add project-specific overrides
jq '.files.includes += ["!**/.pnpm-store", "!**/tooling/typescript/**/*.json"]' biome.json > biome.temp.json
mv biome.temp.json biome.json

echo "✅ Biome config synced from tooling/biome/preset.json"
echo "📝 Added project-specific excludes"