@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PIDFILE=%CD%\server.pid"
set "APPPORT=3000"
set "SERVER_PID="

call :resolvePort

if exist "%PIDFILE%" (
  set /p SERVER_PID=<"%PIDFILE%"
) else (
  call :findListeningPid
  if defined LISTENPID set "SERVER_PID=!LISTENPID!"
)

if not defined SERVER_PID (
  echo No running server was found on port %APPPORT%.
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$process = Get-Process -Id !SERVER_PID! -ErrorAction SilentlyContinue; " ^
  "if ($process) { Stop-Process -Id !SERVER_PID! -Force; exit 0 } else { exit 1 }"

if errorlevel 1 (
  echo Server was not running.
) else (
  echo Server stopped.
)

del "%PIDFILE%" >nul 2>&1
exit /b 0

:resolvePort
for %%F in (.env backend\.env) do (
  if exist "%%F" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%%F") do (
      if /I "%%A"=="PORT" set "APPPORT=%%B"
    )
  )
)
set "APPPORT=%APPPORT: =%"
exit /b 0

:findListeningPid
set "LISTENPID="
for /f "tokens=5" %%P in ('cmd /c netstat -ano ^| findstr ":%APPPORT%" ^| findstr "LISTENING"') do (
  set "LISTENPID=%%P"
  goto :eof
)
exit /b 0
