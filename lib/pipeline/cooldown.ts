import { REFRESH_COOLDOWN_MINUTES } from './config';

// In-memory cooldown store. Resets on cold start but never crashes on
// a read-only serverless filesystem (Vercel). Sufficient for single-user.
const store = new Map<string, number>(); // userId → timestamp ms

export interface CooldownStatus {
  allowed: boolean;
  secondsRemaining: number;
}

export function checkCooldown(userId: string): CooldownStatus {
  const last = store.get(userId);
  if (!last) return { allowed: true, secondsRemaining: 0 };
  const cooldownMs = REFRESH_COOLDOWN_MINUTES * 60 * 1000;
  const elapsed = Date.now() - last;
  if (elapsed >= cooldownMs) return { allowed: true, secondsRemaining: 0 };
  return { allowed: false, secondsRemaining: Math.ceil((cooldownMs - elapsed) / 1000) };
}

export function recordRefresh(userId: string): void {
  store.set(userId, Date.now());
}
