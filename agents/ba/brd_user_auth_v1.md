# BRD-005: User Accounts and Authentication

| Field | Value |
|-------|-------|
| **ID** | BRD-005 |
| **Title** | User Accounts and Authentication |
| **Date** | 2026-04-04 |
| **Status** | Ready for PM |
| **Milestone** | Milestone 3.5 — Identity Foundation |
| **Depends On** | BRD-003 (server-side feedback storage with `user_id` column, shipped) |
| **Required By** | BRD-004 (cross-device personalization cannot ship without this) |

---

## Problem Statement

All feedback and personalization data is currently tied to a device ID — an anonymous
UUID that lives in a browser cookie and localStorage. This works on a single device,
but it means a user's preferences are invisible the moment they switch to a different
phone, reinstall the app, or clear their browser. The signal they have built up by
rating articles is stranded on one device.

The product owner has clarified that personalization must follow the user, not the
device. A user should be able to log into any device and immediately see their
personalized feed with their full feedback history intact.

This requires a real identity layer: a user account that can be authenticated across
devices, with feedback history associated to the user rather than to any individual
device.

This BRD defines the account creation and login experience, the transition from
anonymous device identity to authenticated user identity, and how existing
device-level feedback is migrated to the user account at login time.

---

## Goals

- A user can create an account and log in using email and password.
- Once logged in, the user's personalized feed and feedback history follow them to
  any device where they sign in.
- Logging in on a new device automatically pulls in the user's existing feedback
  history — no manual sync step.
- A user who has given feedback as an anonymous device (before creating an account)
  does not lose that history when they log in for the first time. Their existing
  device-level feedback is associated with their new account.
- Users who have not yet created an account continue to get the same anonymous,
  device-scoped experience they have today. No degradation for non-registered users
  in the current milestone.
- The existing `user_id` column in the feedback table (currently nullable) is
  populated for all records once a user authenticates. No schema migration is
  required.
- Logging out on a device returns that device to anonymous mode. Feedback given after
  logout is scoped to the device again.
- Sessions persist for a reasonable period so users are not repeatedly prompted to
  log in on their primary devices.
- A user who forgets their password can recover access via a password reset flow.

---

## Non-Goals

The following are explicitly out of scope for this BRD:

- **Social features.** No profiles, follower relationships, shared feeds, or any
  public-facing identity.
- **User-facing account management.** No settings page, no email change flow. Password
  reset is in scope (see Decisions); other account management is deferred.
- **Multiple accounts on one device.** A device is associated with at most one
  authenticated user at a time.
- **Account deletion or data export.** User-facing data management tools are deferred.
- **Admin or operator accounts.** No role-based access control. All accounts are
  end-user accounts.
- **Feed personalization logic changes.** This BRD only establishes identity
  plumbing. The scoring and ranking model is defined in BRD-004 and is unchanged here.
- **Access control on existing API routes.** Existing public routes (`GET /api/feed/today`,
  `GET /api/articles/[id]`, `POST /api/pipeline/run`) are unaffected. Only the
  feedback routes gain awareness of authenticated identity.
- **Mandatory login enforcement.** The mechanism for eventually requiring login
  (grace periods, hard gates, prompts) is deferred to a future milestone. See
  Long-Term Direction below.
- **OAuth or magic link authentication.** These are not in scope for this milestone.
  Email + password is the chosen method.

---

## Decisions

The following questions have been answered by the product owner and are recorded
here as resolved decisions. They are no longer open.

### Authentication Method: Email + Password (Option A)

Email and password authentication has been selected. Users register with an email
address and a password and log in the same way.

- Password reset is **in scope** for this milestone. A user who cannot remember
  their password must have a way to recover access. A permanently locked-out user
  is not an acceptable outcome.
- Email verification is **required before login is permitted**. A newly registered
  user must confirm their email address before they can log in. This prevents
  registration under email addresses the user does not own, and it ensures the
  password reset flow has a valid delivery address. The verification step adds minor
  friction at registration but is the correct default policy for this product.

### Conflict Resolution on Device Merge: Most Recent Wins

When a user logs in on a second device and both devices have feedback on the same
article that disagrees (e.g., liked on Device A, disliked on Device B), the record
with the newer `updated_at` timestamp is the authoritative signal. The older record
is overwritten. This applies at merge time (i.e., when the second device's feedback
is being associated with the user account). The resolution is silent — no prompt or
notification is shown to the user.

---

## Long-Term Direction: Login Will Eventually Be Required

The anonymous, device-scoped experience is a transitional state, not a permanent
product tier. The product direction is that login will eventually become mandatory
for users who want to retain their preferences.

What this means for this BRD:

- The anonymous experience works today and is not broken by this milestone.
- The system must be designed with the knowledge that login will become mandatory in
  a future milestone. No architectural decisions should create barriers to enforcement.
- The specific enforcement mechanism — grace period, hard gate, interstitial prompt,
  date-based cutoff — is **not defined here** and is explicitly deferred to a future
  BRD.

This direction should inform how the PM frames user stories and how the Architect
designs the identity layer, even though no enforcement work ships in this milestone.

---

## Authentication Method

Email and password has been selected. See Decisions above.

The Architect will translate this into a concrete implementation. The downstream
data model and migration logic described in this BRD are independent of the auth
method and do not change.

