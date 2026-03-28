@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_FILE=%STARTUP_DIR%\ISU Football Tournament.cmd"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$projectRoot = (Get-Location).Path; " ^
  "$targetFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'ISU Football Tournament.cmd'; " ^
  "$content = @('@echo off', ('cd /d ""' + $projectRoot + '""'), 'call run.cmd') -join [Environment]::NewLine; " ^
  "Set-Content -LiteralPath $targetFile -Value $content -Encoding ASCII"

if errorlevel 1 (
  echo Could not install auto-start.
  exit /b 1
)

echo Auto-start installed.
echo Windows will start the ISU Football Tournament server after you sign in.
echo Startup file:
echo %TARGET_FILE%
