@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   Navio Server v2 - 一键重建免安装包
echo ============================================
echo.

rem C 盘长期 0 空闲，electron-builder / NSIS 会在 C: 建 mmap 失败。
rem 全程改用 D 盘临时目录 + 自写 app.asar 组装，不依赖打包器。
if not exist "C:\AI使用\navio-tmp" mkdir "C:\AI使用\navio-tmp"
set "TEMP=C:\AI使用\navio-tmp"
set "TMP=C:\AI使用\navio-tmp"
set "ELECTRON_RUN_AS_NODE="

set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
"%NODE_EXE%" -v >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 Node.js。
  pause
  exit /b 1
)

echo [构建中] tools\build-portable.js ...
echo.
"%NODE_EXE%" tools\build-portable.js C:\AI使用\NavioServer
if errorlevel 1 (
  echo.
  echo [错误] 构建失败，详见上方输出。
  pause
  exit /b 1
)

echo.
echo ============================================
echo   完成
echo   程序   C:\AI使用\NavioServer\win-unpacked\Navio.exe
echo   压缩包 C:\AI使用\NavioServer\Navio-2.0.0-win-x64.zip
echo   文档   C:\AI使用\NavioServer\README.md
echo.
echo   双击 exe 打开服务端控制台，浏览器访问 http://127.0.0.1:9200
echo   首次管理员密码见数据目录 INITIAL_ADMIN.txt
echo ============================================
echo.
pause
