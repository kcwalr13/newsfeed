# Technical Design — User Authentication (Milestone 3)

**ID**: ARCH-DESIGN-004
**Stories Reference**: `agents/pm/stories_user_auth_v1.md` (AUTH-001 through AUTH-011)
**BRD Reference**: `agents/ba/brd_user_auth_v1.md` (BRD-005)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Tech Choices and Justifications
3. New Directory Structure
4. Database Schema (DDL)
5. Auth Query Helpers (`lib/db/auth.ts`)
6. Session Middleware (`lib/auth/session.ts`)
7. Feedback Route Changes — Prefer `user_id` Over `device_id`
8. API Route Specifications
9. Email Module (`lib/email/send.ts`)
10. Auth Context — Client-Side Session State
11. Auth UI — Header Icon and `/auth` Page
12. Feedback Migration on Login (AUTH-005 / AUTH-006)
13. App Startup Sequence Changes
14. New npm Dependencies
15. Environment Variables
16. Deferred Items

---

## 1. Architecture Overview

Milestone 3 adds a user identity layer on top of the existing device identity
layer. Device identity (SFB-001) is preserved and remains the fallback for
anonymous users. The new layer introduces four database tables, a session cookie,
a suite of API routes, and a minimal auth UI surface.

### What is new

- `lib/db/auth.ts` — typed query helpers for `users`, `sessions`,
  `verification_tokens` tables
- `lib/auth/session.ts` — server-side session resolution helper used by all
  auth-aware routes
- `lib/email/send.ts` — thin email dispatch module using Nodemailer + SMTP
- `lib/types/auth.ts` — TypeScript types for this milestone
- `app/api/auth/register/route.ts` — POST /api/auth/register
- `app/api/auth/verify-email/route.ts` — GET /api/auth/verify-email
- `app/api/auth/resend-verification/route.ts` — POST /api/auth/resend-verification
- `app/api/auth/login/route.ts` — POST /api/auth/login (includes migration)
- `app/api/auth/logout/route.ts` — POST /api/auth/logout
- `app/api/auth/me/route.ts` — GET /api/auth/me
- `app/api/auth/forgot-password/route.ts` — POST /api/auth/forgot-password
- `app/api/auth/reset-password/route.ts` — POST /api/auth/reset-password
- `app/auth/page.tsx` — register/login toggle page at `/auth`
- `app/components/AuthContext.tsx` — React context for auth state (user, loading)
- `app/components/AccountIcon.tsx` — header account icon, reads auth context

### What is modified

- `app/layout.tsx` — wrap children with `AuthProvider`; add `AccountIcon` to
  the shared header shell (or defer to per-page headers — see §11)
- `app/page.tsx` — add `GET /api/auth/me` call in startup sequence; pass
  `user_id` into feedback writes; update header to include `AccountIcon`
- `app/articles/[id]/page.tsx` — add `AccountIcon` to article page header
- `lib/db/feedback.ts` — add `upsertFeedbackWithUser` and
  `associateFeedbackToUser` helpers; add `mergeDeviceFeedbackOnLogin` for
  cross-device conflict resolution
- `app/api/feedback/route.ts` — prefer session `user_id` when writing feedback
- `app/api/feedback/[articleId]/route.ts` — same session preference
- `.env.example` — add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `EMAIL_FROM`, `NEXTAUTH_URL`

### What is NOT modified

- `lib/identity/device.ts` — zero changes. Device identity layer is untouched.
- `lib/feedback/store.ts` — minimal change: pass `user_id` in POST body when
  a session is active; the store already calls the feedback API
- `app/components/FeedbackButtons.tsx` — zero changes
- `app/components/ArticleCard.tsx` — zero changes
- All pipeline code — zero changes
- Feed and article API routes — zero changes

### Data flow

