@echo off
cd /d %~dp0
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Running QA checks...
call npm run check
if errorlevel 1 goto :fail

echo Building Windows installer...
call npm run dist:win
if errorlevel 1 goto :fail

echo.
echo Done. Check the dist folder for the installer EXE.
pause
exit /b 0

:fail
echo.
echo Build failed.
pause
exit /b 1
