import type { ApiResponse, TokenPair } from '../types';
import { useAuthStore } from '@/store/authStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// One refresh at a time: if 20 requests get a 401 together, they all wait for
// the same refresh instead of racing (which would trip token-reuse detection).
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, user, setAuth, clearAuth } = useAuthStore.getState();
  if (!refreshToken || !user) return null;

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (res.status === 409) {
          // Another tab rotated it a moment ago; it persisted the new pair.
          return useAuthStore.getState().accessToken;
        }
        if (!res.ok) {
          clearAuth();
          return null;
        }
        const json = (await res.json()) as ApiResponse<{ tokens: TokenPair }>;
        setAuth(user, json.data.tokens.accessToken, json.data.tokens.refreshToken);
        return json.data.tokens.accessToken;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function request(path: string, options: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': crypto.randomUUID(),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

/** Fetch an API endpoint and return `{ data, meta }` from the standard envelope. */
export async function apiFetchWithMeta<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  const token = typeof window === 'undefined' ? null : useAuthStore.getState().accessToken;
  let res = await request(path, options, token);

  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await request(path, options, fresh);
  }

  const json = (await res.json().catch(() => ({}))) as Partial<ApiResponse<T>>;
  if (!res.ok || json.success === false) {
    if (res.status === 429) {
      throw new ApiError('Too many requests, please slow down and try again shortly.', 429);
    }
    throw new ApiError(json.error ?? res.statusText ?? 'Request failed', res.status);
  }
  return { data: json.data as T, meta: json.meta };
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await apiFetchWithMeta<T>(path, options)).data;
}

export { API_URL };
