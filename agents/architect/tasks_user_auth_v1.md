# Dev Task List — User Authentication (Milestone 3)

**ID**: ARCH-TASKS-004
**Design Reference**: `agents/architect/design_user_auth_v1.md`
**Stories Reference**: `agents/pm/stories_user_auth_v1.md`
**Date**: 2026-04-04
**Status**: AUTH-TASK-001 (partial — npm packages installed, .env.example updated; Neon DDL and .env.local pending manual step) through AUTH-TASK-012 complete. AUTH-TASK-013 (ARCHITECTURE.md) already updated by Architect. Pending manual end-to-end verification.

---

## Dependency Order

```
AUTH-TASK-001  (Install dependencies + DDL)
  ├── AUTH-TASK-002  (Auth DB query helpers: lib/db/auth.ts)
  │     ├── AUTH-TASK-003  (Session middleware: lib/auth/session.ts)
  │     │     ├── AUTH-TASK-004  (Register + Verify Email + Resend APIs)
  │     │     │     └── AUTH-TASK-005  (Login API — includes feedback migration)
  │     │     │           ├── AUTH-TASK-007  (Logout API)
  │     │     │           └── AUTH-TASK-009  (Feedback routes: prefer user_id)
  │     │     └── AUTH-TASK-006  (Password Reset flow: forgot + reset APIs)
  │     │
  │     └── AUTH-TASK-009  (Feedback DB helper changes: getFeedbackForUser +
  │                          upsertFeedback with userId + associateFeedbackToUser)
  │
  └── AUTH-TASK-008  (Email module: lib/email/send.ts)
        — AUTH-TASK-004 requires AUTH-TASK-008 for sending emails

AUTH-TASK-005 + AUTH-TASK-007 → AUTH-TASK-010  (Auth Context + AccountIcon)
AUTH-TASK-010 → AUTH-TASK-011  (/auth page — register/login/forgot/reset)
AUTH-TASK-010 + AUTH-TASK-011 → AUTH-TASK-012  (App startup + page.tsx wiring)
AUTH-TASK-012 → AUTH-TASK-013  (Anonymous fallback verification + ARCHITECTURE.md update)
```

Tasks AUTH-TASK-001, AUTH-TASK-002, and AUTH-TASK-008 can begin in parallel.
AUTH-TASK-003 and AUTH-TASK-009 can begin as soon as AUTH-TASK-002 is done.
AUTH-TASK-004 requires AUTH-TASK-003 + AUTH-TASK-008.
AUTH-TASK-005 requires AUTH-TASK-004 + AUTH-TASK-009 (for migration helper).

---

## AUTH-TASK-001 — Install Dependencies and Run DDL

**[BLOCKER — prerequisite for all other tasks]**
**Covers stories**: AUTH-001 (infrastructure)

### What to build

Install `bcryptjs`, `nodemailer`, and their TypeScript type packages. Run the
new table DDL in the Neon SQL console. Update `.env.example`.

### Steps

1. `npm install bcryptjs nodemailer`
2. `npm install --save-dev @types/bcryptjs @types/nodemailer`
3. In the Neon SQL console, run the following DDL:

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id           TEXT        PRIMARY KEY,
  email             TEXT        NOT NULL UNIQUE,
  hashed_password   TEXT        NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose    TEXT        NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS verification_tokens_user_id_idx ON verification_tokens (user_id);
```

4. Add to `.env.local`:
   ```
   SMTP_HOST=smtp.mailtrap.io
   SMTP_PORT=587
   SMTP_USER=<your-mailtrap-user>
   SMTP_PASS=<your-mailtrap-pass>
   EMAIL_FROM=Daily Digest <noreply@dailydigest.local>
   NEXTAUTH_URL=http://localhost:3000
   ```

5. Add to `.env.example` (no values):
   ```
   SMTP_HOST=
   SMTP_PORT=587
   SMTP_USER=
   SMTP_PASS=
   EMAIL_FROM=
   NEXTAUTH_URL=
   ```

### Files to modify

| Action | Path |
|--------|------|
| Auto-modified | `package.json` |
| Modify | `.env.local` |
| Modify | `.env.example` |

### Acceptance criteria

- [ ] `bcryptjs` and `nodemailer` appear in `package.json` dependencies.
- [ ] `@types/bcryptjs` and `@types/nodemailer` appear in `devDependencies`.
- [ ] `users` table exists in Neon with all columns. `users_email_idx` exists.
- [ ] `sessions` table exists in Neon. Both indexes exist.
- [ ] `verification_tokens` table exists in Neon. Index exists.
- [ ] All three tables have the correct FK constraints (`ON DELETE CASCADE`).
- [ ] `SMTP_*`, `EMAIL_FROM`, `NEXTAUTH_URL` added to `.env.local` (not committed).
- [ ] `.env.example` has all six new variables with empty values.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-002 — Auth Database Query Helpers

**[BLOCKER — prerequisite for AUTH-TASK-003, AUTH-TASK-004, AUTH-TASK-005,
AUTH-TASK-006, AUTH-TASK-009]**
**Covers stories**: AUTH-001 (complete)
**Prerequisites**: AUTH-TASK-001

### What to build

Create `lib/db/auth.ts` and `lib/types/auth.ts` with all typed query helpers
for the three new tables.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/types/auth.ts` |
| Create | `lib/db/auth.ts` |

