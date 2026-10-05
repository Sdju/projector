@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Нужен node в PATH 1>&2
  exit /b 1
)
node "%~dp0..\cli\app\launch.mjs" %*
