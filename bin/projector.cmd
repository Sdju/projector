@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Нужен node в PATH 1>&2
  exit /b 1
)
set "ENTRY=%~dp0..\packages\cli\app\launch.ts"
if not exist "%ENTRY%" set "ENTRY=%~dp0..\packages\cli\app\launch.js"
node "%ENTRY%" %*