### `lib/types/auth.ts`

```typescript
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

export interface DbToken {
  token: string;
  user_id: string;
  purpose: 'email_verification' | 'password_reset';
  created_at: Date;
  expires_at: Date;
}
```

### `lib/db/auth.ts` — implement all of the following

```typescript
import { sql } from './client';
import type { DbUser, DbSession, DbToken } from '@/lib/types/auth';

// --- Users ---
export async function createUser(
  userId: string,
  email: string,
  hashedPassword: string
): Promise<DbUser>
// INSERT INTO users (user_id, email, hashed_password) VALUES ($1, $2, $3) RETURNING *

export async function getUserByEmail(email: string): Promise<DbUser | null>
// SELECT * FROM users WHERE email = $1 LIMIT 1

export async function getUserById(userId: string): Promise<DbUser | null>
// SELECT * FROM users WHERE user_id = $1 LIMIT 1

export async function setEmailVerified(userId: string): Promise<void>
// UPDATE users SET email_verified_at = NOW() WHERE user_id = $1

export async function updatePassword(userId: string, hashedPassword: string): Promise<void>
// UPDATE users SET hashed_password = $1 WHERE user_id = $2

// --- Sessions ---
export async function createSession(
  sessionId: string,
  userId: string,
  expiresAt: Date
): Promise<DbSession>
// INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING *

export async function getSessionById(sessionId: string): Promise<DbSession | null>
// SELECT * FROM sessions WHERE session_id = $1 AND expires_at > NOW() LIMIT 1
// Returns null if expired or not found

export async function refreshSession(sessionId: string, newExpiresAt: Date): Promise<void>
// UPDATE sessions SET last_active_at = NOW(), expires_at = $1 WHERE session_id = $2

export async function deleteSession(sessionId: string): Promise<void>
// DELETE FROM sessions WHERE session_id = $1

export async function deleteAllSessionsForUser(userId: string): Promise<void>
// DELETE FROM sessions WHERE user_id = $1

// --- Tokens ---
export async function createToken(
  token: string,
  userId: string,
  purpose: 'email_verification' | 'password_reset',
  expiresAt: Date
): Promise<void>
// INSERT INTO verification_tokens (token, user_id, purpose, expires_at) VALUES ($1,$2,$3,$4)

export async function getToken(
  token: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<DbToken | null>
// SELECT * FROM verification_tokens
// WHERE token = $1 AND purpose = $2 AND expires_at > NOW() LIMIT 1

export async function deleteToken(token: string): Promise<void>
// DELETE FROM verification_tokens WHERE token = $1

export async function deleteTokensForUser(
  userId: string,
  purpose: 'email_verification' | 'password_reset'
): Promise<void>
// DELETE FROM verification_tokens WHERE user_id = $1 AND purpose = $2
```

### Acceptance criteria

- [ ] `lib/types/auth.ts` exports `DbUser`, `DbSession`, `DbToken`.
- [ ] `lib/db/auth.ts` exports all 13 helpers with correct signatures.
- [ ] `getUserByEmail` and `getUserById` return `null` (not throw) when row not found.
- [ ] `getSessionById` returns `null` for an expired session (not just missing ones).
- [ ] `getToken` returns `null` for an expired token.
- [ ] No file imports from `react`, `next/navigation`, or any client-side module.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-003 — Session Middleware

**[BLOCKER — prerequisite for AUTH-TASK-004, AUTH-TASK-005, AUTH-TASK-006,
AUTH-TASK-007, AUTH-TASK-009]**
**Covers stories**: AUTH-004 (session infrastructure)
**Prerequisites**: AUTH-TASK-002

### What to build

Create `lib/auth/session.ts` — the shared server-side session resolution utility.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/auth/session.ts` |

### Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, refreshSession } from '@/lib/db/auth';

export const SESSION_COOKIE = 'dd_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  sessionId: string;
  userId: string;
}

export async function resolveSession(
  req: NextRequest,
  res: NextResponse
): Promise<SessionPayload | null>
```

`resolveSession` implementation:
1. Read `dd_session` cookie from `req.cookies`.
2. If absent: return `null`.
3. Call `getSessionById(sessionId)` — if null (expired or not found), return `null`.
4. Compute new expiry: `new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)`.
5. Call `refreshSession(sessionId, newExpiry)` — fire-and-forget (do not await;
   a failed refresh is not worth blocking the request over).
6. Set the refreshed `Set-Cookie` header on `res` using `buildSessionCookie`.
7. Return `{ sessionId, userId: session.user_id }`.

```typescript
export function buildSessionCookie(sessionId: string, maxAge: number): string
// Returns the full cookie string including all attributes.
// Appends '; Secure' only when process.env.NODE_ENV === 'production'.

export function clearSessionCookie(): string
// Returns: "dd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
```

### Acceptance criteria

