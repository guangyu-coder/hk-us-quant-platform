'use client';

import { useState } from 'react';
import { Settings, User, Bell, Shield, Database, Globe, Save } from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({
    general: {
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      currency: 'USD',
      theme: 'light',
    },
    notifications: {
      email_notifications: true,
      order_alerts: true,
      risk_alerts: true,
      price_alerts: true,
      daily_summary: true,
    },
    trading: {
      paper_trading: true,
      risk_check: true,
      max_order_size: 10000,
      default_order_type: 'Market',
    },
    security: {
      two_factor_auth: false,
      session_timeout: 30,
      ip_whitelist: '',
    },
  });

  const handleSave = () => {
    alert('设置已保存（模拟）');
  };

  const tabs = [
    { id: 'general', name: '通用设置', icon: Globe },
    { id: 'notifications', name: '通知设置', icon: Bell },
    { id: 'trading', name: '交易设置', icon: Settings },
    { id: 'security', name: '安全设置', icon: Shield },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">系统设置</h1>
        <button
          onClick={handleSave}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Save className="h-4 w-4 mr-2" />
          保存设置
        </button>
      </div>

      <div className="flex space-x-6">
        {/* 侧边栏 */}
        <div className="w-64 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon className="h-5 w-5 mr-3" />
              {tab.name}
            </button>
          ))}
        </div>

        {/* 设置内容 */}
        <div className="flex-1 bg-white rounded-lg shadow p-6">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">通用设置</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    语言
                  </label>
                  <select
                    value={settings.general.language}
                    onChange={(e) => setSettings({
                      ...settings,
                      general: { ...settings.general, language: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="zh-CN">中文 (简体)</option>
                    <option value="en-US">English</option>
                    <option value="zh-TW">中文 (繁體)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    时区
                  </label>
                  <select
                    value={settings.general.timezone}
                    onChange={(e) => setSettings({
                      ...settings,
                      general: { ...settings.general, timezone: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                    <option value="America/New_York">America/New_York (UTC-5)</option>
                    <option value="Europe/London">Europe/London (UTC+0)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    货币
                  </label>
                  <select
                    value={settings.general.currency}
                    onChange={(e) => setSettings({
                      ...settings,
                      general: { ...settings.general, currency: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="CNY">CNY (¥)</option>
                    <option value="HKD">HKD (HK$)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    主题
                  </label>
                  <select
                    value={settings.general.theme}
                    onChange={(e) => setSettings({
                      ...settings,
                      general: { ...settings.general, theme: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">通知设置</h3>
              
              <div className="space-y-4">
                {[
                  { key: 'email_notifications', label: '邮件通知', description: '接收重要事项的邮件通知' },
                  { key: 'order_alerts', label: '订单提醒', description: '订单状态变化时发送通知' },
                  { key: 'risk_alerts', label: '风险告警', description: '风险指标超过阈值时提醒' },
                  { key: 'price_alerts', label: '价格警报', description: '股价达到预设价位时通知' },
                  { key: 'daily_summary', label: '每日总结', description: '每日交易总结报告' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{item.label}</p>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifications[item.key as keyof typeof settings.notifications]}
                        onChange={(e) => setSettings({
                          ...settings,
                          notifications: {
                            ...settings.notifications,
                            [item.key]: e.target.checked
                          }
                        })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'trading' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">交易设置</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">模拟交易模式</p>
                    <p className="text-sm text-gray-500">使用虚拟资金进行交易模拟</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.trading.paper_trading}
                      onChange={(e) => setSettings({
                        ...settings,
                        trading: { ...settings.trading, paper_trading: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">风险检查</p>
                    <p className="text-sm text-gray-500">下单前进行风险验证</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.trading.risk_check}
                      onChange={(e) => setSettings({
                        ...settings,
                        trading: { ...settings.trading, risk_check: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最大订单数量
                  </label>
                  <input
                    type="number"
                    value={settings.trading.max_order_size}
                    onChange={(e) => setSettings({
                      ...settings,
                      trading: { ...settings.trading, max_order_size: parseInt(e.target.value) }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    min="1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    默认订单类型
                  </label>
                  <select
                    value={settings.trading.default_order_type}
                    onChange={(e) => setSettings({
                      ...settings,
                      trading: { ...settings.trading, default_order_type: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="Market">市价单</option>
                    <option value="Limit">限价单</option>
                    <option value="Stop">止损单</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">安全设置</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">两步验证 (2FA)</p>
                    <p className="text-sm text-gray-500">增强账户安全性</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.security.two_factor_auth}
                      onChange={(e) => setSettings({
                        ...settings,
                        security: { ...settings.security, two_factor_auth: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    会话超时 (分钟)
                  </label>
                  <input
                    type="number"
                    value={settings.security.session_timeout}
                    onChange={(e) => setSettings({
                      ...settings,
                      security: { ...settings.security, session_timeout: parseInt(e.target.value) }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    min="5"
                    max="120"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    IP白名单 (可选)
                  </label>
                  <textarea
                    value={settings.security.ip_whitelist}
                    onChange={(e) => setSettings({
                      ...settings,
                      security: { ...settings.security, ip_whitelist: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                    placeholder="每行一个IP地址，例如: 192.168.1.1"
                  />
                  <p className="mt-1 text-xs text-gray-500">留空表示不限制IP访问</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
