import { apiFetch } from './client';
import type { AuthUser, LoginResponse, TokenPair } from '../types';

export async function login(email: string, password: string) {
  return apiFetch<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(name: string, email: string, password: string) {
  return apiFetch<{ user: AuthUser }>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function forgotPassword(email: string) {
  return apiFetch<{ message: string }>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function refreshToken(refreshToken: string) {
  return apiFetch<{ tokens: TokenPair }>('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function logout(refreshToken: string, accessToken: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}/api/v1/auth/logout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Correlation-Id': crypto.randomUUID(),
      },
      body: JSON.stringify({ refreshToken }),
    },
  );
  if (!res.ok) throw new Error('Logout failed');
  return res.json();
}
