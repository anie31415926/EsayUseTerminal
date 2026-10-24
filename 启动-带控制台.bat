@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Spark Terminal
echo ============================================
echo   Spark Terminal 启动中...
echo   关闭此窗口即退出终端
echo ============================================
npm run dev
pause
