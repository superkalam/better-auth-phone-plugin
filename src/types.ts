import type { Awaitable, GenericEndpointContext } from "@better-auth/core";
import type { User } from "better-auth";
import type { InferOptionSchema } from "better-auth/types";
import type { schema } from "./schema";

/**
 * Changes from upstream (better-auth v1.6.2 phone-number plugin):
 *   [ADDED] UserWithPhoneNumber.countryCode
 *   [MODIFIED] PhoneNumberOptions.sendOTP — added countryCode and optional channel
 *   [MODIFIED] PhoneNumberOptions.verifyOTP — added countryCode and optional channel
 *   [MODIFIED] PhoneNumberOptions.sendPasswordResetOTP — added countryCode and optional channel
 *   [MODIFIED] PhoneNumberOptions.phoneNumberValidator — added countryCode parameter
 *   [MODIFIED] PhoneNumberOptions.callbackOnVerification — added countryCode and optional channel
 *   [ADDED]    PhoneNumberOptions.generateOTP — custom OTP generation hook
 *   [ADDED]    PhoneNumberOptions.resendStrategy — "reuse" | "rotate" (default rotate)
 *   [ADDED]    PhoneNumberOptions.defaultChannels — used when request omits channel
 *   [ADDED]    Request `channel` may be string | string[]; plugin fans out sendOTP per channel
 *              and persists one verification row per channel
 */

/** One or more delivery channels. Plugin normalizes and calls sendOTP once per entry. */
export type PhoneOtpChannel = string | string[];

/** Per-channel delivery outcome from send-otp / password-reset OTP fan-out. */
export type PhoneOtpChannelSendResult = {
  channel?: string;
  ok: boolean;
  error?: string;
};

// ── User type ─────────────────────────────────────────────────────────────────

export interface UserWithPhoneNumber extends User {
  phoneNumber: string;
  // [ADDED] Stores the international dial code separately, e.g. "+1", "+91"
  countryCode: string;
  phoneNumberVerified: boolean;
}

// ── Plugin options ────────────────────────────────────────────────────────────

export interface PhoneNumberOptions {
  /**
   * Length of the OTP code.
   * @default 6
   */
  otpLength?: number | undefined;

  /**
   * [ADDED] Custom OTP generation function.
   *
   * When provided, this function is called instead of the built-in
   * `generateRandomString` to produce OTP codes. Useful for:
   * - Integrating with external OTP services (Twilio Verify, AWS SNS, etc.)
   * - Returning static OTPs for test/demo phone numbers
   * - Generating time-based or alphanumeric OTPs
   * - Environment-based logic (different OTP strategy in test vs. production)
   *
   * If not provided, a random numeric string of `otpLength` digits is used.
   *
   * @param data - Phone number, country code, delivery channel, and configured OTP length
   * @param ctx  - The request context
   * @returns    The OTP code string
   *
   * @example
   * ```ts
   * generateOTP: async ({ phoneNumber, countryCode, channel, otpLength }) => {
   *   // Static OTP for test numbers
   *   if (countryCode === "+91" && phoneNumber === "9999999999") {
   *     return "123456";
   *   }
   *   // External service for real numbers
   *   return await myOTPService.generate({ phone: `${countryCode}${phoneNumber}`, channel });
   * }
   * ```
   */
  generateOTP?:
    | ((
        data: {
          phoneNumber: string;
          countryCode: string;
          channel?: PhoneOtpChannel;
          otpLength: number;
        },
        ctx?: GenericEndpointContext,
      ) => Awaitable<string>)
    | undefined;

  /**
   * Send OTP code to the user. **Required.**
   *
   * [MODIFIED vs upstream] `data` now includes `countryCode` and optional `channel`.
   * When the client sends multiple channels, the plugin invokes this once per channel
   * with a single `channel` string each time.
   *
   * @param data.phoneNumber  - Local phone number (without country code)
   * @param data.countryCode  - Dial code, e.g. "+1"
   * @param data.code         - The OTP to deliver
   * @param data.channel      - Delivery method, e.g. "SMS" or "WHATSAPP" (optional)
   */
  sendOTP: (
    data: {
      phoneNumber: string;
      countryCode: string;
      code: string;
      channel?: string;
    },
    ctx?: GenericEndpointContext | undefined,
  ) => Awaitable<void>;

  /**
   * Custom OTP verification function.
   *
   * When provided, this function replaces the internal OTP lookup and comparison.
   * Useful when your SMS provider handles its own OTP state (e.g. Twilio Verify).
   *
   * [MODIFIED vs upstream] `data` now includes `countryCode` and optional `channel`.
   *
   * @returns `true` if the OTP is valid, `false` otherwise
   */
  verifyOTP?:
    | ((
        data: {
          phoneNumber: string;
          countryCode: string;
          code: string;
          channel?: PhoneOtpChannel;
        },
        ctx?: GenericEndpointContext,
      ) => Awaitable<boolean>)
    | undefined;