```
USER REGISTERS
  └─► POST /api/auth/register
        ├─ hash password (bcrypt, cost=12)
        ├─ INSERT INTO users
        ├─ INSERT INTO verification_tokens (purpose='email_verification', 1h)
        └─ send verification email via SMTP

USER VERIFIES EMAIL
  └─► GET /api/auth/verify-email?token=<token>
        ├─ validate token, check expiry
        ├─ UPDATE users SET email_verified_at = NOW()
        ├─ DELETE verification_tokens WHERE token = ?
        └─ redirect to /auth?verified=1

USER LOGS IN
  └─► POST /api/auth/login
        ├─ verify credentials (bcrypt.compare)
        ├─ check email_verified_at IS NOT NULL
        ├─ INSERT INTO sessions (expires_at = NOW() + 30 days)
        ├─ Set-Cookie: dd_session=<session_id>; HttpOnly; SameSite=Lax; Max-Age=30d
        ├─ run device→user feedback migration (AUTH-005 / AUTH-006)
        └─ return { userId, email }

AUTHENTICATED REQUEST (feedback write)
  └─► POST /api/feedback
        ├─ extractSession(req) → resolve user_id (may be null)
        ├─ refresh session last_active_at + expires_at (sliding window)
        └─ upsertFeedback(deviceId, articleId, value, userId)

GET /api/auth/me (client startup)
  └─► resolve session cookie → 200 { userId, email } or 401 {}
```

---

## 2. Tech Choices and Justifications

### Password Hashing — bcrypt

**Choice**: `bcrypt` via the `bcryptjs` npm package (pure JS, no native
bindings, works on Vercel/Neon edge-compatible runtimes). Cost factor: **12**.

**Why not argon2?** argon2 has better theoretical security but requires native
bindings that are unreliable in serverless environments. bcrypt at cost=12 is
the industry standard for web apps at this scale and is fully compatible with
Next.js serverless functions.

**Why not `bcrypt` (native) over `bcryptjs`?** Native `bcrypt` requires
compilation and is fragile on Vercel. `bcryptjs` is slower but the difference
is imperceptible at interactive latency (< 300ms hashing time at cost=12).

### Session Tokens — Random Token Stored in Database (not JWT)

**Choice**: A cryptographically random 32-byte hex string generated with
`crypto.randomBytes(32).toString('hex')`, stored as the `session_id` (primary
key) in the `sessions` table. Transmitted as an `HttpOnly` cookie named
`dd_session`.

