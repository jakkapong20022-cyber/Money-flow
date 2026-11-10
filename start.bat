@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org ^(version 18 or newer^) & pause & exit /b 1)
echo Starting Family Budget at http://localhost:3000
start "" http://localhost:3000
node server.js
pause
