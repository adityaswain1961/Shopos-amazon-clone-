'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import * as authApi from '@/lib/api/auth';
import { useAuthStore } from '@/store/authStore';
import { ApiError } from '@/lib/api/client';

export function useLogin() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (data) => {
      setAuth(data.user, data.tokens.accessToken, data.tokens.refreshToken);
      const redirect =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('redirect')
          : null;
      router.push(redirect && redirect.startsWith('/') ? redirect : '/');
      router.refresh();
    },
  });
}

export function useRegister() {
  const router = useRouter();

  return useMutation({
    mutationFn: ({
      name,
      email,
      password,
    }: {
      name: string;
      email: string;
      password: string;
    }) => authApi.register(name, email, password),
    onSuccess: () => router.push('/login?registered=1'),
  });
}

export function useLogout() {
  const router = useRouter();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  return useMutation({
    mutationFn: async () => {
      if (accessToken && refreshToken) {
        await authApi.logout(refreshToken, accessToken).catch(() => {});
      }
    },
    onSettled: () => {
      clearAuth();
      router.push('/');
    },
  });
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
