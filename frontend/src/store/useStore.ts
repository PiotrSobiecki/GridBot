import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserSettings, OrderSettings, PriceData, GridState, Position } from '../types';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  walletAddress: string | null;
  token: string | null;
  
  // User data
  userSettings: UserSettings | null;
  
  // Current state
  activeOrderIndex: number;
  prices: Record<string, PriceData>;
  gridStates: Record<string, GridState>;
  positions: Record<string, Position[]>;

  // Niestandardowa kolejność zleceń (przechowywana lokalnie, persisted)
  orderSequence: string[];

  // Actions
  setAuth: (walletAddress: string, token: string) => void;
  logout: () => void;
  setUserSettings: (settings: UserSettings) => void;
  setActiveOrderIndex: (index: number) => void;
  updatePrice: (
    symbol: string,
    price: number,
    priceChangePercent?: number | null,
    rawPrice?: string | number | null,
  ) => void;
  setGridState: (orderId: string, state: GridState) => void;
  setPositions: (orderId: string, positions: Position[]) => void;
  addOrder: (order: OrderSettings) => void;
  updateOrder: (orderId: string, updates: Partial<OrderSettings>) => void;
  deleteOrder: (orderId: string) => void;
  setOrderSequence: (sequence: string[]) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      walletAddress: null,
      token: null,
      userSettings: null,
      activeOrderIndex: 0,
      prices: {},
      gridStates: {},
      positions: {},
      orderSequence: [],
      
      // Auth actions
      setAuth: (walletAddress, token) => set({
        isAuthenticated: true,
        walletAddress,
        token
      }),
      
      logout: () => set({
        isAuthenticated: false,
        walletAddress: null,
        token: null,
        userSettings: null,
        gridStates: {},
        positions: {}
      }),
      
      // Settings actions
      setUserSettings: (settings) => set({ userSettings: settings }),
      
      setActiveOrderIndex: (index) => set({ activeOrderIndex: index }),
      
      // Price actions
      // price = wartość liczbowa do obliczeń, rawPrice = oryginalny string z API (z zachowanymi zerami)
      updatePrice: (
        symbol,
        price,
        priceChangePercent?: number | null,
        rawPrice?: string | number | null,
      ) =>
        set((state) => ({
          prices: {
            ...state.prices,
            [symbol]: {
              symbol,
              price,
              rawPrice: rawPrice ?? price,
              timestamp: Date.now(),
              priceChangePercent,
            },
          },
        })),
      
      // Grid state actions
      setGridState: (orderId, gridState) => set((state) => ({
        gridStates: {
          ...state.gridStates,
          [orderId]: gridState
        }
      })),
      
      setPositions: (orderId, positionList) => set((state) => ({
        positions: {
          ...state.positions,
          [orderId]: positionList
        }
      })),
      
      // Order actions
      addOrder: (order) => set((state) => {
        if (!state.userSettings) return state;
        return {
          userSettings: {
            ...state.userSettings,
            orders: [...state.userSettings.orders, order]
          }
        };
      }),
      
      updateOrder: (orderId, updates) => set((state) => {
        if (!state.userSettings) return state;
        return {
          userSettings: {
            ...state.userSettings,
            orders: state.userSettings.orders.map(order =>
              order._id === orderId ? { ...order, ...updates } : order
            )
          }
        };
      }),
      
      deleteOrder: (orderId) => set((state) => {
        if (!state.userSettings) return state;
        return {
          userSettings: {
            ...state.userSettings,
            orders: state.userSettings.orders.filter(order => order._id !== orderId)
          }
        };
      }),

      setOrderSequence: (sequence) => set({ orderSequence: sequence }),
    }),
    {
      name: 'gridbot-storage',
      partialize: (state) => ({
        token: state.token,
        walletAddress: state.walletAddress,
        isAuthenticated: state.isAuthenticated,
        orderSequence: state.orderSequence,
      })
    }
  )
);