- [ ] `resolveSession` returns `null` when `dd_session` cookie is absent.
- [ ] `resolveSession` returns `null` when session is not found or expired in DB.
- [ ] `resolveSession` returns `{ sessionId, userId }` for a valid session.
- [ ] `resolveSession` sets a `Set-Cookie` header on the response object for valid sessions.
- [ ] `buildSessionCookie` includes `HttpOnly; SameSite=Lax; Path=/` in all environments.
- [ ] `buildSessionCookie` includes `; Secure` only when `NODE_ENV === 'production'`.
- [ ] `clearSessionCookie` returns a `Max-Age=0` cookie string.
- [ ] Module does not import from `react` or any client-side module.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-004 — Register, Verify Email, and Resend Verification APIs

**Covers stories**: AUTH-002, AUTH-003
**Prerequisites**: AUTH-TASK-002, AUTH-TASK-003, AUTH-TASK-008

### What to build

Three API routes that handle registration and email verification.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/auth/register/route.ts` |
| Create | `app/api/auth/verify-email/route.ts` |
| Create | `app/api/auth/resend-verification/route.ts` |

### `app/api/auth/register/route.ts`

```typescript
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse>
```

Implementation (see design doc §8):
1. Parse body: `{ email, password }`. Return 400 if missing.
2. Validate email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Return 400 if invalid:
   `{ error: "Please enter a valid email address." }`
3. Validate password length ≥ 8. Return 400 if too short:
   `{ error: "Password must be at least 8 characters." }`
4. Normalize: `email.toLowerCase().trim()`.
5. Check `getUserByEmail(email)`. If found: return 201 (anti-enumeration):
   `{ message: "If this address is new, a verification email has been sent." }`
6. `bcrypt.hash(password, 12)`
7. `createUser(crypto.randomUUID(), email, hashedPassword)`
8. `crypto.randomBytes(32).toString('hex')` → verificationToken
9. `createToken(token, userId, 'email_verification', new Date(Date.now() + 24*60*60*1000))`
10. Fire-and-forget: `sendVerificationEmail(email, token).catch(console.error)`
11. Return 201: `{ message: "Verification email sent. Please check your inbox." }`

### `app/api/auth/verify-email/route.ts`

```typescript
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse>
```

1. Read `token` from `req.nextUrl.searchParams.get('token')`.
2. If missing: return 400 `{ error: "Verification token is required." }`.
3. `getToken(token, 'email_verification')` — if null: return 400
   `{ error: "Verification link is invalid or has expired.", resendPath: "/api/auth/resend-verification" }`.
4. `setEmailVerified(dbToken.user_id)`
5. `deleteToken(token)`
6. `return NextResponse.redirect(new URL('/auth?verified=1', req.url))`

### `app/api/auth/resend-verification/route.ts`

```typescript
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse>
```

1. Parse body: `{ email }`. Return 400 if missing.
2. Normalize email.
3. Always return 200 at the end: `{ message: "If that email is unverified, a new link has been sent." }`.
4. `getUserByEmail(email)` — if null or `email_verified_at` is not null: return 200 (silently).
5. `deleteTokensForUser(userId, 'email_verification')` — clean up old tokens.
6. Generate new token, `createToken(token, userId, 'email_verification', new Date(Date.now() + 24*60*60*1000))`.
7. Fire-and-forget: `sendVerificationEmail(email, token).catch(console.error)`.
8. Return 200.

### Acceptance criteria

- [ ] `POST /api/auth/register` with valid new email returns 201.
- [ ] `POST /api/auth/register` with already-registered email returns 201 (anti-enumeration — same message).
- [ ] `POST /api/auth/register` with invalid email returns 400.
- [ ] `POST /api/auth/register` with password < 8 chars returns 400.
- [ ] A `users` row is created with `email_verified_at = null` after successful registration.
- [ ] A `verification_tokens` row with `purpose = 'email_verification'` is created.
- [ ] `GET /api/auth/verify-email?token=<valid>` sets `email_verified_at`, deletes token, redirects to `/auth?verified=1`.
- [ ] `GET /api/auth/verify-email?token=<expired>` returns 400.
- [ ] `GET /api/auth/verify-email?token=<missing>` returns 400.
- [ ] `POST /api/auth/resend-verification` always returns 200.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-005 — Login API (with Feedback Migration)

**[BLOCKER — prerequisite for AUTH-TASK-007, AUTH-TASK-010, AUTH-TASK-012]**
**Covers stories**: AUTH-004, AUTH-005, AUTH-006
**Prerequisites**: AUTH-TASK-003, AUTH-TASK-004 (flow dependency), AUTH-TASK-009
(for `associateFeedbackToUser`)

### What to build

`POST /api/auth/login` — credential verification, session creation, cookie
setting, and device-to-user feedback migration.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/auth/login/route.ts` |

### Implementation

```typescript
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse>
```

1. Parse body: `{ email, password }`. Return 400 if either is missing:
   `{ error: "Email and password are required." }`
2. Normalize email.
3. `getUserByEmail(email)` → if null: return 401 `{ error: "Invalid email or password." }`
4. `bcrypt.compare(password, user.hashed_password)` → if false: same 401.
5. If `user.email_verified_at === null`: return 403
   `{ error: "Please verify your email address before logging in. Check your inbox." }`
6. `sessionId = crypto.randomBytes(32).toString('hex')`
7. `expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)`
8. `createSession(sessionId, user.user_id, expiresAt)`
9. Run migration:
   ```typescript
   const deviceId = extractDeviceId(req); // cookie → X-Device-ID fallback
   if (deviceId) {
     await associateFeedbackToUser(deviceId, user.user_id);
   }
   ```
