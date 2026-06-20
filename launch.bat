@echo off
REM Diyar HR - one-click launcher
REM Double-click this file (or pin to taskbar) to bring up everything:
REM   Docker Desktop -> hr-postgres -> Ollama -> Python sidecars (SMTP/IMAP/recording/Auth) -> n8n -> React frontend
REM The Auth sidecar (port 8904) powers app login + RBAC; start.sh installs its
REM one dependency (psycopg2) automatically on first run.
REM Then opens http://localhost:3001 in your default browser (login required).
REM
REM New here? Read HOW-IT-WORKS.md (repo root) for how the whole system fits
REM together, and CLAUDE.md for the authoritative source of truth + change log.

cd /d "%~dp0"

REM Find Git Bash. Try common install locations first, then fall back to PATH-based discovery.
set "BASH_EXE="
call :try_bash "C:\Program Files\Git\bin\bash.exe"
call :try_bash "C:\Program Files (x86)\Git\bin\bash.exe"
call :try_bash "%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
call :try_bash "D:\git\Git\bin\bash.exe"
call :try_bash "D:\Git\bin\bash.exe"

if not defined BASH_EXE call :find_bash_on_path
if not defined BASH_EXE call :derive_bash_from_git

if not defined BASH_EXE (
  echo ERROR: Git Bash not found. Install Git for Windows or edit this file.
  echo Checked: C:\Program Files\Git, C:\Program Files ^(x86^)\Git, %%LOCALAPPDATA%%\Programs\Git, D:\git\Git, D:\Git, and PATH.
  pause
  exit /b 1
)

echo Using Git Bash at: %BASH_EXE%

REM Run start.sh in Git Bash. Keep window open on exit so errors are visible.
"%BASH_EXE%" -c "./start.sh; echo; echo 'Press any key to close this window (services keep running in the background).'; read -n 1"
exit /b 0

:try_bash
if defined BASH_EXE exit /b 0
if exist %~1 set "BASH_EXE=%~1"
exit /b 0

:find_bash_on_path
for /f "usebackq delims=" %%I in (`where bash.exe 2^>nul`) do call :try_bash "%%I"
exit /b 0

:derive_bash_from_git
for /f "usebackq delims=" %%I in (`where git.exe 2^>nul`) do call :try_bash "%%~dpI..\bin\bash.exe"
for /f "usebackq delims=" %%I in (`where git.exe 2^>nul`) do call :try_bash "%%~dpI..\..\bin\bash.exe"
exit /b 0
