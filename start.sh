#!/bin/bash

# 港美股量化交易平台启动脚本

echo "🚀 启动港美股量化交易平台..."

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

# 启动后端服务
echo "🦀 启动Rust后端服务..."
cargo build --release
if [ $? -ne 0 ]; then
    echo "❌ 后端编译失败"
    exit 1
fi

# 后台启动后端
nohup cargo run --release > logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"

# 等待后端启动
echo "⏳ 等待后端服务启动..."
sleep 5

# 检查后端是否正常启动
if curl -f http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ 后端服务健康检查通过"
else
    echo "⚠️  后端服务可能未完全启动，继续启动前端..."
fi

# 启动前端服务
echo "⚛️  启动Next.js前端服务..."
cd frontend

# 安装前端依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
fi

# 构建前端（生产模式）
echo "🏗️  构建前端应用..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败"
    kill $BACKEND_PID
    exit 1
fi

# 启动前端
nohup npm start > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "✅ 前端服务已启动 (PID: $FRONTEND_PID)"

cd ..

# 保存PID到文件
echo $BACKEND_PID > logs/backend.pid
echo $FRONTEND_PID > logs/frontend.pid

echo ""
echo "🎉 港美股量化交易平台启动完成！"
echo ""
echo "📱 前端界面: http://localhost:3000"
echo "🔧 后端API: http://localhost:8080"
echo "💚 健康检查: http://localhost:8080/health"
echo ""
echo "📋 服务状态:"
echo "   后端PID: $BACKEND_PID"
echo "   前端PID: $FRONTEND_PID"
echo ""
echo "📝 日志文件:"
echo "   后端日志: logs/backend.log"
echo "   前端日志: logs/frontend.log"
echo ""
echo "🛑 停止服务: ./stop.sh"
echo ""

# 等待用户输入
echo "按 Ctrl+C 停止所有服务..."
trap 'echo ""; echo "🛑 正在停止服务..."; kill $BACKEND_PID $FRONTEND_PID; echo "✅ 所有服务已停止"; exit 0' INT

# 保持脚本运行
while true; do
    sleep 1
done