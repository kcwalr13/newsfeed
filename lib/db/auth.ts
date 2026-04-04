import { sql } from './client';
import type { DbUser, DbSession, DbToken } from '@/lib/types/auth';

// --- Users ---

export async function createUser(
  userId: string,
  email: string,
  hashedPassword: string
): Promise<DbUser> {
  const rows = await sql`
    INSERT INTO users (user_id, email, hashed_password)
    VALUES (${userId}, ${email}, ${hashedPassword})
    RETURNING *
  `;
  return rows[0] as DbUser;
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const rows = await sql`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;
  return (rows[0] as DbUser) ?? null;
}

export async function getUserById(userId: string): Promise<DbUser | null> {
  const rows = await sql`
    SELECT * FROM users WHERE user_id = ${userId} LIMIT 1
  `;
  return (rows[0] as DbUser) ?? null;
}

export async function setEmailVerified(userId: string): Promise<void> {
  await sql`
    UPDATE users SET email_verified_at = NOW() WHERE user_id = ${userId}
  `;
}

export async function updatePassword(userId: string, hashedPassword: string): Promise<void> {
  await sql`
    UPDATE users SET hashed_password = ${hashedPassword} WHERE user_id = ${userId}
  `;
}

// --- Sessions ---

export async function createSession(
  sessionId: string,
  userId: string,
  expiresAt: Date
): Promise<DbSession> {
  const rows = await sql`
    INSERT INTO sessions (session_id, user_id, expires_at)
    VALUES (${sessionId}, ${userId}, ${expiresAt})
    RETURNING *
  `;
  return rows[0] as DbSession;
}

export async function getSessionById(sessionId: string): Promise<DbSession | null> {
  const rows = await sql`
    SELECT * FROM sessions
    WHERE session_id = ${sessionId} AND expires_at > NOW()
    LIMIT 1
  `;
  return (rows[0] as DbSession) ?? null;
}

export async function refreshSession(sessionId: string, newExpiresAt: Date): Promise<void> {
  await sql`
    UPDATE sessions
    SET last_active_at = NOW(), expires_at = ${newExpiresAt}
    WHERE session_id = ${sessionId}
  `;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE session_id = ${sessionId}`;
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

// --- Tokens ---

export async function createToken(
  token: string,
  userId: string,
  purpose: 'email_verification' | 'password_reset',
  expiresAt: Date
): Promise<void> {
  await sql`
    INSERT INTO verification_tokens (token, user_id, purpose, expires_at)
    VALUES (${token}, ${userId}, ${purpose}, ${expiresAt})
  `;
}

export async function getToken(
  token: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<DbToken | null> {
  const rows = await sql`
    SELECT * FROM verification_tokens
    WHERE token = ${token} AND purpose = ${purpose} AND expires_at > NOW()
    LIMIT 1
  `;
  return (rows[0] as DbToken) ?? null;
}

export async function deleteToken(token: string): Promise<void> {
  await sql`DELETE FROM verification_tokens WHERE token = ${token}`;
}

export async function deleteTokensForUser(
  userId: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<void> {
  await sql`
    DELETE FROM verification_tokens WHERE user_id = ${userId} AND purpose = ${purpose}
  `;
}