10. Build response:
    ```typescript
    const res = NextResponse.json(
      { userId: user.user_id, email: user.email },
      { status: 200 }
    );
    res.headers.set('Set-Cookie', buildSessionCookie(sessionId, SESSION_MAX_AGE_SECONDS));
    return res;
    ```

`extractDeviceId` is the same inline helper used in `app/api/feedback/route.ts`
(cookie first, then `X-Device-ID` header). Copy the inline function or extract
to `lib/auth/extract.ts` if preferred.

### Acceptance criteria

- [ ] Valid credentials + verified email → 200 with `{ userId, email }` and `dd_session` cookie.
- [ ] Valid credentials + unverified email → 403 with guidance message.
- [ ] Wrong password → 401 generic message.
- [ ] Unknown email → 401 same generic message.
- [ ] Missing fields → 400.
- [ ] `dd_session` cookie has `HttpOnly`, `SameSite=Lax`, `Max-Age=2592000`, and `Secure` in production.
- [ ] On login, all `feedback` rows for the device's `device_id` where `user_id IS NULL` have `user_id` set to the user's ID.
- [ ] If the device had a conflicting feedback record (same `article_id` already exists under `user_id`), the newer `updated_at` wins.
- [ ] `dd_device_id` cookie is not modified by this endpoint.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-006 — Password Reset Flow

**Covers story**: AUTH-007
**Prerequisites**: AUTH-TASK-002, AUTH-TASK-003, AUTH-TASK-008

### What to build

Two API routes: forgot-password and reset-password.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/auth/forgot-password/route.ts` |
| Create | `app/api/auth/reset-password/route.ts` |

### `app/api/auth/forgot-password/route.ts`

```typescript
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest): Promise<NextResponse>
```

1. Parse body: `{ email }`. Return 400 if missing.
2. Normalize email.
3. Always return 200: `{ message: "If that email is registered, a reset link has been sent." }`
4. `getUserByEmail(email)` — if null or `email_verified_at === null`: return 200 silently.
5. `deleteTokensForUser(userId, 'password_reset')` — clean up.
6. Token = `crypto.randomBytes(32).toString('hex')`
7. `createToken(token, userId, 'password_reset', new Date(Date.now() + 60*60*1000))` — 1 hour
8. Fire-and-forget: `sendPasswordResetEmail(email, token).catch(console.error)`
9. Return 200.

### `app/api/auth/reset-password/route.ts`

```typescript
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest): Promise<NextResponse>
```

1. Parse body: `{ token, new_password }`. Return 400 if either missing.
2. Validate `new_password.length >= 8`. Return 400:
   `{ error: "Password must be at least 8 characters." }`
3. `getToken(token, 'password_reset')` — if null: return 400
   `{ error: "Reset link is invalid or has expired." }`
4. `bcrypt.hash(newPassword, 12)`
5. `updatePassword(dbToken.user_id, hashedPassword)`
6. `deleteToken(token)`
7. `deleteAllSessionsForUser(dbToken.user_id)`
8. Return 200: `{ message: "Password updated. Please log in with your new password." }`

### Acceptance criteria

- [ ] `POST /api/auth/forgot-password` always returns 200.
- [ ] For a registered verified email, a `verification_tokens` row with `purpose='password_reset'` is created with 1h expiry.
- [ ] For an unregistered or unverified email, no token is created (silent no-op).
- [ ] `POST /api/auth/reset-password` with valid token + valid new password: updates hash, deletes token, deletes all user sessions, returns 200.
- [ ] `POST /api/auth/reset-password` with expired/invalid token returns 400.
- [ ] `POST /api/auth/reset-password` with new_password < 8 chars returns 400.
- [ ] After successful reset, old `dd_session` cookies from all devices are invalidated (sessions deleted).
- [ ] Token cannot be reused after successful reset.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-007 — Logout API and GET /api/auth/me

**Covers stories**: AUTH-008, AUTH-004 (me endpoint)
**Prerequisites**: AUTH-TASK-003, AUTH-TASK-005

### What to build

Two thin API routes.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/auth/logout/route.ts` |
| Create | `app/api/auth/me/route.ts` |

### `app/api/auth/logout/route.ts`

```typescript
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest): Promise<NextResponse>
```

1. Read `dd_session` from `req.cookies`.
2. If present: `deleteSession(sessionId).catch(console.error)` — swallow errors.
3. Response:
   ```typescript
   const res = NextResponse.json({ ok: true });
   res.headers.set('Set-Cookie', clearSessionCookie());
   return res;
   ```
   Always 200.

### `app/api/auth/me/route.ts`

```typescript
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest): Promise<NextResponse>
```

1. Create a mutable response: `const res = NextResponse.json({}, { status: 401 })`.
2. `const session = await resolveSession(req, res)`.
3. If null: return 401 `{}`.
4. `getUserById(session.userId)` — if null (user deleted): return 401 `{}`.
5. Replace response: `return NextResponse.json({ userId: user.user_id, email: user.email })`.
   Note: the refreshed `Set-Cookie` header from `resolveSession` must be forwarded.
   Build the final response and set the cookie header from `buildSessionCookie`.

### Implementation note for `/me`

