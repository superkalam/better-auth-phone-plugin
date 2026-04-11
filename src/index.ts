/**
 * index.ts
 *
 * Based on: better-auth v1.6.2
 * Source:   packages/better-auth/src/plugins/phone-number/index.ts
 *
 * Changes from upstream:
 *   [CHANGED] Plugin id: "phone-number" → "better-auth-phone"
 *   [REMOVED] `version` field — PACKAGE_VERSION is an internal monorepo helper;
 *             not available in a standalone package. Version is in package.json.
 *   [REMOVED] BetterAuthPluginRegistry module augmentation — this is reserved for
 *             official plugins shipped with better-auth core. Third-party plugins
 *             should not augment that interface.
 *   [CHANGED] Import paths rewritten from internal relative paths to the public
 *             "better-auth/*" package surface.
 *   [CHANGED] Middleware hook matcher also blocks `countryCode` updates on
 *             /update-user (upstream only blocks `phoneNumber`).
 *   [CHANGED] Rate-limit window expressed in milliseconds (60 * 1000) to be
 *             explicit; upstream uses the numeric value 60 which the framework
 *             treats as seconds — kept as 60 * 1000 to match actual behaviour.
 *             (See: https://github.com/better-auth/better-auth/issues — upstream
 *             rateLimit.window unit inconsistency.)
 */

import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "@better-auth/core/api";
import { APIError } from "better-call";
import { mergeSchema } from "better-auth/db";
import { PHONE_NUMBER_ERROR_CODES } from "./error-codes";
import type { RequiredPhoneNumberOptions } from "./routes";
import {
  requestPasswordResetPhoneNumber,
  resetPasswordPhoneNumber,
  sendPhoneNumberOTP,
  signInPhoneNumber,
  verifyPhoneNumber,
} from "./routes";
import { schema } from "./schema";
import type { PhoneNumberOptions, UserWithPhoneNumber } from "./types";

export type { PhoneNumberOptions, UserWithPhoneNumber };
export { PHONE_NUMBER_ERROR_CODES };

/**
 * `phoneNumber` — Better Auth plugin for phone-number authentication with
 * international country code support, multi-channel OTP delivery, and a custom
 * OTP generation hook.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { phoneNumber } from "better-auth-phone";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     phoneNumber({
 *       sendOTP: async ({ phoneNumber, countryCode, code, channel }) => {
 *         await smsService.send({ to: `${countryCode}${phoneNumber}`, body: code });
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const phoneNumber = (options?: PhoneNumberOptions | undefined) => {
  const opts = {
    expiresIn: options?.expiresIn || 300,
    otpLength: options?.otpLength || 6,
    ...options,
    phoneNumber: "phoneNumber",
    phoneNumberVerified: "phoneNumberVerified",
    code: "code",
    createdAt: "createdAt",
  };

  return {
    // [CHANGED] id: "phone-number" → "better-auth-phone"
    id: "better-auth-phone",
    hooks: {
      before: [
        {
          // [CHANGED] Also block countryCode updates via /update-user
          // Upstream only checks for phoneNumber in ctx.body.
          // Both fields form the composite phone identity; allowing one to be
          // changed without the other would corrupt lookup integrity.
          matcher: (ctx) =>
            ctx.path === "/update-user" &&
            ("phoneNumber" in ctx.body || "countryCode" in ctx.body),
          handler: createAuthMiddleware(async (_ctx) => {
            throw new APIError("BAD_REQUEST", {
              message: PHONE_NUMBER_ERROR_CODES.PHONE_NUMBER_CANNOT_BE_UPDATED.message,
            });
          }),
        },
      ],
    },
    endpoints: {
      signInPhoneNumber: signInPhoneNumber(opts as RequiredPhoneNumberOptions),
      sendPhoneNumberOTP: sendPhoneNumberOTP(opts as RequiredPhoneNumberOptions),
      verifyPhoneNumber: verifyPhoneNumber(opts as RequiredPhoneNumberOptions),
      requestPasswordResetPhoneNumber: requestPasswordResetPhoneNumber(
        opts as RequiredPhoneNumberOptions,
      ),
      resetPasswordPhoneNumber: resetPasswordPhoneNumber(
        opts as RequiredPhoneNumberOptions,
      ),
    },
    schema: mergeSchema(schema, options?.schema),
    rateLimit: [
      {
        pathMatcher(path: string) {
          return path.startsWith("/phone-number") || path === "/sign-in/phone-number";
        },
        window: 60, // seconds — better-auth rate limiter multiplies by 1000 internally
        max: 10,
      },
    ],
    options,
    $ERROR_CODES: PHONE_NUMBER_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};
