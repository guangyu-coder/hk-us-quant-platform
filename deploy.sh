#!/bin/bash

# 港美股量化交易平台 - 一键全栈部署脚本 (Docker Compose)

echo "🐳 正在准备 Docker 部署环境..."

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: Docker 未安装。请先安装 Docker 和 Docker Compose。"
    exit 1
fi

# 检查环境配置
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，正在从 .env.example 创建..."
    cp .env.example .env
    echo "✅ 已创建 .env。请记得编辑文件填入 Alpaca API Key (如需实盘)。"
fi

# 检查 Nginx 配置目录
if [ ! -d "config" ]; then
    mkdir -p config
fi

echo "🚀 启动所有服务 (后端 + 前端 + 数据库 + 监控)..."
echo "⏳ 首次构建可能需要几分钟，请耐心等待..."

# 使用生产环境 Compose 文件启动
docker compose -f docker-compose.prod.yml up -d --build

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 部署成功！所有服务已在后台运行。"
    echo ""
    echo "🌍 访问地址:"
    echo "   主页 (Frontend): http://localhost"
    echo "   API 端点:       http://localhost/api/v1/health"
    echo "   Grafana 监控:   http://localhost:3001 (用户: admin / 密码: admin)"
    echo ""
    echo "📋 常用命令:"
    echo "   查看日志: docker compose -f docker-compose.prod.yml logs -f"
    echo "   停止服务: docker compose -f docker-compose.prod.yml down"
    echo ""
else
    echo "❌ 部署失败，请检查上方错误日志。"
    exit 1
fi
