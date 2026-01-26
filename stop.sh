#!/bin/bash

# 港美股量化交易平台停止脚本

echo "🛑 停止港美股量化交易平台..."

# 读取PID文件并停止服务
if [ -f "logs/backend.pid" ]; then
    BACKEND_PID=$(cat logs/backend.pid)
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo "🦀 停止后端服务 (PID: $BACKEND_PID)..."
        kill $BACKEND_PID
        echo "✅ 后端服务已停止"
    else
        echo "⚠️  后端服务已经停止"
    fi
    rm -f logs/backend.pid
else
    echo "⚠️  未找到后端PID文件"
fi

if [ -f "logs/frontend.pid" ]; then
    FRONTEND_PID=$(cat logs/frontend.pid)
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "⚛️  停止前端服务 (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID
        echo "✅ 前端服务已停止"
    else
        echo "⚠️  前端服务已经停止"
    fi
    rm -f logs/frontend.pid
else
    echo "⚠️  未找到前端PID文件"
fi

# 清理可能残留的进程
echo "🧹 清理残留进程..."
pkill -f "cargo run"
pkill -f "next start"

echo "✅ 所有服务已停止"