  /**
   * Callback to send OTP when a user requests a password reset.
   *
   * [MODIFIED vs upstream] `data` now includes `countryCode` and optional `channel`.
   * Multi-channel requests invoke this once per channel (same as `sendOTP`).
   */
  sendPasswordResetOTP?:
    | ((
        data: {
          phoneNumber: string;
          countryCode: string;
          code: string;
          channel?: string;
        },
        ctx?: GenericEndpointContext,
      ) => Awaitable<void>)
    | undefined;

  /**
   * How to handle a resend while a previous OTP is still valid.
   *
   * - `"rotate"` (default) — always mint a new OTP (previous codes stop matching verify,
   *   which only reads the latest verification row).
   * - `"reuse"` — if an unused, unexpired OTP exists for the phone identifier, resend
   *   that same code and refresh `expiresAt` instead of creating a new row.
   *
   * @default "rotate"
   */
  resendStrategy?: "rotate" | "reuse" | undefined;

  /**
   * Channels used when the request omits `channel`.
   * Each entry gets its own verification row and one `sendOTP` invocation.
   *
   * @example `defaultChannels: ["SMS", "WhatsApp"]`
   */
  defaultChannels?: string[] | undefined;

  /**
   * Expiry time of the OTP code in seconds.
   * @default 300
   */
  expiresIn?: number | undefined;

  /**
   * Custom phone number validation function.
   *
   * [MODIFIED vs upstream] Receives `countryCode` as a second argument so
   * validators can apply country-specific rules (e.g. 10 digits for India).
   *
   * Defaults to accepting any non-empty string if not provided.
   */
  phoneNumberValidator?:
    | ((phoneNumber: string, countryCode: string) => Awaitable<boolean>)
    | undefined;

  /**
   * Require phone number verification before allowing sign-in.
   * When `true`, unverified users will receive a new OTP on sign-in attempt.
   * @default false
   */
  requireVerification?: boolean | undefined;

  /**
   * Callback invoked after phone number verification completes successfully.
   *
   * [MODIFIED vs upstream] `data` now includes `countryCode` and optional `channel`.
   */
  callbackOnVerification?:
    | ((
        data: {
          phoneNumber: string;
          countryCode: string;
          channel?: PhoneOtpChannel;
          user: UserWithPhoneNumber;
        },
        ctx?: GenericEndpointContext,
      ) => Awaitable<void>)
    | undefined;

  /**
   * Automatically sign up the user after their first phone verification.
   *
   * A temporary email address is required by Better Auth's user model.
   * You can update the email later via a separate flow.
   */
  signUpOnVerification?:
    | {
        /**
         * Return a temporary email for the new user based on their phone number.
         * Example: `(phone) => \`${phone.replace('+','')}@placeholder.com\``
         */
        getTempEmail: (phoneNumber: string) => string;
        /**
         * Return a temporary display name for the new user.
         * @default phoneNumber
         */
        getTempName?: (phoneNumber: string) => string;
      }
    | undefined;

  /**
   * Custom schema overrides.
   * Allows remapping DB column names via `{ fields: { phoneNumber: "phone" } }`.
   */
  schema?: InferOptionSchema<typeof schema> | undefined;

  /**
   * Maximum number of incorrect OTP attempts before the code is invalidated.
   * @default 3
   */
  allowedAttempts?: number | undefined;

  /**
   * Called after the user is found or created, **before the session is created**.
   *
   * Executes in parallel with `createSession` — both run at the same time so there
   * is no added latency compared to running sequentially. Because it fires before
   * the session exists, do NOT read `ctx` for a session token here; use `user.id`
   * to query any additional data you need.
   *
   * The returned object is attached to the login response under the `additionalData` key,
   * allowing the client to receive any extra data in the same round-trip as the login itself.
   *
   * Only fires on successful logins (`verifyPhoneNumber`, `signInPhoneNumber`).
   * Does not fire on OTP send, password reset, or `disableSession: true` flows.
   *
   * @example
   * ```ts
   * onLoginSuccess: async ({ user, isNewUser }) => {
   *   const profile = await db.profile.findUnique({ where: { userId: user.id } });
   *   return { profile };
   * }
   * // Login response: { token, user, isNewUser, additionalData: { profile: { ... } } }
   * ```
   */
  onLoginSuccess?: (
    data: { user: UserWithPhoneNumber; isNewUser: boolean },
    ctx: GenericEndpointContext,
  ) => Awaitable<Record<string, unknown>>;
}
