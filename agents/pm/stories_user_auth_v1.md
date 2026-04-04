# User Stories — User Authentication (Milestone 3)

**Document ID**: stories_user_auth_v1.md
**Date**: 2026-04-04
**Status**: Draft
**Milestone**: 3 — Identity Foundation
**Source BRD**: `agents/ba/brd_user_auth_v1.md` (BRD-005)
**Maintained by**: PM Agent

---

## Overview

These stories deliver the identity layer required for cross-device personalization.
When complete, a user can create an account, verify their email, log in from any
device, and have their full feedback history follow them. Existing anonymous users
are unaffected — device-scoped feedback continues to work exactly as today.

All stories depend on the device identity infrastructure (SFB-001) and server-side
feedback storage (SFB-002 through SFB-010) already shipped in Milestone 2.5.

---

## Open Question Resolutions (PM Decisions)

Two questions were left open in BRD-005. They are resolved here before story writing.

### 1. Session Duration

**Decision**: Sessions use a 30-day sliding window. Activity within the session
resets the expiry clock. There is no distinction between PWA-installed and desktop
browser sessions — both use the same 30-day policy in v1. If usage data later
suggests PWA users should get a longer or indefinite session (since they are on a
dedicated install), that adjustment can be made in a future milestone without any
schema work.

**Rationale**: 30 days is long enough that a daily user is never prompted to log in
again. It is short enough to limit the window of risk from a stolen session cookie.
A sliding window (not a fixed expiry from login time) ensures that any user who
opens the app regularly never hits the expiry.

### 2. Sign-up / Login Entry Point in the UI

**Decision**: A persistent account icon (person icon) appears in the app header on
every page. Tapping it opens a modal or navigates to a dedicated `/auth` page.
The icon shows a different visual state when the user is logged in (filled icon or
a subtle avatar indicator) versus logged out (outline icon). No banners, prompts,
gates, or interstitials block access to the feed or feedback in this milestone.

**Rationale**: A persistent header affordance gives users a discoverable path to
account creation without being coercive. It leaves room for a future milestone to
add a soft prompt (e.g., "Sign in to sync your preferences" after N feedback events)
without conflicting with the current surface. The approach is consistent with the
BRD's requirement that anonymous mode continues to work without interruption.

---

## Dependency Order

```
AUTH-001 (Users + Sessions Schema)
    ├── AUTH-002 (Registration API)
    │       └── AUTH-003 (Email Verification API)
    │               └── AUTH-004 (Login API)
    │                       ├── AUTH-005 (Device→User Feedback Migration on Login)
    │                       ├── AUTH-006 (Cross-Device Feedback Merge on Second Login)
    │                       └── AUTH-008 (Logout API)
    │
    └── AUTH-007 (Password Reset Flow)

AUTH-004 + AUTH-008 → AUTH-009 (Auth UI — Header Icon + Auth Page)
AUTH-009 → AUTH-010 (Session Persistence — Client Integration)
AUTH-004 → AUTH-011 (Anonymous Fallback on Session Expiry)
```

Stories marked **[BLOCKS X]** must be accepted before those stories can begin.

---

## Stories

---

### AUTH-001 — Users, Sessions, and Token Schema

**Priority**: P0
**Blocks**: AUTH-002, AUTH-007, and all stories that follow
**Depends on**: SFB-002 (feedback table with nullable `user_id` column already exists)

**As a** product that needs to identify users across devices,
**I want** a database schema that stores user accounts, active sessions, and
short-lived verification tokens,
**so that** all auth flows have a durable, queryable foundation to build on.

#### Acceptance Criteria

1. A `users` table exists with at minimum: `user_id` (UUID primary key), `email`
   (unique, required), `hashed_password` (required), `created_at` (timestamp),
   and `email_verified_at` (nullable timestamp; null means unverified).
2. A `sessions` table exists with at minimum: `session_id` (UUID primary key),
   `user_id` (foreign key to `users`), `created_at`, `last_active_at`, and
   `expires_at`.
3. A `verification_tokens` table exists with at minimum: `token` (string, unique),
   `user_id` (foreign key to `users`), `purpose` (enum: `'email_verification'` or
   `'password_reset'`), `created_at`, and `expires_at`.
