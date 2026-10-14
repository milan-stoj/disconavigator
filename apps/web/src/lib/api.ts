export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { fieldErrors?: Record<string, string> } & Record<string, unknown>,
  ) {
    super(message);
  }
  get fieldErrors(): Record<string, string> {
    return this.details?.fieldErrors ?? {};
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registers what happens when an authenticated request returns 401 (session expired). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

export interface RequestOptions {
  /** Do not trigger the session-expired handler on 401 (sign-in, me). */
  allowUnauthorized?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; details?: ApiError['details'] };
    if (res.status === 401 && !opts.allowUnauthorized) onUnauthorized?.();
    throw new ApiError(
      res.status,
      err.error ?? 'error',
      err.message ?? res.statusText,
      err.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, opts?: RequestOptions) => request<T>('GET', url, undefined, opts),
  post: <T>(url: string, body: unknown = {}, opts?: RequestOptions) =>
    request<T>('POST', url, body, opts),
  put: <T>(url: string, body: unknown = {}, opts?: RequestOptions) =>
    request<T>('PUT', url, body, opts),
  patch: <T>(url: string, body: unknown = {}, opts?: RequestOptions) =>
    request<T>('PATCH', url, body, opts),
  delete: <T>(url: string, opts?: RequestOptions) => request<T>('DELETE', url, undefined, opts),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