Because `resolveSession` mutates the passed `NextResponse` to set a `Set-Cookie`
header, the pattern is:

```typescript
const cookieRes = new NextResponse(); // scratch response for cookie side-effect
const session = await resolveSession(req, cookieRes);
if (!session) return NextResponse.json({}, { status: 401 });

const user = await getUserById(session.userId);
if (!user) return NextResponse.json({}, { status: 401 });

const finalRes = NextResponse.json({ userId: user.user_id, email: user.email });
// Forward the refreshed cookie
const setCookie = cookieRes.headers.get('Set-Cookie');
if (setCookie) finalRes.headers.set('Set-Cookie', setCookie);
return finalRes;
```

This same pattern applies wherever `resolveSession` is used.

### Acceptance criteria

- [ ] `POST /api/auth/logout` with a valid session: deletes session from DB, returns 200 with clearing `Set-Cookie`.
- [ ] `POST /api/auth/logout` with no session cookie: returns 200 with clearing `Set-Cookie` (idempotent).
- [ ] `POST /api/auth/logout` with an already-deleted session ID: returns 200 (no error).
- [ ] `GET /api/auth/me` with a valid `dd_session` cookie: returns 200 `{ userId, email }` and a refreshed `Set-Cookie`.
- [ ] `GET /api/auth/me` with no cookie: returns 401 `{}`.
- [ ] `GET /api/auth/me` with an expired/invalid session: returns 401 `{}`.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-008 — Email Module

**[BLOCKER — prerequisite for AUTH-TASK-004, AUTH-TASK-006]**
**Covers stories**: AUTH-002, AUTH-003, AUTH-007 (email sending)
**Prerequisites**: AUTH-TASK-001

### What to build

Create `lib/email/send.ts` — the Nodemailer-based email dispatch module.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/email/send.ts` |

### Implementation

```typescript
import nodemailer from 'nodemailer';

// Module-level singleton transporter
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

export async function sendVerificationEmail(to: string, token: string): Promise<void>
// subject: "Verify your Daily Digest email address"
// link: `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}`
// html: <p>Click <a href="${link}">here</a> to verify your email. Link expires in 24 hours.</p>

export async function sendPasswordResetEmail(to: string, token: string): Promise<void>
// subject: "Reset your Daily Digest password"
// link: `${process.env.NEXTAUTH_URL}/auth?reset_token=${token}`
// html: <p>Click <a href="${link}">here</a> to reset your password. Link expires in 1 hour.</p>
```

Email bodies are minimal HTML. No template engine. `EMAIL_FROM` is the sender.

### Acceptance criteria

- [ ] `sendVerificationEmail` calls `sendEmail` with correct subject and a URL
  containing the token pointing to `/api/auth/verify-email?token=`.
- [ ] `sendPasswordResetEmail` calls `sendEmail` with correct subject and a URL
  containing the token pointing to `/auth?reset_token=`.
- [ ] In development (Mailtrap configured), calling either function results in an
  email appearing in the Mailtrap inbox.
- [ ] Module does not import from `react`, `next`, or any client-side module.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-009 — Feedback DB and Route Changes for User Identity

**[BLOCKER — prerequisite for AUTH-TASK-005]**
**Covers stories**: AUTH-005, AUTH-006, AUTH-010 (server reads user feedback)
**Prerequisites**: AUTH-TASK-002

### What to build

Extend `lib/db/feedback.ts` with user-aware helpers and update the feedback API
routes to prefer `user_id` when a session is present.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/db/feedback.ts` |
| Modify | `app/api/feedback/route.ts` |
| Modify | `app/api/feedback/[articleId]/route.ts` |

### New helpers in `lib/db/feedback.ts`

**`getFeedbackForUser`**:
```typescript
export async function getFeedbackForUser(userId: string): Promise<DbFeedbackRow[]>
```
```sql
SELECT DISTINCT ON (article_id) article_id, value, updated_at
FROM feedback
WHERE user_id = $1
ORDER BY article_id, updated_at DESC
```

**`upsertFeedback` signature change** (add optional `userId` parameter):
```typescript
export async function upsertFeedback(
  deviceId: string,
  articleId: string,
  value: 'like' | 'dislike',
  userId?: string | null
): Promise<DbFeedbackRow>
```
```sql
INSERT INTO feedback (device_id, article_id, value, updated_at, user_id)
VALUES ($1, $2, $3, NOW(), $4)
ON CONFLICT (device_id, article_id)
DO UPDATE SET
  value      = EXCLUDED.value,
  updated_at = NOW(),
  user_id    = COALESCE(EXCLUDED.user_id, feedback.user_id)
RETURNING article_id, value, updated_at
```
When `userId` is `null` or `undefined`, pass `null` as `$4`.

**`associateFeedbackToUser`**:
```typescript
export async function associateFeedbackToUser(
  deviceId: string,
  userId: string
): Promise<void>
```

Two sequential SQL statements (must run in order — Step A before Step B):

```sql
-- Step A: most-recent-wins on conflict
UPDATE feedback AS existing
SET
  value      = device.value,
  updated_at = device.updated_at
FROM feedback AS device
WHERE device.device_id = $1
  AND device.user_id IS NULL
  AND existing.user_id = $2
  AND existing.article_id = device.article_id
  AND device.updated_at > existing.updated_at;

-- Step B: claim all remaining unclaimed device rows
UPDATE feedback
SET user_id = $2
WHERE device_id = $1
  AND user_id IS NULL;
```

