import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/lib/types';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
  hasRole: (role: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
      isAuthenticated: () => !!get().accessToken && !!get().user,
      hasRole: (role) => get().user?.roles?.includes(role) ?? false,
    }),
    { name: 'shopos-auth' },
  ),
);
