# 港美股量化交易平台 - 前端界面

这是港美股量化交易平台的现代化Web前端界面，基于Next.js 14和React 18构建。

## 🚀 技术栈

- **框架**: Next.js 14 (App Router)
- **UI库**: React 18 + TypeScript
- **样式**: Tailwind CSS
- **状态管理**: TanStack Query (React Query)
- **图表**: Recharts
- **图标**: Lucide React
- **表单**: React Hook Form + Zod
- **实时通信**: Socket.IO Client

## 📋 功能特性

### 🏠 仪表板
- 实时投资组合概览
- 资产分布饼图
- 盈亏统计
- 系统状态监控

### 📈 市场数据
- 实时股价显示
- 价格走势图表
- 买卖盘信息
- 热门股票列表
- 多时间框架切换

### 💼 投资组合
- 持仓详情展示
- 资产分布可视化
- 实时盈亏计算
- 历史表现分析

### 🔄 交易执行
- 订单创建界面
- 实时订单状态
- 交易历史记录
- 订单管理操作

### 📊 策略管理
- 策略配置界面
- 回测结果展示
- 策略性能分析
- 参数优化工具

### 🛡️ 风险管理
- 风险指标监控
- 告警信息展示
- 限制设置界面
- 合规检查状态

## 🛠️ 安装和运行

### 前置要求
- Node.js 18+ 
- npm 或 yarn

### 容器化运行
```bash
cd ..
./scripts/deploy.sh up --build
```

访问 `http://localhost:3002` 查看应用。

### 单独开发运行
```bash
cd frontend
npm install
npm run dev
```

默认开发端口通常为 `http://localhost:3000`。

### 生产环境构建
```bash
npm run build
npm start
```

## 🔧 配置说明

### API代理配置
前端通过Next.js的rewrites功能代理后端API请求：

```javascript
// next.config.js
async rewrites() {
  return [
    {
      source: '/api/:path*',
      destination: `${BACKEND_ORIGIN}/api/:path*`,
    },
  ];
}
```

### 环境变量
创建 `.env.local` 文件：

```bash
# 本地单独开发时的后端地址
BACKEND_ORIGIN=http://localhost:8080

# 容器化运行时通常不需要手动设置，compose 会注入:
# BACKEND_ORIGIN=http://backend:8080
```

## 📱 响应式设计

界面采用响应式设计，支持：
- 桌面端 (1024px+)
- 平板端 (768px - 1023px)  
- 移动端 (< 768px)

## 🎨 UI组件

### 布局组件
- `Navbar`: 顶部导航栏
- `Sidebar`: 侧边导航菜单
- `Layout`: 整体布局容器

### 业务组件
- `DashboardOverview`: 仪表板概览
- `MarketDataWidget`: 市场数据组件
- `PortfolioSummary`: 投资组合摘要
- `RecentTrades`: 最近交易记录
- `SystemStatus`: 系统状态指示器

### 图表组件
- 基于Recharts的响应式图表
- 支持折线图、饼图、柱状图
- 实时数据更新
- 交互式工具提示

## 🔄 数据流

### API集成
```typescript
// 使用TanStack Query进行数据获取
const { data, isLoading, error } = useQuery({
  queryKey: ['portfolio'],
  queryFn: () => portfolioApi.getPortfolio(),
  refetchInterval: 5000, // 自动刷新
});
```

### 实时数据
```typescript
// WebSocket连接管理
const wsManager = new WebSocketManager();
wsManager.connect('ws://your-public-entry/ws', (data) => {
  // 处理实时数据更新
});
```

说明：当前仓库默认启动链路里 `/ws` 仍未挂载，这段代码示例仅表示客户端接入方式。

## 🧪 测试

### 运行测试
```bash
npm run test
```

### 类型检查
```bash
npm run type-check
```

### 代码检查
```bash
npm run lint
```

## 📦 构建优化

- **代码分割**: 自动路由级别代码分割
- **图片优化**: Next.js Image组件优化
- **字体优化**: Google Fonts自动优化
- **Bundle分析**: 使用@next/bundle-analyzer

## 🔒 安全特性

- **CSP**: 内容安全策略配置
- **HTTPS**: 生产环境强制HTTPS
- **API验证**: 请求参数验证
- **错误边界**: React错误边界处理

## 🌐 国际化

支持中英文切换：
- 中文 (zh-CN) - 默认
- 英文 (en-US)

## 📈 性能监控

- **Core Web Vitals**: 关键性能指标监控
- **错误追踪**: 运行时错误收集
- **用户分析**: 用户行为分析

## 🚀 部署

### Vercel部署
```bash
npm install -g vercel
vercel
```

### Docker部署
```bash
cd ..
./scripts/deploy.sh up --build
```

### Nginx配置
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api/ {
        proxy_pass http://backend:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 🤝 开发指南

### 代码规范
- 使用TypeScript严格模式
- 遵循ESLint配置
- 使用Prettier格式化
- 组件采用函数式写法

### 文件结构
```
src/
├── app/                 # Next.js App Router页面
├── components/          # 可复用组件
│   ├── dashboard/      # 仪表板组件
│   ├── layout/         # 布局组件
│   ├── market/         # 市场数据组件
│   ├── portfolio/      # 投资组合组件
│   ├── trading/        # 交易组件
│   └── system/         # 系统组件
├── lib/                # 工具库和API
├── types/              # TypeScript类型定义
└── hooks/              # 自定义React Hooks
```

### 组件开发
```typescript
// 组件模板
interface ComponentProps {
  // 定义props类型
}

export function Component({ }: ComponentProps) {
  // 组件逻辑
  return (
    <div>
      {/* JSX内容 */}
    </div>
  );
}
```

## 📞 支持

如有问题或建议，请联系开发团队或提交Issue。

---

**港美股量化交易平台前端** - 为专业交易者打造的现代化交易界面
