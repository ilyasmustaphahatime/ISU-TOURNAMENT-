@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_EXE="

for /f "delims=" %%N in ('where node.exe 2^>nul') do (
  set "NODE_EXE=%%N"
  goto :launch
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  goto :launch
)

if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
  goto :launch
)

set "NODE_EXE=node"

:launch

"%NODE_EXE%" backend\server.js 1>> "%~dp0server.out.log" 2>> "%~dp0server.err.log"
