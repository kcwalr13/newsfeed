export const DEVICE_ID_COOKIE = 'dd_device_id';
export const DEVICE_ID_STORAGE_KEY = 'dd_device_id';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const pairs = document.cookie.split('; ');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    if (pair.slice(0, idx) === name) return pair.slice(idx + 1);
  }
  return null;
}

function setCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  document.cookie = `${name}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function getLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (e.g. private browsing quota exceeded) — not fatal
  }
}

/**
 * Returns the device ID from cookie (primary) or localStorage (fallback).
 * Returns null if neither is present.
 */
export function readDeviceId(): string | null {
  return getCookie(DEVICE_ID_COOKIE) ?? getLocalStorage(DEVICE_ID_STORAGE_KEY);
}

/**
 * Reads or creates the device ID, persisting it to both cookie and localStorage.
 * Refreshes the cookie expiry on every call.
 * Always returns a non-empty string.
 */
export function initDeviceId(): string {
  if (typeof window === 'undefined') return '';

  const existing = readDeviceId();
  if (existing) {
    // Refresh expiry and ensure both locations are populated
    setCookie(DEVICE_ID_COOKIE, existing);
    setLocalStorage(DEVICE_ID_STORAGE_KEY, existing);
    return existing;
  }

  const id = crypto.randomUUID();
  setCookie(DEVICE_ID_COOKIE, id);
  setLocalStorage(DEVICE_ID_STORAGE_KEY, id);
  return id;
}

/**
 * Returns the X-Device-ID header to attach to feedback API requests.
 * Returns an empty object if no device ID is available.
 */
export function getDeviceHeaders(): Record<string, string> {
  const id = readDeviceId();
  return id ? { 'X-Device-ID': id } : {};
}
