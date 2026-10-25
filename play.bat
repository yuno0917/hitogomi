@echo off
chcp 65001 > nul
cd /d "%~dp0"
py -3 serve.py
if errorlevel 1 python serve.py
pause
