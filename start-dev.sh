#!/bin/bash

# 港美股量化交易平台开发环境启动脚本

echo "🚀 启动港美股量化交易平台 (开发模式)..."

# 检查是否安装了必要的工具
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ 错误: $1 未安装"
        exit 1
    fi
}

echo "🔍 检查依赖..."
check_command "cargo"
check_command "node"
check_command "npm"

# 创建日志目录
mkdir -p logs

# 启动后端服务（开发模式）
echo "🦀 启动Rust后端服务 (开发模式)..."
nohup cargo run > logs/backend-dev.log 2>&1 &
BACKEND_PID=$!
echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"

# 等待后端启动
echo "⏳ 等待后端服务启动..."
sleep 3

# 启动前端服务（开发模式）
echo "⚛️  启动Next.js前端服务 (开发模式)..."
cd frontend

# 安装前端依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
fi

# 启动前端开发服务器
nohup npm run dev > ../logs/frontend-dev.log 2>&1 &
FRONTEND_PID=$!
echo "✅ 前端开发服务器已启动 (PID: $FRONTEND_PID)"

cd ..

# 保存PID到文件
echo $BACKEND_PID > logs/backend-dev.pid
echo $FRONTEND_PID > logs/frontend-dev.pid

echo ""
echo "🎉 港美股量化交易平台开发环境启动完成！"
echo ""
echo "📱 前端界面: http://localhost:3000 (热重载)"
echo "🔧 后端API: http://localhost:8080 (自动重启)"
echo "💚 健康检查: http://localhost:8080/health"
echo ""
echo "📋 服务状态:"
echo "   后端PID: $BACKEND_PID"
echo "   前端PID: $FRONTEND_PID"
echo ""
echo "📝 日志文件:"
echo "   后端日志: logs/backend-dev.log"
echo "   前端日志: logs/frontend-dev.log"
echo ""
echo "🛑 停止服务: ./stop-dev.sh"
echo ""
echo "💡 开发提示:"
echo "   - 前端支持热重载，修改代码会自动刷新"
echo "   - 后端修改需要重启服务"
echo "   - 使用 'tail -f logs/backend-dev.log' 查看后端日志"
echo "   - 使用 'tail -f logs/frontend-dev.log' 查看前端日志"
echo ""

# 等待用户输入
echo "按 Ctrl+C 停止所有服务..."
trap 'echo ""; echo "🛑 正在停止开发服务..."; kill $BACKEND_PID $FRONTEND_PID; echo "✅ 所有开发服务已停止"; exit 0' INT

# 保持脚本运行
while true; do
    sleep 1
done