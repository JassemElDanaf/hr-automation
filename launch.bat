@echo off
REM Diyar HR Automation - one-click launcher
REM Double-click this file (or pin to taskbar) to bring up everything:
REM   Docker Desktop -> hr-postgres -> Ollama -> SMTP sidecar -> n8n -> legacy frontend -> React frontend
REM Then opens http://localhost:3001 (React app) in your default browser.

cd /d "%~dp0"

REM Find Git Bash. Falls back through the common install locations.
set "BASH_EXE="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\bin\bash.exe"
if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if "%BASH_EXE%"=="" (
  echo ERROR: Git Bash not found. Install Git for Windows or edit this file.
  pause
  exit /b 1
)

REM Run start.sh in Git Bash. Keep window open on exit so errors are visible.
"%BASH_EXE%" -c "./start.sh; echo; echo 'Press any key to close this window (services keep running in the background).'; read -n 1"