4. Database credentials are stored as environment variables and are never committed
   to the repository.
5. The Architect documents the full DDL and any indexes in their design doc.
6. No existing tables (including `feedback`) are modified by this story.

**Note**: Schema details and DDL are deferred to the Architect. This story defines
the behavioral requirements; the Architect owns the implementation.

---

### AUTH-002 — Registration API

**Priority**: P0
**Blocks**: AUTH-003
**Depends on**: AUTH-001

**As a** new user,
**I want** to create an account with my email address and a password,
**so that** my feedback history can follow me across devices.

#### Acceptance Criteria

1. `POST /api/auth/register` accepts a JSON body with `email` (string) and
   `password` (string).
2. If the email is not already registered, the server creates a user record with
   a securely hashed password and `email_verified_at` set to null.
3. Immediately after creating the user record, the server generates a verification
   token and sends a verification email to the provided address. The verification
   email contains a link the user can click to confirm their address.
4. The endpoint returns 201 on success with a JSON body indicating that a
   verification email has been sent. The response does not include any session
   token — the user cannot log in until their email is verified.
5. If the email is already registered (regardless of verification status), the
   endpoint returns 409 with a generic message. The response must not reveal
   whether the email is registered or not (to prevent enumeration). In practice,
   a message such as "If this address is new, a verification email has been sent"
   is acceptable.
6. Passwords that are fewer than 8 characters return 400 with a validation error.
7. Malformed email addresses (no `@` domain) return 400 with a validation error.
8. Passwords are never stored or logged in plaintext. The hashing algorithm is an
   implementation decision for the Architect (bcrypt or equivalent).
9. The endpoint does not require authentication.

---

### AUTH-003 — Email Verification API

**Priority**: P0
**Blocks**: AUTH-004 (login is not permitted before verification)
**Depends on**: AUTH-002

**As a** newly registered user,
**I want** to confirm my email address by clicking a link in my inbox,
**so that** I can unlock my account and begin logging in.

#### Acceptance Criteria

1. `GET /api/auth/verify-email?token=<token>` accepts a verification token as a
   query parameter.
2. If the token is valid and has not expired, the server sets `email_verified_at`
   to the current timestamp on the corresponding user record and invalidates (deletes)
   the token so it cannot be reused.
3. On success, the response redirects the user to a page or modal that confirms
   verification and invites them to log in (exact routing is an Architect decision).
4. If the token is expired or not found, the response returns a 400 with a human-
   readable message and offers a link or button to request a new verification email.
5. Verification tokens expire after 24 hours.
6. A user who attempts to log in before verifying receives a clear error message
   indicating that their email address has not yet been confirmed, with guidance
   to check their inbox. This behavior is enforced by AUTH-004, not this story.
7. Re-sending a verification email (for users who did not receive or who let the
   token expire) is handled by a dedicated endpoint. The exact surface for requesting
   a resend is an Architect decision; it must exist before AUTH-003 is accepted.

---

### AUTH-004 — Login API

**Priority**: P0
**Blocks**: AUTH-005, AUTH-006, AUTH-008, AUTH-009, AUTH-010, AUTH-011
**Depends on**: AUTH-003 (login is blocked for unverified users)

**As a** registered and verified user,
**I want** to log in with my email and password,
**so that** the server recognizes me and my personalized feed and feedback history
are available on this device.

#### Acceptance Criteria

1. `POST /api/auth/login` accepts a JSON body with `email` and `password`.
2. If the credentials are valid and the email is verified, the server:
   a. Creates a new session record with `expires_at` set to 30 days from now.
   b. Sets a session cookie named `dd_session` with: `HttpOnly`, `Secure` (production
      only), `SameSite=Lax`, and a `Max-Age` of 30 days.
   c. Returns 200 with a JSON body containing the `user_id` and `email`. No session
      token is included in the response body — it travels only in the cookie.
3. If the credentials are invalid (wrong password or unknown email), the endpoint
   returns 401 with a generic error message. The message must not reveal whether the
   email is registered.
4. If the email is registered but not yet verified, the endpoint returns 403 with a
   message directing the user to verify their email.
5. Successful login triggers the device-to-user feedback migration described in
   AUTH-005. This migration runs as part of the same request (or immediately
   after, before returning) and must complete before the 200 response is returned.
