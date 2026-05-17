@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python "%SCRIPT_DIR%tools\clc.py" %*
    exit /b %ERRORLEVEL%
)

py -3 "%SCRIPT_DIR%tools\clc.py" %*
exit /b %ERRORLEVEL%