**Why not JWT?** JWTs are stateless, which makes logout unreliable — a
stolen token remains valid until expiry. This system has a hard requirement
that logout invalidates the session immediately (AUTH-008 AC#2). A database-
backed session satisfies this without any extra complexity. The sessions table
also naturally enables the sliding-window expiry update on every request.

**Why not UUID v4 as session token?** `crypto.randomBytes(32)` produces 256
bits of entropy vs 122 bits for UUID v4. The session token is a security-
critical secret; more entropy is better.

**Cookie configuration**:
```
Name:     dd_session
HttpOnly: true   (cannot be read by JavaScript — security requirement)
SameSite: Lax    (protects against CSRF on state-changing requests)
Secure:   true in production, false in development
Max-Age:  2592000  (30 days in seconds)
Path:     /
```

The `dd_device_id` cookie coexists with `dd_session`. Both are present when
the user is logged in. `dd_device_id` is `HttpOnly: false` (client-readable);
`dd_session` is `HttpOnly: true`. They serve different purposes and do not
interfere with each other.

### Email Sending — Nodemailer with SMTP

**Choice**: `nodemailer` pointed at a standard SMTP relay. In development,
[Mailtrap](https://mailtrap.io) (free sandbox) is recommended. In production,
use any transactional SMTP provider (Postmark, Mailgun, SendGrid — all offer
a free tier for low volume). No SDK-specific vendor lock-in; only SMTP
credentials change between environments.

**Why not a transactional API (e.g., Postmark SDK)?** The email volume is
extremely low (one email per registration, one per password reset). SMTP via
Nodemailer works with any provider, requires zero SDK changes to switch
providers, and avoids pulling in a vendor-specific dependency that would need
to be replaced if the provider changes. The extra latency of SMTP vs. HTTP API
(~100–200ms) is acceptable because email dispatch is fire-and-forget and does
not block the API response.

**Why not `@sendgrid/mail` or similar?** Vendor lock-in at a stage where
provider choice is not final. SMTP is the lowest common denominator.

---

## 3. New Directory Structure

```
lib/
  auth/
    session.ts          ← NEW: resolveSession(), refreshSession(), clearSession()
  db/
    client.ts           ← unchanged
    feedback.ts         ← modified: +associateFeedbackToUser, +mergeDeviceFeedbackOnLogin
    auth.ts             ← NEW: query helpers for users/sessions/tokens tables
  email/
    send.ts             ← NEW: sendEmail(), sendVerificationEmail(), sendPasswordResetEmail()
  types/
    auth.ts             ← NEW: DbUser, DbSession, SessionPayload, etc.

app/
  api/
    auth/
      register/route.ts       ← NEW
      verify-email/route.ts   ← NEW
      resend-verification/route.ts ← NEW
      login/route.ts          ← NEW
      logout/route.ts         ← NEW
      me/route.ts             ← NEW
      forgot-password/route.ts ← NEW
      reset-password/route.ts  ← NEW
    feedback/
      route.ts                ← modified
      [articleId]/route.ts    ← modified
  auth/
    page.tsx                  ← NEW: /auth page
  components/
    AuthContext.tsx            ← NEW: AuthProvider + useAuth hook
    AccountIcon.tsx            ← NEW: header account icon
  layout.tsx                  ← modified: wrap with AuthProvider
  page.tsx                    ← modified: add session check + AccountIcon
  articles/[id]/page.tsx      ← modified: add AccountIcon to header
```

---

## 4. Database Schema (DDL)

Run once in the Neon SQL console, after the existing `feedback` table DDL.

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  user_id          TEXT        PRIMARY KEY,  -- crypto.randomUUID() on insert
  email            TEXT        NOT NULL UNIQUE,
  hashed_password  TEXT        NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,        -- NULL = unverified
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT        PRIMARY KEY,  -- 32-byte hex (64 chars)
  user_id       TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- Unified token table for email verification and password reset
CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT        PRIMARY KEY,  -- 32-byte hex (64 chars)
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose    TEXT        NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS verification_tokens_user_id_idx ON verification_tokens (user_id);
```

**Column notes:**

| Table | Column | Notes |
|-------|--------|-------|
| `users` | `user_id` | `crypto.randomUUID()` generated at insert time in application code. Not a DB sequence — UUIDs are portable and avoid leaking row counts. |
| `users` | `email` | Stored lowercase-normalised on write (`email.toLowerCase().trim()`). Unique index enforces uniqueness. |
| `users` | `hashed_password` | bcrypt output string (60 chars). Never returned to clients. |
| `users` | `email_verified_at` | NULL = unverified (cannot log in). Timestamp = verified. |
| `sessions` | `session_id` | 64-char hex string from `crypto.randomBytes(32).toString('hex')`. Primary key and the value stored in the cookie. |
| `sessions` | `expires_at` | Set to `NOW() + INTERVAL '30 days'` on creation and refreshed on every authenticated request. |
| `verification_tokens` | `token` | Same 32-byte hex generation as session IDs. |
| `verification_tokens` | `purpose` | Single table for both flows avoids schema duplication. Purpose is always validated before acting on a token. |

**Why TEXT for `user_id` not UUID type?** Consistent with `device_id` in the
`feedback` table which is already TEXT. Avoids a type mismatch in the
`feedback.user_id` column (which is TEXT NULL). UUIDs as TEXT work correctly.

---

## 5. Auth Query Helpers (`lib/db/auth.ts`)

**File**: `lib/db/auth.ts` — server-only. Never import in client-side code.

```typescript
import { sql } from './client';

export interface DbUser {
  user_id: string;
  email: string;
  hashed_password: string;
  email_verified_at: Date | null;
  created_at: Date;
}

export interface DbSession {
  session_id: string;
  user_id: string;
  created_at: Date;
  last_active_at: Date;
  expires_at: Date;
}

// --- Users ---

export async function createUser(
  userId: string,
  email: string,
  hashedPassword: string
): Promise<DbUser>

export async function getUserByEmail(email: string): Promise<DbUser | null>

export async function getUserById(userId: string): Promise<DbUser | null>

export async function setEmailVerified(userId: string): Promise<void>

export async function updatePassword(userId: string, hashedPassword: string): Promise<void>

// --- Sessions ---

export async function createSession(
  sessionId: string,
  userId: string,
  expiresAt: Date
): Promise<DbSession>

export async function getSessionById(sessionId: string): Promise<DbSession | null>
// Returns null if not found or if expires_at < NOW()

export async function refreshSession(sessionId: string, newExpiresAt: Date): Promise<void>
// UPDATE sessions SET last_active_at = NOW(), expires_at = $1 WHERE session_id = $2

export async function deleteSession(sessionId: string): Promise<void>

export async function deleteAllSessionsForUser(userId: string): Promise<void>

// --- Verification / Reset Tokens ---

export async function createToken(
  token: string,
  userId: string,
  purpose: 'email_verification' | 'password_reset',
  expiresAt: Date
): Promise<void>

export async function getToken(
  token: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<{ token: string; user_id: string; expires_at: Date } | null>
// Returns null if not found or expired (expires_at < NOW())

export async function deleteToken(token: string): Promise<void>

export async function deleteTokensForUser(
  userId: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<void>
```

All helpers use the `sql` tagged template from `lib/db/client.ts`. Parameterised
values are never string-concatenated.

---

## 6. Session Middleware (`lib/auth/session.ts`)

This module is the single shared utility for reading and validating the session
cookie on the server. All auth-aware API routes import from this file.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, refreshSession } from '@/lib/db/auth';

export const SESSION_COOKIE = 'dd_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  sessionId: string;
  userId: string;
}

/**
 * Reads the dd_session cookie, validates the session in the database,
 * and refreshes its expiry (sliding window). Returns null if no valid session.
 *
 * Side effect: mutates the response to set a refreshed cookie if a valid
 * session is found. Caller must return the response for the cookie to persist.
 */
export async function resolveSession(
  req: NextRequest,
  res: NextResponse
): Promise<SessionPayload | null>

/**
 * Builds a Set-Cookie header string for dd_session.
 * Used by login (create) and logout (clear).
 */
export function buildSessionCookie(sessionId: string, maxAge: number): string
// Returns: "dd_session=<id>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<n>[; Secure]"
// Secure is appended only when process.env.NODE_ENV === 'production'

/**
 * Returns a cookie string that clears dd_session.
 */
export function clearSessionCookie(): string
// Returns: "dd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
```

`resolveSession` is called on every feedback route and on `GET /api/auth/me`.
It performs a DB lookup so it should only be called when auth awareness is
needed — not on public routes (feed, articles, pipeline).

---

## 7. Feedback Route Changes — Prefer `user_id` Over `device_id`

The existing feedback routes (`POST /api/feedback`, `DELETE /api/feedback/[articleId]`,
`GET /api/feedback`) work today using `device_id` only. Milestone 3 adds
awareness of the session `user_id` without breaking anonymous operation.

### Pattern for all three routes

```typescript
// 1. Extract device ID (existing pattern — unchanged)
const deviceId = extractDeviceId(req);

// 2. NEW: Attempt to resolve session. If valid, get userId.
const tempRes = NextResponse.next();
const session = await resolveSession(req, tempRes);
const userId = session?.userId ?? null;

// 3. Pass userId to DB helpers (null is fine — anonymous path)
await upsertFeedback(deviceId, articleId, value, userId);
```

### Changes to `lib/db/feedback.ts`

`upsertFeedback` gains an optional fourth parameter:

```typescript
export async function upsertFeedback(
  deviceId: string,
  articleId: string,
  value: 'like' | 'dislike',
  userId?: string | null
): Promise<DbFeedbackRow>
```

When `userId` is provided (non-null), the INSERT/UPDATE also writes `user_id`.
When null/undefined, `user_id` is not changed (preserves any existing value or
leaves it null). The SQL becomes:

```sql
INSERT INTO feedback (device_id, article_id, value, updated_at, user_id)
VALUES ($1, $2, $3, NOW(), $4)
ON CONFLICT (device_id, article_id)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW(),
  user_id = COALESCE(EXCLUDED.user_id, feedback.user_id)
RETURNING article_id, value, updated_at
```

The `COALESCE` ensures that if `userId` is null on the upsert, an existing
`user_id` on the row is not wiped out.

`GET /api/feedback` also changes: when a session `userId` is present, the query
returns feedback for `user_id = $1` (the user's full cross-device history) rather
than `device_id = $1` (device-only). This is the mechanism that makes feedback
portable on login.

```typescript
// In GET /api/feedback route handler:
if (userId) {
  // Return all feedback for this user (cross-device)
  rows = await getFeedbackForUser(userId);
} else {
  // Anonymous path — unchanged
  rows = await getFeedbackForDevice(deviceId);
}
```

New helper in `lib/db/feedback.ts`:

```typescript
export async function getFeedbackForUser(userId: string): Promise<DbFeedbackRow[]>
// SELECT article_id, value, updated_at FROM feedback WHERE user_id = $1
```

---

## 8. API Route Specifications

All routes: `export const dynamic = 'force-dynamic'`.

---

### POST /api/auth/register

**File**: `app/api/auth/register/route.ts`

**Request body**: `{ email: string; password: string }`

**Validation**:
- Email must contain `@` and a domain part. Use a simple regex:
  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Return 400 on failure.
- Password must be ≥ 8 characters. Return 400 on failure.
- Normalize email: `email.toLowerCase().trim()`.

**Happy path**:
1. Check `getUserByEmail(normalizedEmail)` — if found, return 409 with:
   `{ message: "If this address is new, a verification email has been sent." }`
   (anti-enumeration: same message regardless of whether address was found)
2. `bcrypt.hash(password, 12)` — this is the slow step (~200–300ms)
3. `createUser(crypto.randomUUID(), normalizedEmail, hashedPassword)`
4. Generate verification token: `crypto.randomBytes(32).toString('hex')`
5. `createToken(token, userId, 'email_verification', expiresAt)` where
   `expiresAt = NOW + 24h`
6. `sendVerificationEmail(email, token)` — fire-and-forget (do not `await` in
   the request; wrap in `.catch(console.error)`)
7. Return 201: `{ message: "Verification email sent. Please check your inbox." }`

**Note on step 6**: Fire the email asynchronously. If the SMTP call fails, log
the error server-side but do not surface it to the client — the user record and
token are already created and the user can request a resend. This keeps the
endpoint fast and resilient to transient SMTP failures.

**Response codes**:
- 201 — success (also returned when email already exists — anti-enumeration)
- 400 — validation error (`{ error: "..." }` with field name in message)
- 500 — unexpected server error (DB failure, etc.)

---

### GET /api/auth/verify-email

**File**: `app/api/auth/verify-email/route.ts`

**Query param**: `?token=<hex>`

**Happy path**:
1. `getToken(token, 'email_verification')` — returns null if expired or not found
2. If null: return 400 `{ error: "Verification link is invalid or has expired." }`
   with a `{ resendUrl: "/api/auth/resend-verification" }` hint in the body.
3. If found:
   a. `setEmailVerified(userId)`
   b. `deleteToken(token)`
   c. `return NextResponse.redirect(new URL('/auth?verified=1', req.url))`

The client-side `/auth` page reads `?verified=1` on mount and shows a success
banner: "Your email has been verified. You can now log in."

---

### POST /api/auth/resend-verification

**File**: `app/api/auth/resend-verification/route.ts`

**Request body**: `{ email: string }`

Always returns 200 (anti-enumeration). If the email is registered and
unverified:
1. `deleteTokensForUser(userId, 'email_verification')` — remove any old tokens
2. Generate new token, `createToken(...)` with fresh 24h expiry
3. `sendVerificationEmail(email, token)` — fire-and-forget

---

### POST /api/auth/login

**File**: `app/api/auth/login/route.ts`

**Request body**: `{ email: string; password: string }`

**Happy path**:
1. Normalize email.
2. `getUserByEmail(email)` — if null, return 401 generic error.
3. `bcrypt.compare(password, user.hashed_password)` — if false, return 401 generic
   error. Message: `"Invalid email or password."` (never reveal which is wrong)
4. If `user.email_verified_at` is null: return 403
   `{ error: "Please verify your email address before logging in. Check your inbox." }`
5. Generate `sessionId = crypto.randomBytes(32).toString('hex')`
6. `expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)`
7. `createSession(sessionId, userId, expiresAt)`
8. Run feedback migration (see §12) — await before returning
9. Build response:
   ```
   Set-Cookie: dd_session=<sessionId>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000[; Secure]
   Body: { userId, email }
   Status: 200
   ```

**Response codes**:
- 200 — success
- 400 — validation error (missing fields)
- 401 — invalid credentials
- 403 — email not verified
- 500 — server error

---

### POST /api/auth/logout

**File**: `app/api/auth/logout/route.ts`

**Request body**: none

1. Read `dd_session` cookie.
2. If present: `deleteSession(sessionId)` (errors are swallowed — idempotent).
3. Response:
   ```
   Set-Cookie: dd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
   Body: { ok: true }
   Status: 200
   ```

Always 200. If no session cookie is present or the session is not found, still
return 200 with the clearing cookie.

---

### GET /api/auth/me

**File**: `app/api/auth/me/route.ts`

The thin session-check endpoint called on every client app load.

1. `resolveSession(req, res)` — validates cookie + DB lookup + refresh
2. If null: return 401 `{}`
3. If valid: return 200 `{ userId: session.userId, email: user.email }`
   (requires one extra `getUserById` call)

This is the only endpoint that refreshes the session sliding window on a GET.
All POST feedback endpoints also refresh it as a side effect of `resolveSession`.

---

### POST /api/auth/forgot-password

**File**: `app/api/auth/forgot-password/route.ts`

**Request body**: `{ email: string }`

Always returns 200 (anti-enumeration). If the email is registered and verified:
1. `deleteTokensForUser(userId, 'password_reset')` — clean up old tokens
2. Generate token, `createToken(token, userId, 'password_reset', expiresAt)`
   where `expiresAt = NOW + 1h`
3. `sendPasswordResetEmail(email, token)` — fire-and-forget

---

### POST /api/auth/reset-password

**File**: `app/api/auth/reset-password/route.ts`

**Request body**: `{ token: string; new_password: string }`

**Happy path**:
1. Validate `new_password` ≥ 8 characters. Return 400 if not.
2. `getToken(token, 'password_reset')` — null → 400
   `{ error: "Reset link is invalid or has expired." }`
3. `bcrypt.hash(newPassword, 12)`
4. `updatePassword(userId, hashedPassword)`
5. `deleteToken(token)`
6. `deleteAllSessionsForUser(userId)` — force re-login on all devices
7. Return 200 `{ message: "Password updated. Please log in." }`

---

## 9. Email Module (`lib/email/send.ts`)

```typescript
import nodemailer from 'nodemailer';

// Transporter is built once and reused (module-level singleton).
// Nodemailer manages connection pooling internally.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void>

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<void>
// Subject: "Verify your Tangent email address"
// Body: link to ${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}

export async function sendPasswordResetEmail(
  to: string,
  token: string
): Promise<void>
// Subject: "Reset your Tangent password"
// Body: link to ${process.env.NEXTAUTH_URL}/auth?reset_token=${token}
// The /auth page reads ?reset_token on mount and displays the new-password form
```

The password reset link navigates to the `/auth` page with a query param rather
than to an API route directly. This allows the UI to display the new-password
form with proper inline validation before calling `POST /api/auth/reset-password`.

Email bodies are plain HTML strings (no templating library). Volume is too low
to justify a template engine.

---

## 10. Auth Context — Client-Side Session State

**File**: `app/components/AuthContext.tsx`

A React context that holds the current auth state. Consumed by `AccountIcon`
and `app/page.tsx` (for passing `userId` into feedback writes).

```typescript
export interface AuthUser {
  userId: string;
  email: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
}

export const AuthContext = React.createContext<AuthContextValue>({...});

/**
 * Wraps children with AuthContext. On mount, calls GET /api/auth/me to
 * hydrate auth state. Non-blocking — children render immediately.
 */
export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element
```

`AuthProvider` calls `GET /api/auth/me` once on mount (in a `useEffect`). This
is the startup session check described in AUTH-010. The result sets `user` and
`loading: false`. Until the check resolves, `loading` is `true` and `user` is
`null`. UI components should treat `loading=true, user=null` as "session check
in flight" rather than "definitely anonymous."

`setUser` is exposed so that `POST /api/auth/login` and `POST /api/auth/logout`
can update the context without a full page reload.

`AuthProvider` is added to `app/layout.tsx` wrapping `{children}`. Since
`layout.tsx` is a Server Component, the Provider itself is a `'use client'`
component — this is the standard Next.js App Router pattern.

---

## 11. Auth UI — Header Icon and `/auth` Page

### AccountIcon component (`app/components/AccountIcon.tsx`)

A `'use client'` component that reads `useAuth()` from `AuthContext`.

**Logged-out state** (`user === null && !loading`): renders an outline person
SVG icon (24x24, stroke-based). Tap navigates to `/auth`.

**Loading state** (`loading === true`): renders the outline icon with reduced
opacity. This prevents a flash of the wrong state on fast loads.

**Logged-in state** (`user !== null`): renders a filled person SVG icon. Tap
opens a small dropdown menu with one item: "Log out". Selecting it calls
`POST /api/auth/logout` and sets `setUser(null)`.

The icon is wrapped in a `<button>` with `aria-label` set to either
"Sign in" or "Account menu". Tap target minimum: 44×44px (use `p-3` padding
around the 18px icon).

### Where AccountIcon lives

The existing header is rendered inline in `app/page.tsx` and again in
`app/articles/[id]/page.tsx`. Rather than adding a shared header Server Component
(which would require refactoring existing pages), add `<AccountIcon />` to the
existing `<header>` JSX in both pages, aligned right via `flex justify-between
items-center`. This is the minimal-change approach.

### `/auth` page (`app/auth/page.tsx`)

A `'use client'` page with local state managing which form is shown.

```typescript
type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-sent';
```

**URL query params handled on mount**:
- `?verified=1` — show "Email verified. Please log in." banner; set view to `'login'`
- `?reset_token=<token>` — show the new-password form; set view to `'reset-password'`
- `?mode=register` — start on register form

**Register form fields**:
- Email (type="email", required)
- Password (type="password", minLength=8, required)
- Confirm Password (type="password", required)

Client-side validation on blur and submit:
- Email: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Password: length ≥ 8
- Confirm: `=== password`

On successful registration: set view to `'verify-sent'` (show "Check your
email to verify your account. The link expires in 24 hours.")

**Login form fields**: Email + Password. On success: call `setUser(...)` from
AuthContext, then `router.push(returnTo ?? '/')` where `returnTo` is read from
`?returnTo=` query param if present.

**Forgot password form**: Email only. Submit calls `POST /api/auth/forgot-password`.
Always shows "If that email is registered, a reset link has been sent."

**Reset password form** (shown when `?reset_token` is present): New password +
confirm. On success: show "Password updated." banner and transition to login form.

**Toggle links**: "Already have an account? Sign in" and "No account? Register"
links switch the view without navigation.

---

## 12. Feedback Migration on Login (AUTH-005 / AUTH-006)

The migration runs as part of `POST /api/auth/login` after the session is
created, before returning the 200 response.

### Step-by-step

```
1. Extract deviceId from request (cookie or X-Device-ID header).
   If null: skip migration entirely (no device to migrate from).

2. Call associateFeedbackToUser(deviceId, userId)
```

`associateFeedbackToUser` is a new helper in `lib/db/feedback.ts`:

```typescript
export async function associateFeedbackToUser(
  deviceId: string,
  userId: string
): Promise<void>
```

This performs the cross-device merge in SQL — no application-level row-by-row
processing. The logic handles both AUTH-005 (first login on device) and AUTH-006
(second device, conflict resolution) in a single query set:

```sql
-- Step A: For rows this device has where the user already has a record for
-- the same article on another device — most-recent-wins.
-- Update the existing user-level record if the device record is newer.
UPDATE feedback AS existing
SET
  value      = device.value,
  updated_at = device.updated_at
FROM feedback AS device
WHERE device.device_id = $1            -- current device's rows
  AND device.user_id IS NULL           -- not yet claimed
  AND existing.user_id = $2            -- already claimed by this user on another device
  AND existing.article_id = device.article_id
  AND device.updated_at > existing.updated_at;  -- device is newer — wins

-- Step B: Claim all remaining unclaimed device rows where no user conflict exists
-- (and any that were not newer than the existing record in Step A).
UPDATE feedback
SET user_id = $2
WHERE device_id = $1
  AND user_id IS NULL;
```

**Correctness note**: Step A updates the winning value on the *existing* user
record but does NOT claim the device record's row in that step. Step B then
sets `user_id` on all still-unclaimed device rows (which includes the device rows
that *lost* the Step A conflict — their `user_id` is now set but their value is
not copied anywhere). The net result:
- The winning value is on the existing (other-device) record.
- The device record is claimed (has `user_id` set) but is not the authoritative
  record for that article from the user's perspective.
- `GET /api/feedback` for an authenticated user queries `WHERE user_id = $1`,
  which will return multiple rows with the same `article_id` from different
  devices. This is a problem — see the note below.

**Unique constraint consideration**: The `feedback` table has a unique constraint
on `(device_id, article_id)`. There is no unique constraint on `(user_id,
article_id)`. After migration, a user may have multiple rows per article (one
per device). The `getFeedbackForUser` query must handle this:

```sql
SELECT DISTINCT ON (article_id) article_id, value, updated_at
FROM feedback
WHERE user_id = $1
ORDER BY article_id, updated_at DESC
```

This returns the most-recent value per article_id for the user, deduplicated.
This is the correct behavior and is consistent with AUTH-006's "most-recent-wins"
semantics.

---

## 13. App Startup Sequence Changes

The existing `initFeedback` `useEffect` in `app/page.tsx` is extended to also
call `GET /api/auth/me`. However, the auth check is now handled by `AuthProvider`
(which lives in `layout.tsx` and runs before any page mounts). The page-level
startup sequence is unchanged; auth state comes from `useAuth()` hook.

The change to `app/page.tsx` is:
1. Import `useAuth` from `AuthContext`
2. Pass `user?.userId` to feedback writes as `userId` (via store or direct
   fetch calls)
3. Add `<AccountIcon />` to the header JSX

The `loadFromServer()` call in the existing startup sequence automatically
benefits from the session cookie — when `GET /api/feedback` is called on the
server with a valid `dd_session` cookie, `resolveSession` returns the `userId`
and the server returns the user's cross-device feedback history rather than just
the device history.

---

## 14. New npm Dependencies

| Package | Why |
|---------|-----|
| `bcryptjs` | Password hashing. Pure JS, works in serverless (no native bindings). |
| `@types/bcryptjs` | TypeScript types for bcryptjs. |
| `nodemailer` | SMTP email dispatch for verification and reset emails. |
| `@types/nodemailer` | TypeScript types for nodemailer. |

**Install**:
```
npm install bcryptjs nodemailer
npm install --save-dev @types/bcryptjs @types/nodemailer
```

No ORM. No JWT library. No OAuth library. The `crypto` module is Node.js built-in.

---

## 15. Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEWSAPI_KEY` | NewsAPI adapter | Existing. |
| `CRON_SECRET` | Pipeline trigger | Existing. |
| `DATABASE_URL` | All DB routes | Existing. |
| `SMTP_HOST` | Email sending | e.g. `smtp.mailtrap.io` (dev) or `smtp.postmarkapp.com` (prod) |
| `SMTP_PORT` | Email sending | `587` for TLS/STARTTLS (default); `465` for SSL |
| `SMTP_USER` | Email sending | SMTP username / API token |
| `SMTP_PASS` | Email sending | SMTP password / API token secret |
| `EMAIL_FROM` | Email sending | From address: `"Tangent <noreply@yourdomain.com>"` |
| `NEXTAUTH_URL` | Email link generation | Base URL of the app: `http://localhost:3000` (dev), `https://yourdomain.com` (prod) |

`.env.example` after update:
```
NEWSAPI_KEY=
CRON_SECRET=
DATABASE_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
NEXTAUTH_URL=
```

---

## 16. Deferred Items

| Item | Reason |
|------|--------|
| `useFeedback` hook / React Context | The `AuthContext` now partially fulfills this need for user identity. A dedicated feedback context (for reactive re-render after `loadFromServer`) is still deferred — not needed until personalization changes. |
| Rate limiting on auth endpoints | Deferred until abuse patterns emerge. POST /api/auth/login is the highest-risk endpoint. |
| Account settings page (email change, account deletion) | Explicitly out of scope in BRD-005. |
| Session management UI (list active sessions, remote logout) | Deferred to a future milestone. |
| OAuth / magic link | Explicitly out of scope in BRD-005. |
| Mandatory login enforcement | Out of scope. Architecture must not block it: the `user_id` on feedback, session resolution in routes, and header icon are all already designed with a future gate in mind. |
| Email template system | Volume too low to justify. Plain HTML strings are sufficient. |
| GDPR data export / deletion | No timeline. |
| Removing `localStorage` (dd_feedback) | Still retained as cache/fallback per Milestone 2.5 decision. |
| Database migration tooling | Will be needed in a future milestone when schema complexity grows further. |