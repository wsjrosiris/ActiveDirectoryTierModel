@echo off
rem TierModel Service - Setup
rem Startet den interaktiven Installationsassistenten (fordert bei Bedarf Administratorrechte an).
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-TierModelService.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%
