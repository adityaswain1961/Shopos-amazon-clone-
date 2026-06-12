import { create } from 'zustand';

interface UiState {
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  toggleCart: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  cartOpen: false,
  setCartOpen: (cartOpen) => set({ cartOpen }),
  toggleCart: () => set((s) => ({ cartOpen: !s.cartOpen })),
}));
