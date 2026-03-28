@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TARGET_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ISU Football Tournament.cmd"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targetFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'ISU Football Tournament.cmd'; " ^
  "if (Test-Path -LiteralPath $targetFile) { Remove-Item -LiteralPath $targetFile -Force }"

if errorlevel 1 (
  echo Could not remove auto-start.
  exit /b 1
)

echo Auto-start removed.