6. The `dd_device_id` cookie is preserved and not cleared on login. Both cookies
   coexist on the device.
7. Session activity is refreshed: `last_active_at` is updated on every authenticated
   request and `expires_at` is extended by 30 days from the most recent activity.
8. The endpoint does not require prior authentication.

---

### AUTH-005 — Device-to-User Feedback Migration on First Login

**Priority**: P0
**Blocks**: —
**Depends on**: AUTH-004

**As a** user logging in for the first time on a device that already has anonymous
feedback history,
**I want** my existing feedback to be automatically associated with my account,
**so that** no signal I built up before creating an account is lost.

#### Acceptance Criteria

1. At the moment of successful login, the server reads the `dd_device_id` from the
   request (cookie or `X-Device-ID` header).
2. All feedback records in the `feedback` table where `device_id` matches the
   current device's UUID and `user_id` is null are updated to set `user_id` to the
   authenticated user's `user_id`.
3. The `device_id` values on those records are preserved — they are not nulled or
   overwritten. They serve as an audit trail.
4. If the device has no anonymous feedback records (brand new device with no prior
   history), the migration step is a no-op. No error occurs.
5. After migration, all subsequent feedback writes from this device include both
   `device_id` and `user_id`.
6. The migration is invisible to the user — no loading indicator, toast, or message
   is shown.
7. This migration runs at most once per device-user pairing. If the user logs out
   and logs back in on the same device, any new anonymous feedback accumulated
   while logged out is migrated on the next login (see AUTH-006 for cross-device
   merge behavior; the same "most-recent-wins" conflict resolution applies).

---

### AUTH-006 — Cross-Device Feedback Merge on Login

**Priority**: P0
**Blocks**: —
**Depends on**: AUTH-005

**As a** user logging in on a second device,
**I want** feedback I gave on this device while anonymous to be merged into my account
alongside feedback from my other devices,
**so that** my full signal history is unified under my account no matter which device
I used.

#### Acceptance Criteria

1. When a user authenticates on a device that already has anonymous feedback
   records, AUTH-005 runs as usual: those records are associated with the `user_id`.
2. If the account already has feedback records for articles that the current device
   also has anonymous records for (same `article_id`, different devices), the
   conflict is resolved by keeping the record with the newer `updated_at` timestamp.
   The older record is overwritten. This is called "most-recent-wins."
3. If the device's anonymous record is newer, the device's value overwrites the
   existing account-level record.
4. If the account's existing record is newer, the account record is kept and the
   device's anonymous record is discarded (its `user_id` is set but the `value`
   is not changed to match the device's conflicting value).
5. The resolution is silent — no prompt, banner, or notification is shown to the
   user about any overwritten records.
6. After merge, the device has a unified view: one record per `article_id` reflecting
   the winning value across all devices.
7. Non-conflicting records (articles only rated on one device or identical ratings)
   are merged without any conflict logic applied.

---

### AUTH-007 — Password Reset Flow

**Priority**: P0
**Blocks**: —
**Depends on**: AUTH-001

**As a** user who has forgotten their password,
**I want** to request a reset link by email and choose a new password,
**so that** I can regain access to my account without contacting support.

#### Acceptance Criteria

1. `POST /api/auth/forgot-password` accepts a JSON body with `email`. It always
   returns 200 regardless of whether the email is registered, to prevent enumeration.
   If the email is registered and verified, the server generates a password reset
   token and sends a reset email containing a single-use link.
2. Password reset tokens expire after 1 hour.
3. `POST /api/auth/reset-password` accepts a JSON body with `token` and
   `new_password`. If the token is valid and unexpired, the server:
   a. Updates the user's hashed password.
   b. Invalidates the reset token so it cannot be reused.
   c. Invalidates all existing sessions for that user (forces re-login on all devices).
   d. Returns 200.
4. If the reset token is expired or not found, the endpoint returns 400 with a
   human-readable message.
5. The new password is subject to the same minimum-length validation as registration
   (8 characters minimum). A 400 is returned if the new password is too short.
6. After a successful reset, the user is directed to the login page. They are not
   automatically logged in.
7. The reset flow works for users who have never logged in (i.e., verified their
   email but never established a session).

