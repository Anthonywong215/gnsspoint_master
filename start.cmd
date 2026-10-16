@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0index.html"
  exit /b
)
node server.js --open
pause
