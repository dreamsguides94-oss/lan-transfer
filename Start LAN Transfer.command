#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "First-time setup - installing components, this takes a minute..."
  npm install
fi

echo "Starting LAN Transfer..."
echo "Your browser will open automatically."
echo "Keep this window open while you use LAN Transfer."
echo ""

node server.js