---

### AUTH-008 — Logout API

**Priority**: P0
**Blocks**: AUTH-009
**Depends on**: AUTH-004

**As a** logged-in user,
**I want** to log out of my account on this device,
**so that** the device returns to anonymous mode and my account is no longer
accessible from this device without logging in again.

#### Acceptance Criteria

1. `POST /api/auth/logout` requires no request body.
2. The server reads the `dd_session` cookie, finds the corresponding session record,
   and deletes it (hard delete — not soft-deleted or flagged as inactive).
3. The server sets the `dd_session` cookie to an expired value to clear it from the
   browser.
4. The `dd_device_id` cookie is preserved. The device retains its anonymous identity.
5. After logout, subsequent feedback writes from this device have `user_id` set to
   null (anonymous mode resumes).
6. The server returns 200 on success. If no valid session is found (already logged
   out, or cookie absent), the endpoint returns 200 anyway — logout is idempotent.
7. The client redirects the user to the feed page after logout. The feed continues
   to function; no content is hidden or gated.

---

### AUTH-009 — Auth UI — Header Icon and Auth Pages

**Priority**: P0
**Blocks**: AUTH-010
**Depends on**: AUTH-004, AUTH-008

**As a** user,
**I want** a persistent, discoverable way to create an account or log in,
**so that** I can access authentication features without needing to know a URL.

#### Acceptance Criteria

1. A person icon (account icon) appears in the app header on every page (feed page
   and article reading view).
2. When the user is **not** logged in, the icon is in its "logged-out" visual state
   (e.g., outline icon). Tapping it navigates to `/auth` or opens a login/register
   modal.
3. When the user **is** logged in, the icon is in its "logged-in" visual state (e.g.,
   filled icon or a subtle indicator). Tapping it reveals a menu with at minimum a
   "Log out" action.
4. The `/auth` page (or equivalent modal) provides access to:
   - A registration form (email + password + confirm password).
   - A login form (email + password).
   - A "Forgot password?" link that initiates the password reset flow (AUTH-007).
   - A way to toggle between registration and login forms without navigating away.
5. Registration form validation:
   - Email field: must contain `@` domain. Inline error shown on blur or submit.
   - Password field: minimum 8 characters. Inline error shown on blur or submit.
   - Confirm password: must match password. Inline error shown on blur or submit.
   - All fields required. Submit disabled until all fields pass validation.
6. After successful registration, the UI shows a confirmation message: "Check your
   email to verify your account." The user is not redirected to the feed; they must
   verify first.
7. After successful login, the user is returned to the page they were on (or to `/`
   if auth was accessed directly). The header icon updates to the logged-in state.
8. After successful logout (triggered from the header menu), the header icon updates
   to the logged-out state. The user remains on the current page.
9. API error responses (401, 403, 409, 400) are surfaced as human-readable inline
   messages adjacent to the relevant form field or at the top of the form. Raw error
   codes are never shown to the user.
10. The auth UI is fully usable on mobile viewport widths (320px minimum). Tap
    targets meet the 44x44px minimum.

---

### AUTH-010 — Session Persistence — Client Integration

**Priority**: P0
**Blocks**: —
**Depends on**: AUTH-009

**As a** logged-in user,
**I want** the app to recognize my session automatically on every visit,
**so that** I do not have to log in each time I open the app.

#### Acceptance Criteria

1. On every app load, the client calls `GET /api/auth/me` (or equivalent session
   check endpoint) to determine whether a valid session exists.
2. If a valid session is returned, the header icon updates to the logged-in state and
   the user's `user_id` is stored in client memory for use by feedback writes.
3. The session check is non-blocking — the feed renders immediately; the auth state
   resolves in the background. No spinner or gate is shown while the session check
   is in flight.
4. If no valid session is found (cookie absent, session expired, or server error), the
   app operates in anonymous mode silently. No error message is shown.
5. While a session is active, every feedback API request (`POST /api/feedback`,
   `DELETE /api/feedback/[articleId]`) includes the session cookie (automatically
   via the browser). The server reads the session to populate the `user_id` on new
   feedback records.
