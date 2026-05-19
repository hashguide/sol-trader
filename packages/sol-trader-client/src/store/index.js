import { create } from 'zustand'
import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const useStore = create((set, get) => ({
  // State
  strategies: [],
  trades: [],
  positions: [],
  performance: [],
  perfSummary: [],
  tokens: [],
  prices: {},
  signals: [],
  wallet: { address: null, balance: null },
  config: {},
  wsConnected: false,
  activeTab: 'dashboard',
  selectedStrategy: null,
  notifications: [],
  chatMessages: [],
  chatLoading: false,

  // WS
  setWsConnected: (v) => set({ wsConnected: v }),

  handleWsMessage: (msg) => {
    const { type } = msg
    const notifications = get().notifications
    if (['trade_opened', 'trade_filled', 'trade_closed', 'trade_failed', 'ai_signal', 'strategy_update', 'strategy_error'].includes(type)) {
      set({ notifications: [{ ...msg, id: Date.now() }, ...notifications].slice(0, 50) })
    }
    if (type === 'strategy_update' || type === 'strategy_stopped') get().fetchStrategies()
    if (type === 'trade_filled' || type === 'trade_closed') {
      get().fetchTrades()
      get().fetchPositions()
      get().fetchPerfSummary()
    }
    if (type === 'ai_signal') {
      set({ signals: [msg, ...get().signals].slice(0, 100) })
    }
  },

  // Actions
  fetchStrategies: async () => {
    const { data } = await api.get('/strategies')
    set({ strategies: data })
  },

  fetchTrades: async (strategyId) => {
    const params = strategyId ? { strategy_id: strategyId } : {}
    const { data } = await api.get('/trades', { params })
    set({ trades: data })
  },

  fetchPositions: async () => {
    const { data } = await api.get('/positions')
    set({ positions: data })
  },

  fetchPerformance: async (strategyId, days = 30) => {
    const params = { days, ...(strategyId ? { strategy_id: strategyId } : {}) }
    const { data } = await api.get('/performance', { params })
    set({ performance: data })
  },

  fetchPerfSummary: async () => {
    const { data } = await api.get('/performance/summary')
    set({ perfSummary: data })
  },

  fetchTokens: async () => {
    const { data } = await api.get('/market/tokens')
    set({ tokens: data })
  },

  fetchPrices: async () => {
    const { data } = await api.get('/market/prices')
    set({ prices: data })
  },

  fetchSignals: async () => {
    const { data } = await api.get('/signals')
    set({ signals: data })
  },

  fetchWallet: async () => {
    const { data } = await api.get('/wallet')
    set({ wallet: data })
  },

  fetchConfig: async () => {
    const { data } = await api.get('/config')
    set({ config: data })
  },

  saveConfig: async (cfg) => {
    await api.post('/config', cfg)
    get().fetchConfig()
    get().fetchWallet()
  },

  createStrategy: async (data) => {
    const res = await api.post('/strategies', data)
    get().fetchStrategies()
    return res.data
  },

  updateStrategy: async (id, data) => {
    await api.put(`/strategies/${id}`, data)
    get().fetchStrategies()
  },

  deleteStrategy: async (id) => {
    await api.delete(`/strategies/${id}`)
    get().fetchStrategies()
  },

  startStrategy: async (id) => {
    await api.post(`/strategies/${id}/start`)
    get().fetchStrategies()
  },

  stopStrategy: async (id) => {
    await api.post(`/strategies/${id}/stop`)
    get().fetchStrategies()
  },

  addToken: async (tokenData) => {
    await api.post('/market/tokens', tokenData)
    get().fetchTokens()
  },

  removeToken: async (mint) => {
    await api.delete(`/market/tokens/${mint}`)
    get().fetchTokens()
  },

  sendChat: async (message) => {
    set({ chatLoading: true, chatMessages: [...get().chatMessages, { role: 'user', content: message }] })
    try {
      const { data } = await api.post('/chat', { message, context: { priceData: get().prices } })
      set({ chatMessages: [...get().chatMessages, { role: 'assistant', content: data.response }] })
    } catch {
      set({ chatMessages: [...get().chatMessages, { role: 'assistant', content: 'Error communicating with AI.' }] })
    } finally {
      set({ chatLoading: false })
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedStrategy: (id) => set({ selectedStrategy: id }),
  dismissNotification: (id) => set({ notifications: get().notifications.filter(n => n.id !== id) }),

  initAll: async () => {
    await Promise.all([
      get().fetchStrategies(),
      get().fetchTrades(),
      get().fetchPositions(),
      get().fetchPerfSummary(),
      get().fetchTokens(),
      get().fetchPrices(),
      get().fetchSignals(),
      get().fetchWallet(),
      get().fetchConfig(),
    ])
  },
}))

export { api }
