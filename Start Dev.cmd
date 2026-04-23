@echo off
setlocal

cd /d "%~dp0"

echo Starting DEODATE dev server...
npm run dev:open

if errorlevel 1 (
  echo.
  echo The dev server stopped because of an error.
  pause
)
