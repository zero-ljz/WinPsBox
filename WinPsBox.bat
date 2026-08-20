@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0app.ps1" %*

set "exitCode=%ERRORLEVEL%"
endlocal & exit /b %exitCode%