Execute these as two separate `sql` tagged template calls in sequence (not
`Promise.all`). Step A must complete before Step B runs.

### Changes to `app/api/feedback/route.ts`

In the `GET` handler, after extracting `deviceId`:
```typescript
const cookieRes = new NextResponse();
const session = await resolveSession(req, cookieRes);
const userId = session?.userId ?? null;

let rows: DbFeedbackRow[];
if (userId) {
  rows = await getFeedbackForUser(userId);
} else if (deviceId) {
  rows = await getFeedbackForDevice(deviceId);
} else {
  return NextResponse.json({});
}
```

In the `POST` handler, after extracting `deviceId`:
```typescript
const cookieRes = new NextResponse();
const session = await resolveSession(req, cookieRes);
const userId = session?.userId ?? null;
// ... validation ...
const row = await upsertFeedback(deviceId, articleId, value, userId);
```

Both handlers must forward the refreshed `Set-Cookie` header from `cookieRes`
onto the final response (same pattern as AUTH-TASK-007 `GET /api/auth/me`).

### Changes to `app/api/feedback/[articleId]/route.ts`

In the `DELETE` handler:
```typescript
const cookieRes = new NextResponse();
const session = await resolveSession(req, cookieRes);
const userId = session?.userId ?? null;
// userId is not used for the delete itself (delete by deviceId still),
// but resolveSession refreshes the session sliding window.
```

The delete still operates on `(deviceId, articleId)`. A logged-in user's device
record is deleted; the user's record on another device is not affected.

### Acceptance criteria

- [ ] `getFeedbackForUser` returns deduplicated rows (one per `article_id`), most recent wins.
- [ ] `upsertFeedback` with `userId=null` behaves identically to before (no regression).
- [ ] `upsertFeedback` with `userId` set writes `user_id` to the row.
- [ ] `associateFeedbackToUser` with no anonymous device records is a no-op (no error).
- [ ] `associateFeedbackToUser` claims device rows with `user_id IS NULL`.
- [ ] `associateFeedbackToUser` with a conflicting article_id: the device record's value wins when its `updated_at` is newer; the existing record wins otherwise.
- [ ] `GET /api/feedback` for a logged-in user (valid `dd_session`) returns their cross-device feedback history.
- [ ] `GET /api/feedback` for an anonymous user still returns device-scoped feedback (no regression).
- [ ] `POST /api/feedback` for a logged-in user writes `user_id` onto the new row.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-010 — Auth Context and AccountIcon Component

**Covers stories**: AUTH-009, AUTH-010 (client session hydration)
**Prerequisites**: AUTH-TASK-005, AUTH-TASK-007

### What to build

React context for auth state and the header account icon component.

### Files to create / modify

| Action | Path |
|--------|------|
| Create | `app/components/AuthContext.tsx` |
| Create | `app/components/AccountIcon.tsx` |
| Modify | `app/layout.tsx` — wrap children in `<AuthProvider>` |

### `app/components/AuthContext.tsx`

```typescript
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface AuthUser {
  userId: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setUser: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { userId: string; email: string } | null) => {
        if (data?.userId) setUser({ userId: data.userId, email: data.email });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### `app/components/AccountIcon.tsx`

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AccountIcon(): JSX.Element
```

Behavior:
- `loading=true`: render outline person icon at reduced opacity (`opacity-50`).
- `user=null` (logged out): render outline person icon. `onClick` → `router.push('/auth')`.
- `user` present (logged in): render filled person icon. `onClick` → toggle a
  small dropdown with "Log out" button.
- "Log out" click: `POST /api/auth/logout` → on completion, `setUser(null)`.
- Use SVG icons inline (no icon library dependency). A simple 24×24 person SVG
  with stroke (outline) or fill (logged-in) is sufficient.
- Button wrapper: `className="p-3"` to meet 44×44px tap target minimum.
- `aria-label`: `user ? "Account menu" : "Sign in"`.

### `app/layout.tsx` change

Wrap `{children}` with `<AuthProvider>`:

```typescript
// Import at top:
import { AuthProvider } from './components/AuthContext';

// In RootLayout return:
<body className="min-h-full flex flex-col">
  <ServiceWorkerRegistration />
  <AuthProvider>
    {children}
  </AuthProvider>
</body>
```

### Acceptance criteria

- [ ] `AuthProvider` calls `GET /api/auth/me` on mount. `loading` starts `true` and becomes `false` when the call resolves.
- [ ] If `GET /api/auth/me` returns 200 with `{ userId, email }`, `user` is set.
- [ ] If `GET /api/auth/me` returns 401, `user` remains `null`. No error shown.
- [ ] If `GET /api/auth/me` throws a network error, `user` remains `null`. No error shown.
- [ ] `AccountIcon` shows outline icon when logged out. Tap navigates to `/auth`.
- [ ] `AccountIcon` shows filled icon when logged in. Tap shows "Log out" option.
- [ ] "Log out" calls `POST /api/auth/logout` and clears `user` in context.
- [ ] Tap target for the icon button is ≥ 44×44px on a mobile viewport.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-011 — `/auth` Page

