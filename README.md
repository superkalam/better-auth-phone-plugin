# better-auth-phone

A [Better Auth](https://better-auth.com) plugin for phone-number authentication with:

- **International country code support** — `phoneNumber` and `countryCode` stored separately; all queries and OTP identifiers are scoped to the composite `(countryCode, phoneNumber)` pair
- **Multi-channel OTP delivery** — pass `channel: "SMS" | "WHATSAPP"` (or any string) to all OTP endpoints; the channel is stored in the verification record for analytics and routing
- **Custom OTP generation** — `generateOTP` hook to plug in external services, return static test OTPs, or implement TOTP

Based on the built-in `phone-number` plugin from **better-auth v1.6.2**, with the additions listed above. See [UPSTREAM.md](./UPSTREAM.md) for an exact diff.

---

## Installation

```bash
npm install better-auth-phone
# peer dependency
npm install better-auth
```

---

## Server setup

```ts
import { betterAuth } from "better-auth";
import { phoneNumber } from "better-auth-phone";

export const auth = betterAuth({
  database: /* your adapter */,
  plugins: [
    phoneNumber({
      // Required: deliver the OTP to the user
      sendOTP: async ({ phoneNumber, countryCode, code, channel }) => {
        // combine however your SMS provider expects
        const to = `${countryCode}${phoneNumber}`;
        if (channel === "WHATSAPP") {
          await whatsappService.send(to, `Your OTP: ${code}`);
        } else {
          await smsService.send(to, `Your OTP: ${code}`);
        }
      },

      // Optional: custom phone number validation
      phoneNumberValidator: async (phoneNumber, countryCode) => {
        // example: India requires 10 digits
        if (countryCode === "+91") return /^\d{10}$/.test(phoneNumber);
        return phoneNumber.length > 0;
      },

      // Optional: require phone verification before sign-in
      requireVerification: true,

      // Optional: auto-create user on first verification
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone.replace("+", "")}@placeholder.invalid`,
      },

      // Optional: custom OTP generation (e.g. static OTP for test numbers)
      generateOTP: async ({ phoneNumber, countryCode, channel, otpLength }) => {
        if (process.env.NODE_ENV !== "production") {
          return "000000"; // predictable OTP in dev/test
        }
        // use external service
        return await otpService.generate({ phone: `${countryCode}${phoneNumber}`, channel });
      },
    }),
  ],
});
```

---

## Client setup

```ts
import { createAuthClient } from "better-auth/client";
import { phoneNumberClient } from "better-auth-phone/client";

export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});
```

---

## API reference

All endpoints accept `countryCode` (required) in addition to the upstream `phoneNumber`.  
`channel` is optional on all endpoints that send OTPs.

### Send OTP

```ts
await authClient.phoneNumber.sendOtp({
  phoneNumber: "9876543210",
  countryCode: "+91",
  channel: "SMS",        // optional
});
```

### Verify OTP / sign up

```ts
const result = await authClient.phoneNumber.verify({
  phoneNumber: "9876543210",
  countryCode: "+91",
  code: "123456",
  channel: "SMS",        // optional
});
// result.user, result.token, result.status
```

### Sign in with phone number + password

```ts
const result = await authClient.signIn.phoneNumber({
  phoneNumber: "9876543210",
  countryCode: "+91",
  password: "my-password",
  channel: "SMS",        // optional — used only if requireVerification: true and unverified
});
```

### Request password reset

```ts
await authClient.phoneNumber.requestPasswordReset({
  phoneNumber: "9876543210",
  countryCode: "+91",
  channel: "SMS",        // optional
});
```

### Reset password

```ts
await authClient.phoneNumber.resetPassword({
  phoneNumber: "9876543210",
  countryCode: "+91",
  otp: "123456",
  newPassword: "new-secure-password",
});
```

---

## Database migration

Run `better-auth generate` to produce the migration, then apply it.

The migration will add:
- `user.phoneNumber` — varchar, unique
- `user.phoneNumberVerified` — boolean
- `user.countryCode` — varchar
- `verification.channel` — varchar

### Composite uniqueness

Better Auth's schema DSL does not support composite unique constraints. The generated
migration marks `phoneNumber` as unique at the column level. To allow the same local
number in different countries, replace it with a composite index:

```sql
-- Remove the single-column constraint
ALTER TABLE "user" DROP CONSTRAINT "user_phoneNumber_unique";

-- Add composite unique index
CREATE UNIQUE INDEX "user_phone_country_unique" ON "user" ("phoneNumber", "countryCode");
```

---

## Configuration reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sendOTP` | `(data, ctx?) => Promise<void>` | — | **Required.** Deliver the OTP. |
| `otpLength` | `number` | `6` | Length of generated OTP codes. |
| `expiresIn` | `number` | `300` | OTP TTL in seconds. |
| `allowedAttempts` | `number` | `3` | Max wrong OTP attempts before invalidation. |
| `requireVerification` | `boolean` | `false` | Block sign-in for unverified phone numbers. |
| `generateOTP` | `(data, ctx?) => Promise<string>` | built-in random | Custom OTP generation hook. |
| `verifyOTP` | `(data, ctx?) => Promise<boolean>` | internal lookup | Override OTP verification (e.g. Twilio Verify). |
| `sendPasswordResetOTP` | `(data, ctx?) => Promise<void>` | — | Deliver password-reset OTP. |
| `phoneNumberValidator` | `(phone, countryCode) => Promise<boolean>` | accepts any | Validate phone number format. |
| `callbackOnVerification` | `(data, ctx?) => Promise<void>` | — | Called after successful verification. |
| `onLoginSuccess` | `(data, ctx) => Promise<Record<string, unknown>>` | — | Inject additional data into the login response. See below. |
| `signUpOnVerification` | `{ getTempEmail, getTempName? }` | — | Auto-create user on first verification. |
| `schema` | `InferOptionSchema<typeof schema>` | — | Remap DB column names. |

---

## Injecting additional data into the login response (`onLoginSuccess`)

Use `onLoginSuccess` to fetch additional data on the server and return it in the same
login response — eliminating a client round-trip.

**Timing:** the hook is called **before the session is created**, running in parallel
with `createSession`. This means:
- No extra latency — it overlaps with the session write.
- Do **not** read a session token from `ctx` inside this hook; use `user.id` instead.
- Only fires on successful logins (`/phone-number/verify`, `/sign-in/phone-number`).
- Does **not** fire on OTP send, password reset, or when `disableSession: true`.

The returned object is attached to the response under the `additionalData` key.

```ts
phoneNumber({
  sendOTP: async ({ phoneNumber, countryCode, code }) => { /* ... */ },

  onLoginSuccess: async ({ user, isNewUser }) => {
    const profile = await db.profile.findUnique({ where: { userId: user.id } });
    return { profile };
  },
})
```

**Login response shape:**
```json
{
  "status": true,
  "token": "...",
  "user": { "id": "...", "phoneNumber": "...", "..." },
  "isNewUser": false,
  "additionalData": {
    "profile": { "..." }
  }
}
```

**Client access:**
```ts
const result = await authClient.phoneNumber.verify({ phoneNumber, countryCode, code });
const profile = result.data?.additionalData?.profile;
```

---

## Upstream

This plugin is based on the `phone-number` plugin from better-auth v1.6.2.  
See [UPSTREAM.md](./UPSTREAM.md) for a complete diff.
