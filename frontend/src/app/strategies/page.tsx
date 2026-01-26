'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { strategyApi } from '@/lib/api';
import type { StrategyConfig, BacktestResult } from '@/types';
import { Plus, Play, Trash2, Edit, BarChart } from 'lucide-react';

export default function StrategiesPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showBacktestModal, setShowBacktestModal] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig | null>(null);
  const [strategyForm, setStrategyForm] = useState({
    name: '',
    description: '',
    parameters: {},
    risk_limits: {},
    is_active: true,
  });
  const [backtestParams, setBacktestParams] = useState({
    start_date: '',
    end_date: '',
  });

  const queryClient = useQueryClient();

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: async () => {
      try {
        const result = await strategyApi.getStrategies();
        return result as StrategyConfig[];
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
        return [];
      }
    },
    refetchInterval: 10000,
  });

  const createStrategyMutation = useMutation({
    mutationFn: strategyApi.createStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowCreateForm(false);
      setStrategyForm({
        name: '',
        description: '',
        parameters: {},
        risk_limits: {},
        is_active: true,
      });
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StrategyConfig> }) =>
      strategyApi.updateStrategy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: strategyApi.deleteStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });

  const runBacktestMutation = useMutation({
    mutationFn: ({ strategyId, startDate, endDate }: { strategyId: string; startDate: string; endDate: string }) =>
      strategyApi.runBacktest(strategyId, startDate, endDate),
    onSuccess: () => {
      setShowBacktestModal(false);
      alert('回测任务已提交，请稍后查看回测结果');
    },
  });

  const handleCreateStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证JSON参数
    try {
      JSON.stringify(strategyForm.parameters);
    } catch (err) {
      alert('策略参数JSON格式不正确');
      return;
    }
    
    createStrategyMutation.mutate(strategyForm);
  };

  const handleDeleteStrategy = (id: string) => {
    if (confirm('确定要删除这个策略吗？')) {
      deleteStrategyMutation.mutate(id);
    }
  };

  const handleToggleStrategy = (strategy: StrategyConfig) => {
    updateStrategyMutation.mutate({
      id: strategy.id,
      data: { is_active: !strategy.is_active },
    });
  };

  const handleRunBacktest = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    setShowBacktestModal(true);
  };

  const handleSubmitBacktest = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStrategy) {
      runBacktestMutation.mutate({
        strategyId: selectedStrategy.id,
        startDate: backtestParams.start_date,
        endDate: backtestParams.end_date,
      });
    }
  };

  // 确保strategies是数组
  const strategiesArray = Array.isArray(strategies) ? strategies : 
                          ((strategies as any)?.strategies ? (strategies as any).strategies : []);
  
  // 计算统计数据
  const totalCount = strategiesArray.length;
  const activeCount = strategiesArray.filter((s: StrategyConfig) => s.is_active).length;
  const inactiveCount = totalCount - activeCount;

  const getStatusColor = (isActive: boolean) => {
    return isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
  };

  const getStatusText = (isActive: boolean) => {
    return isActive ? '运行中' : '已停止';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">策略管理</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          新建策略
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">策略列表</h3>
            </div>

            {isLoading ? (
              <div className="p-6">
                <div className="animate-pulse space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {strategiesArray.map((strategy: StrategyConfig) => (
                  <div key={strategy.id} className="p-6 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h4 className="text-lg font-medium text-gray-900">
                            {strategy.name}
                          </h4>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(strategy.is_active)}`}>
                            {getStatusText(strategy.is_active)}
                          </span>
                        </div>

                        {strategy.description && (
                          <p className="mt-2 text-sm text-gray-500">
                            {strategy.description}
                          </p>
                        )}

                        <div className="mt-3 flex items-center space-x-6 text-sm">
                          <div>
                            <span className="text-gray-500">参数数量:</span>
                            <span className="ml-1 font-medium text-gray-900">
                              {Object.keys(strategy.parameters || {}).length}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">创建时间:</span>
                            <span className="ml-1 font-medium text-gray-900">
                              {new Date(strategy.created_at).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleToggleStrategy(strategy)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                          title={strategy.is_active ? '停止策略' : '启动策略'}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRunBacktest(strategy)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                          title="运行回测"
                        >
                          <BarChart className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteStrategy(strategy.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="删除策略"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {strategiesArray.length === 0 && (
                  <div className="p-12 text-center text-sm text-gray-500">
                    暂无策略，点击"新建策略"开始创建
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">策略统计</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">总策略数</span>
                <span className="text-lg font-bold text-gray-900">
                  {totalCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">运行中</span>
                <span className="text-lg font-bold text-green-600">
                  {activeCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">已停止</span>
                <span className="text-lg font-bold text-gray-600">
                  {inactiveCount}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">快速操作</h3>
            <div className="space-y-3">
              <button
                onClick={() => setShowCreateForm(true)}
                className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                新建策略
              </button>
              <button className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                <BarChart className="h-4 w-4 mr-2" />
                批量回测
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-medium">新建策略</h3>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStrategy} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略名称
                </label>
                <input
                  type="text"
                  value={strategyForm.name}
                  onChange={(e) => setStrategyForm({ ...strategyForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如: 移动平均策略"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略描述
                </label>
                <textarea
                  value={strategyForm.description}
                  onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                  placeholder="描述策略的原理和使用方法..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略参数 (JSON格式)
                </label>
                <textarea
                  value={JSON.stringify(strategyForm.parameters, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setStrategyForm({ ...strategyForm, parameters: parsed });
                    } catch (err) {
                      // 暂时允许无效JSON，用户保存时会验证
                    }
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                  rows={6}
                  placeholder='{"short_period": 5, "long_period": 20}'
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={strategyForm.is_active}
                  onChange={(e) => setStrategyForm({ ...strategyForm, is_active: e.target.checked })}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                  立即启用策略
                </label>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createStrategyMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {createStrategyMutation.isPending ? '创建中...' : '创建策略'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBacktestModal && selectedStrategy && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">运行回测</h3>
              <button
                onClick={() => setShowBacktestModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-2">策略名称</p>
                <p className="font-medium text-gray-900">{selectedStrategy.name}</p>
              </div>

              <form onSubmit={handleSubmitBacktest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    开始日期
                  </label>
                  <input
                    type="date"
                    value={backtestParams.start_date}
                    onChange={(e) => setBacktestParams({ ...backtestParams, start_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    结束日期
                  </label>
                  <input
                    type="date"
                    value={backtestParams.end_date}
                    onChange={(e) => setBacktestParams({ ...backtestParams, end_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowBacktestModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={runBacktestMutation.isPending}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {runBacktestMutation.isPending ? '运行中...' : '运行回测'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
