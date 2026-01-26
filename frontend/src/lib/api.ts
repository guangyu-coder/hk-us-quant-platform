import axios from 'axios';
import type { 
  MarketData, 
  Order, 
  CreateOrderPayload,
  Portfolio, 
  StrategyConfig, 
  SystemHealth,
  BacktestResult,
  ApiResponse 
} from '@/types';

// 创建axios实例
const api = axios.create({
  // 使用相对路径，让 Next.js 的 rewrites 代理请求到后端
  // 这样可以解决跨域问题，以及云端 IDE 环境下 localhost 无法访问的问题
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token等
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// 系统健康检查
export const getSystemHealth = async (): Promise<SystemHealth> => {
  // 使用相对路径，通过 Next.js 代理转发
  const response = await axios.get('/health');
  return response.data;
};

// 市场数据API
export const marketDataApi = {
  // 获取实时市场数据
  getRealTimeData: async (symbol: string): Promise<MarketData> => {
    return api.get(`/v1/market-data/${symbol}`);
  },

  // 获取历史数据
  getHistoricalData: async (
    symbol: string, 
    startDate: string, 
    endDate: string,
    interval?: string
  ): Promise<MarketData[]> => {
    return api.get(`/v1/market-data/${symbol}/history`, {
      params: { start: startDate, end: endDate, interval }
    });
  },

  // 获取多个股票的实时数据
  getMultipleSymbols: async (symbols: string[]): Promise<MarketData[]> => {
    return api.post('/v1/market-data/batch', { symbols });
  },

  // 搜索标的
  searchSymbols: async (query: string): Promise<any> => {
    return api.get('/v1/market-data/search', {
      params: { query }
    });
  },

  // 获取市场标的列表
  getMarketList: async (exchange?: string, country?: string, type?: string): Promise<any> => {
    return api.get('/v1/market-data/list', {
      params: { exchange, country, instrument_type: type }
    });
  },
};

// 策略API
export const strategyApi = {
  // 获取所有策略
  getStrategies: async (): Promise<StrategyConfig[]> => {
    return api.get('/v1/strategies');
  },

  // 创建策略
  createStrategy: async (strategy: Partial<StrategyConfig>): Promise<StrategyConfig> => {
    return api.post('/v1/strategies', strategy);
  },

  // 更新策略
  updateStrategy: async (id: string, strategy: Partial<StrategyConfig>): Promise<StrategyConfig> => {
    return api.put(`/v1/strategies/${id}`, strategy);
  },

  // 删除策略
  deleteStrategy: async (id: string): Promise<void> => {
    return api.delete(`/v1/strategies/${id}`);
  },

  // 运行回测
  runBacktest: async (
    strategyId: string, 
    startDate: string, 
    endDate: string
  ): Promise<BacktestResult> => {
    return api.post(`/v1/strategies/${strategyId}/backtest`, {
      start_date: startDate,
      end_date: endDate
    });
  },
};

// 订单API
export const orderApi = {
  // 获取所有订单
  getOrders: async (): Promise<Order[]> => {
    return api.get('/v1/orders');
  },

  // 创建订单
  createOrder: async (order: CreateOrderPayload): Promise<Order> => {
    return api.post('/v1/orders', order);
  },

  // 取消订单
  cancelOrder: async (orderId: string): Promise<void> => {
    return api.delete(`/v1/orders/${orderId}`);
  },

  // 获取订单状态
  getOrderStatus: async (orderId: string): Promise<Order> => {
    return api.get(`/v1/orders/${orderId}`);
  },
};

// 组合API
export const portfolioApi = {
  // 获取组合信息
  getPortfolio: async (portfolioId?: string): Promise<Portfolio> => {
    const id = portfolioId || 'default';
    return api.get(`/v1/portfolio`);
  },

  // 获取持仓信息
  getPositions: async (portfolioId?: string): Promise<any> => {
    return api.get(`/v1/portfolio/positions`);
  },

  // 获取盈亏报告
  getPnLReport: async (portfolioId?: string, date?: string): Promise<any> => {
    return api.get(`/v1/portfolio/pnl`, {
      params: date ? { date } : {}
    });
  },
};

// 风险管理API
export const riskApi = {
  // 获取风险指标
  getRiskMetrics: async (portfolioId?: string): Promise<any> => {
    return api.get(`/v1/risk/metrics`);
  },

  // 获取风险告警
  getRiskAlerts: async (): Promise<any[]> => {
    return api.get('/v1/risk/alerts');
  },
};

// WebSocket连接管理
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 1000;

  connect(url: string, onMessage: (data: any) => void, onError?: (error: Event) => void) {
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.reconnect(url, onMessage, onError);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (onError) onError(error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      if (onError) onError(error as Event);
    }
  }

  private reconnect(url: string, onMessage: (data: any) => void, onError?: (error: Event) => void) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect(url, onMessage, onError);
      }, this.reconnectInterval * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default api;
