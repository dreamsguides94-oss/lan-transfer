@echo off
title LAN Transfer
cd /d "%~dp0"

if not exist node_modules (
  echo First-time setup - installing components, this takes a minute...
  echo.
  call npm install
  echo.
)

echo Starting LAN Transfer...
echo Your browser will open automatically.
echo.
echo Keep this window open while you use LAN Transfer.
echo Close this window to stop it.
echo.

node server.js

pause