**Covers stories**: AUTH-009 (auth UI), AUTH-007 (reset password UI)
**Prerequisites**: AUTH-TASK-010

### What to build

The `/auth` page at `app/auth/page.tsx` with register, login, forgot-password,
and reset-password views.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/auth/page.tsx` |

### Implementation

```typescript
'use client';

type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-sent';
```

On mount, read query params:
- `?verified=1` → set view to `'login'`, show success banner: "Your email has been
  verified. You can now log in."
- `?reset_token=<token>` → set view to `'reset-password'`, store token in state.
- `?mode=register` → set view to `'register'`.
- Default → set view to `'login'`.

**Register form**:
- Fields: email, password, confirm password
- Client validation on submit (and on blur for each field):
  - Email: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  - Password: length >= 8
  - Confirm: equals password
- Submit disabled until all fields pass validation
- On submit: `POST /api/auth/register`
  - 201 → set view to `'verify-sent'`
  - 400 → show inline field error from `error` property
  - Other → show generic error at top of form

**Login form**:
- Fields: email, password
- On submit: `POST /api/auth/login`
  - 200 → `setUser({ userId, email })`, `router.push(returnTo ?? '/')`
  - 401 → show "Invalid email or password." at top of form
  - 403 → show unverified message + link to request resend
  - 400 → show field error
- `returnTo` is read from `?returnTo=` query param; must be a relative path only
  (validate: starts with `/` and does not start with `//`). Default to `/`.

**Forgot-password form**:
- Field: email
- On submit: `POST /api/auth/forgot-password`
- Always show: "If that email is registered, a reset link has been sent."

**Reset-password form** (shown when `?reset_token` is present):
- Fields: new password, confirm password
- Client validation: length >= 8, must match
- On submit: `POST /api/auth/reset-password` with `{ token: resetToken, new_password }`
  - 200 → show success banner "Password updated.", switch to login view
  - 400 → show error from response body
- `token` comes from the `?reset_token` query param stored in local state.

**Toggle links**:
- On register view: "Already have an account? Sign in" → switch to login view
- On login view: "No account? Register" → switch to register view
- On login view: "Forgot password?" → switch to forgot-password view
- On forgot-password view: "Back to sign in" → switch to login view

**verify-sent view**:
- Show: "Check your email to verify your account. The link expires in 24 hours."
- Show a "Resend email" button that calls `POST /api/auth/resend-verification`
  with the registered email.
- After resend: show "A new link has been sent."

**Layout**: Centered card, max-w-sm, consistent with existing app styling
(white background, gray-50 page background, `font-geist-sans`). Mobile-first.

### Acceptance criteria

- [ ] Navigating to `/auth` shows the login form by default.
- [ ] `/auth?mode=register` shows the register form.
- [ ] `/auth?verified=1` shows a verified banner and the login form.
- [ ] `/auth?reset_token=<token>` shows the new-password form.
- [ ] Register form submit disabled until all validation passes.
- [ ] Inline errors appear on blur and on submit for each field.
- [ ] After successful registration, view changes to `verify-sent`.
- [ ] After successful login, user is redirected to `/` (or `returnTo` if safe).
- [ ] After successful password reset, view changes to login with success banner.
- [ ] Toggle links switch between views without page navigation.
- [ ] All tap targets are ≥ 44×44px on 320px viewport.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-012 — App Startup and Feed Page Integration

**Covers stories**: AUTH-010, AUTH-011 (anonymous fallback verification)
**Prerequisites**: AUTH-TASK-010, AUTH-TASK-011

### What to build

