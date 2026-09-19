import {create} from 'zustand';
import type {PaymentStatus} from '@rosapay/domain';

export type AppMode = 'customer' | 'merchant';
export type LocalReceipt = {
  intentId: string;
  merchantName: string;
  recipient: string;
  amount: string;
  assetCode: string;
  network: 'testnet' | 'pubnet';
  payloadHash: string;
  status: PaymentStatus;
  transactionHash: string;
  createdAt: string;
};

type AppState = {
  mode: AppMode;
  merchantEnabled: boolean;
  receipts: LocalReceipt[];
  setMode(mode: AppMode): void;
  activateMerchant(): void;
  addReceipt(receipt: LocalReceipt): void;
};

export const useAppStore = create<AppState>(set => ({
  mode: 'customer',
  merchantEnabled: false,
  receipts: [],
  setMode: mode => set(state => (mode === 'merchant' && !state.merchantEnabled ? state : {...state, mode})),
  activateMerchant: () => set({merchantEnabled: true, mode: 'merchant'}),
  addReceipt: receipt => set(state => ({receipts: [receipt, ...state.receipts]})),
}));