---

## Identity Transition at Login

### Before login: device identity

An unauthenticated user is identified by their `dd_device_id` cookie and localStorage
value. Feedback records in the database have a populated `device_id` and a null
`user_id`. This is the current state of all existing users.

### At the moment of login

When a user successfully authenticates for the first time on a device:

1. The server resolves or creates the user account and generates a session.
2. The server looks up all feedback records associated with the current `device_id`.
3. Those records are associated with the `user_id` by writing the `user_id` value
   into the previously-null column. The `device_id` value on those records is
   preserved — it remains as an audit trail.
4. From this point forward, new feedback writes from this device include both the
   `device_id` and the `user_id`.

### On subsequent logins on the same device

No migration step. The user's account and feedback history are already associated.
The session is refreshed; the experience continues normally.

### Logging in on a second device

When a user logs into their account on a second (new) device:

1. The second device has its own `device_id` and possibly its own independent
   feedback history accumulated while anonymous.
2. On login, the server looks up feedback records for the second device's `device_id`.
3. Those records are also associated with the `user_id`. The user now has a unified
   feedback history spanning both devices, with no signal lost.
4. Where the same article was rated differently on the two devices, the conflict is
   resolved by keeping the record with the newer `updated_at` timestamp. See
   Decisions above.

### After logout

When a user logs out of a device:

1. The session token is invalidated server-side.
2. The device reverts to anonymous mode using its existing `dd_device_id`.
3. Feedback given after logout is scoped to the device only (`user_id` is null on
   new writes).
4. The user's account-level feedback history is not affected — it remains intact
   and will be available again when the user logs back in.

---

## Session Management

Session duration is an open question (see Open Questions). The behavioral
requirements are:

- A session must persist long enough that users are not asked to log in repeatedly
  on their primary device. A minimum of 30 days of inactivity before expiry is a
  suggested starting point.
- Sessions are stored server-side (not solely in a client-side cookie) so that they
  can be invalidated on logout without requiring the client to cooperate.
- A session token is transmitted via a secure, `HttpOnly` cookie so it cannot be
  accessed by client-side JavaScript. This is a different cookie from `dd_device_id`,
  which must remain readable by JavaScript.
- If a session expires, the user is returned to anonymous mode on that device rather
  than shown an error. Their device-level `dd_device_id` continues to function.
  The next time they interact with auth-gated functionality, they are prompted to
  log in again.

---

## Anonymous Mode Must Continue to Work

Users who have not yet created an account must continue to receive a fully functional
experience in this milestone:

- Device-scoped feedback works exactly as it does today.
- Feed personalization (BRD-004) applies to their device history.
- No prompts, banners, or sign-up gates block access to the feed or feedback.
- The only thing missing for anonymous users is cross-device continuity.

Note: this is a transitional state. See Long-Term Direction above.

Optional, non-blocking surfaces (e.g., a subtle "Sign in to sync your preferences"
prompt) are out of scope for this BRD but may be considered in a future UI milestone.

---

## Database Impact

The `user_id` column already exists in the feedback table as a nullable field,
established in BRD-003 specifically to support this future capability. No schema
migration is required to the feedback table.

New infrastructure required (schema details deferred to Architect):

- A **users table** containing at minimum: `user_id` (primary key), `email`,
  `created_at`, `email_verified_at`, and a hashed password field.
- A **sessions table** (or equivalent token store) for server-side session validation.
- An **email verification token store** (may be a table or a short-lived token
  mechanism) to support the verification flow at registration and the password
  reset flow.

The Architect will define the full DDL.

---

## User Impact

**Users who create an account**: Their feed and feedback history become portable.
Switching devices, reinstalling the app, or using the web version on a new browser
all result in an immediately personalized experience. No setup required beyond
logging in.

**Users who remain anonymous**: No change to their current experience in this
milestone. Device-scoped personalization continues to work as designed in BRD-004.
This is a transitional state; login will eventually be required in a future milestone.

**Existing anonymous users who later create an account**: Their full feedback history
— accumulated before account creation — is automatically associated with their new
account at the moment of first login. No signal is lost; the personalization engine
picks up where it left off.

---

## Open Questions

The following questions remain unanswered and should be resolved before or during
PM story writing. They are not blocking enough to hold this BRD from the PM, but
the PM and Architect should flag them as dependencies on specific stories.

1. **Session duration.** How long should a session remain valid before the user must
   log in again? A 30-day sliding window (session refreshed on activity) is a
   reasonable default, but the product owner should confirm. Should sessions expire
   differently on mobile (PWA-installed) vs. desktop browser?

2. **Sign-up entry point in the UI.** Where does the user encounter the option to
   create an account or log in? This BRD intentionally defers UI placement decisions,
   but the PM will need to designate a surface (e.g., a header icon, a settings
   screen, a one-time prompt) when writing user stories.

---

## Related Documents

| Document | Location |
|----------|----------|
| BRD-003 — Server-Side Feedback Storage | `agents/ba/requirements_server_feedback_v1.md` |
| BRD-004 — Feed Personalization | `agents/ba/brd_feed_personalization_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Feedback table schema (for `user_id` column) | `agents/architect/design_server_feedback_v1.md` |