Add `AccountIcon` to the feed page and article page headers. Ensure `user_id`
from auth context flows into feedback writes. Verify anonymous path is unbroken.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/page.tsx` |
| Modify | `app/articles/[id]/page.tsx` |

### `app/page.tsx` changes

1. Import `AccountIcon` from `./components/AccountIcon`.
2. Update the header JSX to add the icon on the right:
   ```typescript
   <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
     <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
       <h1 className="text-xl font-bold text-gray-900 tracking-tight">Daily Digest</h1>
       <AccountIcon />
     </div>
   </header>
   ```
3. No changes to the existing `initFeedback` useEffect — the `GET /api/auth/me`
   call is handled by `AuthProvider` in `layout.tsx`. The feedback routes now
   automatically receive the `dd_session` cookie and resolve `user_id` server-side.
4. No changes to `setFeedback`/`clearFeedback` call sites in `FeedbackButtons`.
   The server handles `user_id` resolution from the session cookie; the client
   does not need to pass `userId` explicitly.

### `app/articles/[id]/page.tsx` changes

Read the current article page to see the header structure, then add `AccountIcon`
in the same position as the feed page header.

### Acceptance criteria

- [ ] `AccountIcon` appears in the feed page header, right-aligned.
- [ ] `AccountIcon` appears in the article reading view header, right-aligned.
- [ ] Logged-out user: outline icon, tap goes to `/auth`. Feed and feedback work.
- [ ] Logged-in user: filled icon, tap shows logout. Feedback writes include `user_id`.
- [ ] After logout from the header: icon reverts to outline, feed still works.
- [ ] Clearing all cookies and reloading the app: feed loads, feedback works, no auth errors in console.
- [ ] `npx tsc --noEmit` passes.

---

## AUTH-TASK-013 — Update ARCHITECTURE.md

**Covers**: Documentation update
**Prerequisites**: All previous tasks

### What to build

Update `agents/architect/ARCHITECTURE.md` with Milestone 3 additions.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `agents/architect/ARCHITECTURE.md` |

### Changes required

1. **API Routes table** — add seven new rows:
   - `POST /api/auth/register` — Create user account | None
   - `GET /api/auth/verify-email` — Verify email via token | None
   - `POST /api/auth/resend-verification` — Resend verification email | None
   - `POST /api/auth/login` — Create session | None
   - `POST /api/auth/logout` — Invalidate session | `dd_session` cookie
   - `GET /api/auth/me` — Return current session user | `dd_session` cookie
   - `POST /api/auth/forgot-password` — Send password reset email | None
   - `POST /api/auth/reset-password` — Reset password, invalidate sessions | None

2. **Environment Variables table** — add six new rows:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — Email sending (Nodemailer SMTP)
   - `EMAIL_FROM` — From address for transactional emails
   - `NEXTAUTH_URL` — Base URL for email link generation

3. **Design Documents table** — add one row:
   - Milestone 3 — Identity Foundation | `agents/architect/design_user_auth_v1.md` | `agents/architect/tasks_user_auth_v1.md`

4. **What Has Been Built table** — add 13 rows (all "Not started"):
   - Auth DDL (`users`, `sessions`, `verification_tokens` tables) | Not started | AUTH-TASK-001
   - Auth DB helpers (`lib/db/auth.ts`, `lib/types/auth.ts`) | Not started | AUTH-TASK-002
   - Session middleware (`lib/auth/session.ts`) | Not started | AUTH-TASK-003
   - Register + Verify Email APIs | Not started | AUTH-TASK-004
   - Login API with feedback migration | Not started | AUTH-TASK-005
   - Password Reset APIs | Not started | AUTH-TASK-006
   - Logout + Me APIs | Not started | AUTH-TASK-007
   - Email module (`lib/email/send.ts`) | Not started | AUTH-TASK-008
   - Feedback DB/route changes for user identity | Not started | AUTH-TASK-009
   - Auth Context + AccountIcon component | Not started | AUTH-TASK-010
   - `/auth` page (register/login/forgot/reset) | Not started | AUTH-TASK-011
   - Feed page and article page header integration | Not started | AUTH-TASK-012
   - ARCHITECTURE.md update | Not started | AUTH-TASK-013

5. **Status line** — update to: `Status: Active — Milestone 3 in progress`

6. **Changelog** — add entry:
   ```
   | 2026-04-04 | Architect Agent | Milestone 3 design complete. Added auth tables, session middleware, 8 new API routes, auth UI, and AccountIcon. Added SMTP env vars and NEXTAUTH_URL. |
   ```

### Acceptance criteria

- [ ] API Routes table has all 8 new auth routes.
- [ ] Environment Variables table has `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `NEXTAUTH_URL`.
- [ ] Design Documents table has Milestone 3 row.
- [ ] What Has Been Built table has 13 new rows, all "Not started".
- [ ] Changelog has the 2026-04-04 Milestone 3 entry.

---

## Task Summary

| Task | Stories | Depends On | Creates | Modifies |
|------|---------|------------|---------|----------|
| AUTH-TASK-001 | AUTH-001 | — | — | `package.json`, `.env.*` |
| AUTH-TASK-002 | AUTH-001 | 001 | `lib/db/auth.ts`, `lib/types/auth.ts` | — |
| AUTH-TASK-003 | AUTH-004 | 002 | `lib/auth/session.ts` | — |
| AUTH-TASK-004 | AUTH-002, AUTH-003 | 002, 003, 008 | `app/api/auth/register/route.ts`, `verify-email/route.ts`, `resend-verification/route.ts` | — |
| AUTH-TASK-005 | AUTH-004, AUTH-005, AUTH-006 | 003, 004, 009 | `app/api/auth/login/route.ts` | — |
| AUTH-TASK-006 | AUTH-007 | 002, 003, 008 | `app/api/auth/forgot-password/route.ts`, `reset-password/route.ts` | — |
| AUTH-TASK-007 | AUTH-008 | 003, 005 | `app/api/auth/logout/route.ts`, `me/route.ts` | — |
| AUTH-TASK-008 | AUTH-002, AUTH-003, AUTH-007 | 001 | `lib/email/send.ts` | — |
| AUTH-TASK-009 | AUTH-005, AUTH-006, AUTH-010 | 002 | — | `lib/db/feedback.ts`, `app/api/feedback/route.ts`, `app/api/feedback/[articleId]/route.ts` |
| AUTH-TASK-010 | AUTH-009, AUTH-010 | 005, 007 | `app/components/AuthContext.tsx`, `app/components/AccountIcon.tsx` | `app/layout.tsx` |
| AUTH-TASK-011 | AUTH-009 | 010 | `app/auth/page.tsx` | — |
| AUTH-TASK-012 | AUTH-010, AUTH-011 | 010, 011 | — | `app/page.tsx`, `app/articles/[id]/page.tsx` |
| AUTH-TASK-013 | — | All | — | `agents/architect/ARCHITECTURE.md` |