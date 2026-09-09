# Upstream Diff — better-auth v1.6.2

This document records every change made on top of the built-in `phone-number`
plugin shipped with **better-auth v1.6.2**.

Upstream source:
```
https://github.com/better-auth/better-auth/tree/v1.6.2/packages/better-auth/src/plugins/phone-number
```

---

## Change legend

| Tag | Meaning |
|-----|---------|
| `[ADDED]` | New code with no upstream counterpart |
| `[CHANGED]` | Existing upstream code that was modified |
| `[REMOVED]` | Upstream code that was deleted |
| `[UNCHANGED]` | Kept exactly as upstream for context |

---

## schema.ts

### `user` table

| Field | Status | Notes |
|-------|--------|-------|
| `phoneNumber` | `[UNCHANGED]` | `unique`, `sortable`, `returned` |
| `phoneNumberVerified` | `[UNCHANGED]` | read-only boolean |
| `countryCode` | `[ADDED]` | Stores the international dial code (e.g. `"91"`, `"1"`) separate from the local phone number. Not declared `unique` here because uniqueness is composite — enforced at the application layer on `(phoneNumber, countryCode)`. See [Known limitations](#known-limitations). |

### `verification` table

| Field | Status | Notes |
|-------|--------|-------|
| `channel` | `[ADDED]` | Records which delivery channel was used for each OTP (e.g. `"SMS"`, `"WHATSAPP"`). `input: true` allows the value to be written during `createVerificationValue`. |

---

## error-codes.ts

| Code | Status |
|------|--------|
| `INVALID_PHONE_NUMBER` | `[UNCHANGED]` |
| `PHONE_NUMBER_EXIST` | `[UNCHANGED]` |
| `PHONE_NUMBER_NOT_EXIST` | `[UNCHANGED]` |
| `INVALID_PHONE_NUMBER_OR_PASSWORD` | `[UNCHANGED]` |
| `UNEXPECTED_ERROR` | `[UNCHANGED]` |
| `OTP_NOT_FOUND` | `[UNCHANGED]` |
| `OTP_EXPIRED` | `[UNCHANGED]` |
| `INVALID_OTP` | `[UNCHANGED]` |
| `PHONE_NUMBER_NOT_VERIFIED` | `[UNCHANGED]` |
| `PHONE_NUMBER_CANNOT_BE_UPDATED` | `[UNCHANGED]` |
| `SEND_OTP_NOT_IMPLEMENTED` | `[UNCHANGED]` |
| `TOO_MANY_ATTEMPTS` | `[UNCHANGED]` |
| `PHONE_NUMBER_COUNTRY_CODE_REQUIRED` | `[ADDED]` — returned when `countryCode` is absent from a request |

---

## types.ts

### `UserWithPhoneNumber`

| Field | Status |
|-------|--------|
| `phoneNumber: string` | `[UNCHANGED]` |
| `phoneNumberVerified: boolean` | `[UNCHANGED]` |
| `countryCode: string` | `[ADDED]` |

### `PhoneNumberOptions`

| Option | Status | Change |
|--------|--------|--------|
| `sendOTP` | `[CHANGED]` | `data` gains `countryCode: string` and `channel?: string` |
| `verifyOTP` | `[CHANGED]` | `data` gains `countryCode: string` and `channel?: string` |
| `sendPasswordResetOTP` | `[CHANGED]` | `data` gains `countryCode: string` and `channel?: string` |
| `phoneNumberValidator` | `[CHANGED]` | Receives `countryCode: string` as second argument |
| `callbackOnVerification` | `[CHANGED]` | `data` gains `countryCode: string` and `channel?: string` |
| `generateOTP` | `[ADDED]` | Custom OTP generation hook — replaces the built-in `generateRandomString` when provided. Receives `{ phoneNumber, countryCode, channel, otpLength }`. Useful for external OTP services, test/demo static codes, or environment-based strategies. |
| `resendStrategy` | `[ADDED]` | `"rotate"` (default) or `"reuse"`. Reuse resends an unused unexpired OTP for the same identifier instead of minting a new one. |
| Request `channel` | `[CHANGED]` | `string \| string[]` on send/sign-in/reset/verify bodies. Plugin fans out `sendOTP` / `sendPasswordResetOTP` once per channel. |
| All other options | `[UNCHANGED]` | `otpLength`, `expiresIn`, `allowedAttempts`, `requireVerification`, `signUpOnVerification`, `schema` |

---

## routes.ts

### Import changes

| Upstream path | This package |
|---|---|
| `from "@better-auth/core/api"` (createAuthEndpoint) | `from "@better-auth/core/api"` |
| `from "../../api"` (getSessionFromCtx) | `from "better-auth/api"` |
| `from "../../cookies"` | `from "better-auth/cookies"` |
| `from "../../crypto/random"` | `from "better-auth/crypto"` |
| `from "../../db"` | `from "better-auth/db"` |
| `from "../../types"` | `from "better-auth"` |
| `from "../../utils/date"` (getDate) | local inline copy, re-exported |
| `APIError` | `from "better-call"` |
| `BASE_ERROR_CODES` | `from "@better-auth/core/error"` |

### New internal helpers

```ts
// Falls back when opts.generateOTP is not provided
function defaultGenerateOTP(size: number): string

// Dispatches to opts.generateOTP or defaultGenerateOTP
async function resolveOTP(opts, data, ctx): Promise<string>

// OTP verification record identifier — scoped to countryCode+phoneNumber
// Upstream used bare phoneNumber, which collides across country codes
function otpIdentifier(countryCode, phoneNumber): string   // e.g. "91-9876543210"
function resetIdentifier(countryCode, phoneNumber): string  // e.g. "91-9876543210-request-password-reset"
```

### `signInPhoneNumber`

| Item | Status | Detail |
|------|--------|--------|
| Body `countryCode` | `[ADDED]` | Required |
| Body `channel` | `[ADDED]` | Optional — used when re-sending OTP to unverified users |
| `phoneNumberValidator` | `[CHANGED]` | Passes `countryCode` as second arg |
| User lookup | `[CHANGED]` | `WHERE phoneNumber = ? AND countryCode = ?` |
| OTP identifier | `[CHANGED]` | Composite `"${countryCode}-${phoneNumber}"` |
| `channel` in verification record | `[ADDED]` | Stored when present |
| `sendOTP` call | `[CHANGED]` | Passes `{ phoneNumber, countryCode, code, channel }` |
| OTP generation | `[CHANGED]` | Uses `resolveOTP()` helper |

### `sendPhoneNumberOTP`

| Item | Status | Detail |
|------|--------|--------|
| Body `countryCode` | `[ADDED]` | Required |
| Body `channel` | `[ADDED]` | Optional |
| `phoneNumberValidator` | `[CHANGED]` | Passes `countryCode` |
| OTP identifier | `[CHANGED]` | Composite via `otpIdentifier()` |
| `channel` in verification record | `[ADDED]` | Stored when present |
| `sendOTP` call | `[CHANGED]` | Passes `{ phoneNumber, countryCode, code, channel }` |
| OTP generation | `[CHANGED]` | Uses `resolveOTP()` helper |
| Background task logic | `[UNCHANGED]` | Upstream v1.6.2 explicit handler check kept verbatim |

### `verifyPhoneNumber`

| Item | Status | Detail |
|------|--------|--------|
| Body `countryCode` | `[ADDED]` | Required |
| Body `channel` | `[ADDED]` | Optional |
| `verifyOTP` call | `[CHANGED]` | Passes `countryCode` and `channel` |
| All OTP lookup / update / delete | `[CHANGED]` | Use composite identifier |
| `updatePhoneNumber` duplicate check | `[CHANGED]` | `WHERE phoneNumber = ? AND countryCode = ?` |
| `updatePhoneNumber` user update | `[CHANGED]` | Also writes `countryCode` |
| Regular user lookup | `[CHANGED]` | `WHERE phoneNumber = ? AND countryCode = ?` |
| `signUpOnVerification` user create | `[CHANGED]` | Stores `countryCode`; `channel` excluded from extra-field passthrough |
| `callbackOnVerification` | `[CHANGED]` | Passes `countryCode` and `channel` |
| `.and(z.record(...))` on body schema | `[UNCHANGED]` | Upstream v1.6.2 — allows extra fields for `signUpOnVerification` |

### `requestPasswordResetPhoneNumber`

| Item | Status | Detail |
|------|--------|--------|
| Body `countryCode` | `[ADDED]` | Required |
| Body `channel` | `[ADDED]` | Optional |
| User lookup | `[CHANGED]` | `WHERE phoneNumber = ? AND countryCode = ?` |
| OTP identifier | `[CHANGED]` | `"${countryCode}-${phoneNumber}-request-password-reset"` via `resetIdentifier()` |
| `channel` in verification record | `[ADDED]` | Stored when present |
| `sendPasswordResetOTP` call | `[CHANGED]` | Passes `countryCode` and `channel` |
| OTP generation | `[CHANGED]` | Uses `resolveOTP()` helper |

### `resetPasswordPhoneNumber`

| Item | Status | Detail |
|------|--------|--------|
| Body `countryCode` | `[ADDED]` | Required |
| OTP lookup / update / delete | `[CHANGED]` | Uses `resetIdentifier(countryCode, phoneNumber)` |
| User lookup | `[CHANGED]` | `WHERE phoneNumber = ? AND countryCode = ?` |
| `onPasswordReset` callback | `[UNCHANGED]` | Upstream v1.6.2 addition |
| Account create-if-missing | `[UNCHANGED]` | Upstream v1.6.2 addition |

---

## index.ts

| Item | Status | Detail |
|------|--------|--------|
| Plugin `id` | `[CHANGED]` | `"phone-number"` → `"better-auth-phone"` |
| `version` field | `[REMOVED]` | `PACKAGE_VERSION` is a monorepo-internal symbol; version lives in `package.json` |
| `BetterAuthPluginRegistry` augmentation | `[REMOVED]` | Reserved for official plugins shipped with better-auth core |
| `/update-user` hook matcher | `[CHANGED]` | Also blocks `countryCode` in addition to `phoneNumber` — both fields form the composite phone identity |
| `rateLimit[0].pathMatcher` | `[CHANGED]` | Also matches `/sign-in/phone-number`; upstream only matched `/phone-number*` |
| `rateLimit[0].window` | `[CHANGED]` | `60` seconds (upstream value) — the rate limiter multiplies by 1000 internally |

---

## client.ts

| Item | Status | Detail |
|------|--------|--------|
| Plugin `id` | `[CHANGED]` | `"phoneNumber"` → `"betterAuthPhone"` |
| `version` field | `[REMOVED]` | Monorepo-internal symbol |
| `$InferServerPlugin` | `[CHANGED]` | Infers from this package's `phoneNumber` export |
| `atomListeners` | `[UNCHANGED]` | Same three paths: `/phone-number/update`, `/phone-number/verify`, `/sign-in/phone-number` |
| `$ERROR_CODES` | `[UNCHANGED]` | Re-exported |

---

## Known limitations

### Composite uniqueness

Better Auth's schema DSL does not support composite unique constraints. The
`phoneNumber` column is declared `unique: true` at the column level. This means
the database will reject two users sharing the same local number even across
different country codes (e.g. US `+1 2025550100` and Canada `+1 2025550100`).

To allow the same local number across country codes, replace the single-column
constraint with a composite index after running the migration:

```sql
-- Remove the single-column constraint generated by better-auth
ALTER TABLE "user" DROP CONSTRAINT "user_phoneNumber_unique";

-- Add composite unique index
CREATE UNIQUE INDEX "user_phone_country_unique" ON "user" ("phoneNumber", "countryCode");
```

### `channel` field type cast

Better Auth's `Verification` type does not expose custom fields generically.
The `channel` field is spread into `createVerificationValue` via a type
assertion. This is safe at runtime — the Prisma and Drizzle adapters accept
additional schema-declared fields. The assertion can be removed once upstream
adds generic support for custom verification fields.