6. When a session expires between visits (the 30-day window elapsed while inactive),
   the next `GET /api/auth/me` call returns a 401 or empty session. The client
   silently transitions to anonymous mode. The user is not shown an error or a
   forced logout message. If they try to access auth-gated functionality, they are
   directed to log in.

---

### AUTH-011 — Anonymous Fallback Remains Fully Functional

**Priority**: P0
**Blocks**: —
**Depends on**: AUTH-004 (system must be live before this story can be verified)

**As a** user who has not created an account,
**I want** the app to work exactly as it does today — no prompts, gates, or
degraded experience,
**so that** I can continue using the daily digest without any obligation to register.

#### Acceptance Criteria

1. A user who has never registered can browse the feed, read articles, and give
   like/dislike feedback on any article without being prompted to log in.
2. All feedback given by an anonymous user is stored server-side under their
   `device_id` with `user_id` null, exactly as it was in Milestone 2.5.
3. No banners, interstitials, overlays, or inline prompts urging the user to sign
   up appear anywhere in the app in this milestone.
4. The account icon in the header is the only visible surface related to auth. It
   does not pulse, badge, or animate to draw attention.
5. The feed, article detail page, feedback buttons, and all existing functionality
   work correctly when no session cookie is present.
6. The anonymous experience is validated by manual test: clear all cookies,
   reload the app, verify that all core flows work with no auth-related errors.

---

## Story Summary Table

| Story ID | Title | Priority | Depends On | Blocks |
|----------|-------|----------|------------|--------|
| AUTH-001 | Users, Sessions, and Token Schema | P0 | SFB-002 | AUTH-002, AUTH-007 |
| AUTH-002 | Registration API | P0 | AUTH-001 | AUTH-003 |
| AUTH-003 | Email Verification API | P0 | AUTH-002 | AUTH-004 |
| AUTH-004 | Login API | P0 | AUTH-003 | AUTH-005, AUTH-006, AUTH-008, AUTH-009 |
| AUTH-005 | Device-to-User Feedback Migration on First Login | P0 | AUTH-004 | — |
| AUTH-006 | Cross-Device Feedback Merge on Login | P0 | AUTH-005 | — |
| AUTH-007 | Password Reset Flow | P0 | AUTH-001 | — |
| AUTH-008 | Logout API | P0 | AUTH-004 | AUTH-009 |
| AUTH-009 | Auth UI — Header Icon and Auth Pages | P0 | AUTH-004, AUTH-008 | AUTH-010 |
| AUTH-010 | Session Persistence — Client Integration | P0 | AUTH-009 | — |
| AUTH-011 | Anonymous Fallback Remains Fully Functional | P0 | AUTH-004 | — |

All eleven stories are P0. Together they form the minimum shippable slice of BRD-005.

---

## Definition of Done (Milestone 3)

All eleven stories are accepted when:

1. A new user can register, verify their email, and log in.
2. A logged-in user's feedback history is visible on a second device immediately
   after login, with no manual sync step.
3. A user who gave feedback as an anonymous device before creating an account does
   not lose any of that history at the moment of first login.
4. Where the same article was rated differently on two devices, the newer rating wins
   silently.
5. A user who forgot their password can reset it via email and regain access.
6. Logging out returns the device to anonymous mode. The feed and feedback continue
   to work.
7. A user who never creates an account sees no change to their experience.

---

## Notes for the Architect

- **Session duration** is 30-day sliding window. See Open Question Resolutions above.
- **Auth entry point** is a persistent header icon + `/auth` page. See Open Question
  Resolutions above.
- The `feedback` table's `user_id` column is already nullable (SFB-002). No schema
  migration is required to the feedback table.
- The session cookie (`dd_session`) and device cookie (`dd_device_id`) must coexist.
  The session cookie must be `HttpOnly`; the device cookie must not be.
- Future milestone direction: login will eventually be required. The identity
  architecture must not create barriers to enforcement (e.g., avoid coupling that
  makes adding a login gate structurally difficult).
- The `GET /api/auth/me` endpoint referenced in AUTH-010 is not explicitly an
  independent story because it is a thin wrapper around session validation and is
  a natural part of the auth API surface. The Architect should include it in the
  design for AUTH-004.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial draft. 11 stories written from BRD-005. Open questions on session duration and UI entry point resolved per PM decisions documented above. |
