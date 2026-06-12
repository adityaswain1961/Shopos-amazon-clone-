import type { ApiResponse } from '../types';

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

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('shopos-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.accessToken ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': crypto.randomUUID(),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const json = (await res.json().catch(() => ({}))) as ApiResponse<T> & { error?: string };

  if (!res.ok) {
    throw new ApiError(json.error ?? res.statusText ?? 'Request failed', res.status);
  }
  if (json.success === false) {
    throw new ApiError(json.error ?? 'Request failed', res.status);
  }
  return json.data as T;
}

export { API_URL };
