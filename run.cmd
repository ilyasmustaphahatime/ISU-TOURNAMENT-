@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PIDFILE=%CD%\server.pid"
set "APPPORT=3000"
set "NODE_EXE="
set "LISTENPID="

call :resolvePort
call :resolveNode

if not defined NODE_EXE (
  echo Node.js could not be found on this computer.
  echo Install Node.js, then run .\run.cmd again.
  exit /b 1
)

if exist "%PIDFILE%" (
  set /p SERVER_PID=<"%PIDFILE%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-Process -Id !SERVER_PID! -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo Server is already running in the background.
    echo Open http://localhost:%APPPORT%
    echo To stop it later, run .\stop.cmd
    exit /b 0
  )

  del "%PIDFILE%" >nul 2>&1
)

call :probePort
if defined LISTENPID goto :alreadyRunning

start "ISU Server" /min "%CD%\background-server.cmd"

for /L %%I in (1,1,15) do (
  call :probePort
  if defined LISTENPID goto :started
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1" >nul 2>&1
)

echo Server could not start in the background.
echo Check server.err.log for details.
if exist "%PIDFILE%" del "%PIDFILE%" >nul 2>&1
exit /b 1

:alreadyRunning
>"%PIDFILE%" echo !LISTENPID!
echo Server is already running in the background.
echo Open http://localhost:%APPPORT%
echo To stop it later, run .\stop.cmd
exit /b 0

:started
>"%PIDFILE%" echo !LISTENPID!
echo Server is running in the background.
echo Open http://localhost:%APPPORT%
echo You can close this terminal now.
echo To stop the server later, run .\stop.cmd
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

:resolveNode
for /f "delims=" %%N in ('where node.exe 2^>nul') do (
  set "NODE_EXE=%%N"
  goto :eof
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  goto :eof
)

if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
)
exit /b 0

:probePort
set "LISTENPID="
for /f "tokens=5" %%P in ('cmd /c netstat -ano ^| findstr ":%APPPORT%" ^| findstr "LISTENING"') do (
  set "LISTENPID=%%P"
  goto :eof
)
exit /b 0
