@echo off
REM Diyar HR - shutdown script
REM Stops everything launch.bat / start.sh brings up, in reverse order:
REM   React frontend (3001) -> n8n (5678) -> SMTP (8901) -> IMAP (8902) -> Recording (8903) -> Auth (8904) -> Ollama (11434) -> hr-postgres
REM Docker Desktop itself is left running (stop from its tray icon if you want a full shutdown).
REM
REM See HOW-IT-WORKS.md (repo root) for the full service map; this list stays in
REM sync with the start order in launch.bat / start.sh.

cd /d "%~dp0"

echo Stopping Diyar HR services...
echo.

call :kill_port 3001 "[1/8] React frontend"
call :kill_port 5678 "[2/8] n8n"
call :kill_port 8901 "[3/8] SMTP sidecar"
call :kill_port 8902 "[4/8] IMAP sidecar"
call :kill_port 8903 "[5/8] Recording server"
call :kill_port 8904 "[6/8] Auth sidecar"

echo [7/8] Stopping Ollama...
taskkill /F /IM ollama.exe >nul 2>&1
if errorlevel 1 (
  echo   Ollama not running.
) else (
  echo   Ollama stopped.
  taskkill /F /IM ollama_llama_server.exe >nul 2>&1
)

echo [8/8] Stopping hr-postgres container...
docker ps --format "{{.Names}}" 2>nul | findstr /X "hr-postgres" >nul
if %errorlevel% == 0 (
  docker stop hr-postgres >nul 2>&1
  echo   hr-postgres stopped.
) else (
  echo   hr-postgres not running.
)

echo.
echo All Diyar HR services stopped.
echo Docker Desktop left running ^(stop manually from its tray icon if you want a full shutdown^).
echo.
pause
exit /b 0

:kill_port
REM %1 = port, %2 = label
set "PORT=%~1"
set "LABEL=%~2"
echo %LABEL% on port %PORT%...
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr /C:":%PORT% "') do (
  if not defined FOUND (
    set "FOUND=1"
    taskkill /F /PID %%P >nul 2>&1
    if errorlevel 1 (
      echo   Failed to kill PID %%P.
    ) else (
      echo   Killed PID %%P.
    )
  )
)
if not defined FOUND echo   Not running.
exit /b 0
