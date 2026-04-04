import fs from 'fs';
import path from 'path';
import { REFRESH_COOLDOWN_MINUTES } from './config';

const COOLDOWN_FILE = path.resolve(process.cwd(), 'data', 'refresh_cooldowns.json');

type CooldownStore = Record<string, string>; // userId → ISO-8601 UTC timestamp

function readStore(): CooldownStore {
  if (!fs.existsSync(COOLDOWN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf-8')) as CooldownStore;
  } catch {
    return {};
  }
}

function writeStore(store: CooldownStore): void {
  const dir = path.dirname(COOLDOWN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export interface CooldownStatus {
  /** true if the user is allowed to trigger a refresh now. */
  allowed: boolean;
  /** Seconds until the cooldown expires. 0 when allowed is true. */
  secondsRemaining: number;
}

/**
 * Checks whether the given userId may trigger a manual refresh.
 * Does NOT write to the cooldown store. Call recordRefresh() separately
 * only after a successful pipeline run.
 */
export function checkCooldown(userId: string): CooldownStatus {
  const store = readStore();
  const lastRefresh = store[userId];
  if (!lastRefresh) return { allowed: true, secondsRemaining: 0 };

  const cooldownMs = REFRESH_COOLDOWN_MINUTES * 60 * 1000;
  const elapsed = Date.now() - new Date(lastRefresh).getTime();
  if (elapsed >= cooldownMs) return { allowed: true, secondsRemaining: 0 };

  return { allowed: false, secondsRemaining: Math.ceil((cooldownMs - elapsed) / 1000) };
}

/**
 * Records that the given userId has triggered a successful refresh.
 * Starts the cooldown window. Must only be called after a successful
 * pipeline run — do NOT call on failure so the user can retry immediately.
 */
export function recordRefresh(userId: string): void {
  const store = readStore();
  store[userId] = new Date().toISOString();
  writeStore(store);
}
