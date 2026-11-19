@echo off
setlocal
set PANTHESIA_HEADLESS_CHECK=
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-desktop.ps1" -Launch %*
if errorlevel 1 (
  echo Panthesia could not prepare the current desktop version.
  pause
  exit /b 1
)
