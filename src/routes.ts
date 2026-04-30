/**
 * routes.ts
 *
 * Based on: better-auth v1.6.2
 * Source:   packages/better-auth/src/plugins/phone-number/routes.ts
 *
 * Changes from upstream — summary:
 *   All five endpoints updated for country-code support, channel tracking, and
 *   custom OTP generation. Detailed change markers are inline (see [CHANGED]).
 *   The function `generateOTP` is renamed to `defaultGenerateOTP` and is now
 *   only used as a fallback when `opts.generateOTP` is not provided.
 *
 *   Internal imports rewritten to use the public `better-auth` package surface
 *   instead of relative paths inside the monorepo.
 */

import { createAuthEndpoint } from "@better-auth/core/api";
import { APIError } from "better-call";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import * as z from "zod";
import { getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { parseUserInput, parseUserOutput } from "better-auth/db";
import type { Account } from "better-auth";
import { PHONE_NUMBER_ERROR_CODES } from "./error-codes";
import type { PhoneNumberOptions, UserWithPhoneNumber } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

export type RequiredPhoneNumberOptions = PhoneNumberOptions & {
  expiresIn: number;
  otpLength: number;
  phoneNumber: string;
  phoneNumberVerified: string;
  code: string;
  createdAt: string;
};

/**
 * [CHANGED] Renamed from `generateOTP` to `defaultGenerateOTP`.
 * Used only when `opts.generateOTP` is not provided.
 */
function defaultGenerateOTP(size: number): string {
  return generateRandomString(size, "0-9");
}

/**
 * [ADDED] Resolves the OTP code: uses the custom hook if provided, else falls
 * back to the built-in random generator.
 */
async function resolveOTP(
  opts: RequiredPhoneNumberOptions,
  data: {
    phoneNumber: string;
    countryCode: string;
    channel?: string;
  },
  ctx: Parameters<typeof createAuthEndpoint>[2] extends infer C ? C : never,
): Promise<string> {
  if (opts.generateOTP) {
    return opts.generateOTP(
      {
        phoneNumber: data.phoneNumber,
        countryCode: data.countryCode,
        channel: data.channel,
        otpLength: opts.otpLength,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx as any,
    );
  }
  return defaultGenerateOTP(opts.otpLength);
}

/**
 * [ADDED] Builds the verification identifier, scoped to countryCode + phoneNumber.
 * Upstream used bare phoneNumber; this prevents collisions across country codes.
 */
function otpIdentifier(countryCode: string, phoneNumber: string): string {
  return `${countryCode}-${phoneNumber}`;
}

/**
 * [ADDED] Builds the password-reset verification identifier.
 */
function resetIdentifier(countryCode: string, phoneNumber: string): string {
  return `${countryCode}-${phoneNumber}-request-password-reset`;
}

// ── Endpoint: signInPhoneNumber ───────────────────────────────────────────────

// [CHANGED] Added `countryCode` (required) and `channel` (optional) to body schema
const signInPhoneNumberBodySchema = z.object({
  phoneNumber: z.string().meta({
    description: 'Local phone number without country code. Eg: "9876543210"',
  }),
  // [ADDED]
  countryCode: z.string().meta({
    description: 'International dial code. Eg: "+1", "+91"',
  }),
  password: z.string().meta({
    description: "Password to use for sign in.",
  }),
  // [ADDED] — only used when requireVerification is true and the user is unverified
  channel: z
    .string()
    .optional()
    .meta({
      description: 'OTP delivery channel when re-sending. Eg: "SMS" or "WHATSAPP"',
    }),
  rememberMe: z
    .boolean()
    .meta({ description: "Remember the session. Eg: true" })
    .optional(),
});

/**
 * POST `/sign-in/phone-number`
 *
 * server: `auth.api.signInPhoneNumber`
 * client: `authClient.signIn.phoneNumber`
 */
export const signInPhoneNumber = (opts: RequiredPhoneNumberOptions) =>
  createAuthEndpoint(
    "/sign-in/phone-number",
    {
      method: "POST",
      body: signInPhoneNumberBodySchema,
      metadata: {
        openapi: {
          summary: "Sign in with phone number",
          description: "Use this endpoint to sign in with phone number",
          responses: {
            200: {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: { $ref: "#/components/schemas/User" },
                      session: { $ref: "#/components/schemas/Session" },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid phone number or password" },
          },
        },
      },
    },
    async (ctx) => {
      // [CHANGED] Destructure countryCode and channel in addition to upstream fields
      const { password, phoneNumber, countryCode, channel } = ctx.body;

      if (opts.phoneNumberValidator) {
        // [CHANGED] Pass countryCode to validator (upstream only passes phoneNumber)
        const isValidNumber = await opts.phoneNumberValidator(
          phoneNumber,
          countryCode,
        );
        if (!isValidNumber) {
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.INVALID_PHONE_NUMBER.message });
        }
      }

      // [CHANGED] Query user by phoneNumber AND countryCode (upstream: phoneNumber only)
      const user = await ctx.context.adapter.findOne<UserWithPhoneNumber>({
        model: "user",
        where: [
          { field: "phoneNumber", value: phoneNumber },
          { field: "countryCode", value: countryCode },
        ],
      });
      if (!user) {
        throw new APIError("UNAUTHORIZED", { message: PHONE_NUMBER_ERROR_CODES.INVALID_PHONE_NUMBER_OR_PASSWORD.message });
      }

      if (opts.requireVerification) {
        if (!user.phoneNumberVerified) {
          // [CHANGED] Use resolveOTP helper instead of plain generateOTP
          const otp = await resolveOTP(opts, { phoneNumber, countryCode, channel }, ctx);
          // [CHANGED] OTP identifier includes countryCode; channel stored in record
          await ctx.context.internalAdapter.createVerificationValue({
            value: otp,
            identifier: otpIdentifier(countryCode, phoneNumber),
            expiresAt: getDate(opts.expiresIn, "sec"),
            // channel is stored via schema extension; cast needed because
            // Better Auth's Verification type doesn't yet support extra fields
            // (upstream TODO: generics for verification custom fields)
            ...(channel ? { channel } : {}),
          } as Parameters<typeof ctx.context.internalAdapter.createVerificationValue>[0]);

          if (opts.sendOTP) {
            await ctx.context.runInBackgroundOrAwait(
              // [CHANGED] Pass countryCode and channel to sendOTP callback
              opts.sendOTP({ phoneNumber, countryCode, code: otp, channel }, ctx),
            );
          }
          throw new APIError("UNAUTHORIZED", { message: PHONE_NUMBER_ERROR_CODES.PHONE_NUMBER_NOT_VERIFIED.message });
        }
      }

      const accounts = await ctx.context.internalAdapter.findAccountByUserId(user.id);
      const credentialAccount = accounts.find((a) => a.providerId === "credential");
      if (!credentialAccount) {
        ctx.context.logger.error("Credential account not found", { phoneNumber });
        throw new APIError("UNAUTHORIZED", { message: PHONE_NUMBER_ERROR_CODES.INVALID_PHONE_NUMBER_OR_PASSWORD.message });
      }
      const currentPassword = credentialAccount?.password;
      if (!currentPassword) {
        ctx.context.logger.error("Password not found", { phoneNumber });
        throw new APIError("UNAUTHORIZED", { message: PHONE_NUMBER_ERROR_CODES.UNEXPECTED_ERROR.message });
      }
      const validPassword = await ctx.context.password.verify({
        hash: currentPassword,
        password,
      });
      if (!validPassword) {
        ctx.context.logger.error("Invalid password");
        throw new APIError("UNAUTHORIZED", { message: PHONE_NUMBER_ERROR_CODES.INVALID_PHONE_NUMBER_OR_PASSWORD.message });
      }
      // [ADDED] Run session creation and onLoginSuccess hook in parallel to avoid serial round-trips
      const [session, additionalData] = await Promise.all([
        ctx.context.internalAdapter.createSession(user.id, ctx.body.rememberMe === false),
        opts.onLoginSuccess ? opts.onLoginSuccess({ user, isNewUser: false }, ctx) : Promise.resolve(undefined),
      ]);
      if (!session) {
        ctx.context.logger.error("Failed to create session");
        throw new APIError("UNAUTHORIZED", { message: BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION.message });
      }
      await setSessionCookie(ctx, { session, user }, ctx.body.rememberMe === false);
      return ctx.json({
        token: session.token,
        user: parseUserOutput(ctx.context.options, user),
        // [ADDED] additionalData: injected by the onLoginSuccess hook, undefined when hook not configured
        ...(additionalData !== undefined ? { additionalData } : {}),
      });
    },
  );

// ── Endpoint: sendPhoneNumberOTP ──────────────────────────────────────────────

// [CHANGED] Added `countryCode` (required) and `channel` (optional) to body schema
const sendPhoneNumberOTPBodySchema = z.object({
  phoneNumber: z.string().meta({
    description: 'Local phone number without country code. Eg: "9876543210"',
  }),
  // [ADDED]
  countryCode: z.string().meta({
    description: 'International dial code. Eg: "+1", "+91"',
  }),
  // [ADDED]
  channel: z
    .string()
    .optional()
    .meta({
      description: 'OTP delivery channel. Eg: "SMS" or "WHATSAPP"',
    }),
});

/**
 * POST `/phone-number/send-otp`
 *
 * server: `auth.api.sendPhoneNumberOTP`
 * client: `authClient.phoneNumber.sendOtp`
 */
export const sendPhoneNumberOTP = (opts: RequiredPhoneNumberOptions) =>
  createAuthEndpoint(
    "/phone-number/send-otp",
    {
      method: "POST",
      body: sendPhoneNumberOTPBodySchema,
      metadata: {
        openapi: {
          summary: "Send OTP to phone number",
          description: "Use this endpoint to send OTP to phone number",
          responses: {
            200: {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { message: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (ctx) => {
      if (!opts?.sendOTP) {
        ctx.context.logger.warn("sendOTP not implemented");
        throw new APIError("NOT_IMPLEMENTED", { message: PHONE_NUMBER_ERROR_CODES.SEND_OTP_NOT_IMPLEMENTED.message });
      }

      if (opts.phoneNumberValidator) {
        // [CHANGED] Pass countryCode to validator
        const isValidNumber = await opts.phoneNumberValidator(
          ctx.body.phoneNumber,
          ctx.body.countryCode,
        );
        if (!isValidNumber) {
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.INVALID_PHONE_NUMBER.message });
        }
      }

      // [CHANGED] Use resolveOTP helper
      const code = await resolveOTP(
        opts,
        {
          phoneNumber: ctx.body.phoneNumber,
          countryCode: ctx.body.countryCode,
          channel: ctx.body.channel,
        },
        ctx,
      );

      // [CHANGED] OTP identifier includes countryCode; channel stored in record
      await ctx.context.internalAdapter.createVerificationValue({
        value: `${code}:0`,
        identifier: otpIdentifier(ctx.body.countryCode, ctx.body.phoneNumber),
        expiresAt: getDate(opts.expiresIn, "sec"),
        ...(ctx.body.channel ? { channel: ctx.body.channel } : {}),
      } as Parameters<typeof ctx.context.internalAdapter.createVerificationValue>[0]);

      // Upstream v1.6.2 uses a more explicit background-task check; kept as-is
      const sendOTPResult = opts.sendOTP(
        // [CHANGED] Pass countryCode and channel
        {
          phoneNumber: ctx.body.phoneNumber,
          countryCode: ctx.body.countryCode,
          code,
          channel: ctx.body.channel,
        },
        ctx,
      );
      if (
        ctx.context.options.advanced?.backgroundTasks?.handler &&
        sendOTPResult instanceof Promise
      ) {
        try {
          ctx.context.runInBackground(
            sendOTPResult.catch((e) => {
              ctx.context.logger.error("Failed to run background task:", e);
            }),
          );
        } catch (e) {
          ctx.context.logger.error("Failed to run background task:", e);
        }
      } else {
        await sendOTPResult;
      }
      return ctx.json({ message: "code sent" });
    },
  );

// ── Endpoint: verifyPhoneNumber ───────────────────────────────────────────────

// [CHANGED] Added `countryCode` (required) and `channel` (optional) to body schema
// Upstream v1.6.2 used `.and(z.record(z.string(), z.any()))` to allow extra
// fields to flow into parseUserInput for signUpOnVerification; kept as-is.
const verifyPhoneNumberBodySchema = z
  .object({
    phoneNumber: z.string().meta({
      description: 'Local phone number without country code. Eg: "9876543210"',
    }),
    // [ADDED]
    countryCode: z.string().meta({
      description: 'International dial code. Eg: "+1", "+91"',
    }),
    code: z.string().meta({
      description: 'OTP code. Eg: "123456"',
    }),
    // [ADDED]
    channel: z
      .string()
      .optional()
      .meta({
        description: 'OTP delivery channel. Eg: "SMS" or "WHATSAPP"',
      }),
    disableSession: z
      .boolean()
      .meta({
        description: "Disable session creation after verification. Eg: false",
      })
      .optional(),
    updatePhoneNumber: z
      .boolean()
      .meta({
        description:
          "Check if there is a session and update the phone number. Eg: true",
      })
      .optional(),
  })
  .and(z.record(z.string(), z.any()));

/**
 * POST `/phone-number/verify`
 *
 * server: `auth.api.verifyPhoneNumber`
 * client: `authClient.phoneNumber.verify`
 */
export const verifyPhoneNumber = (opts: RequiredPhoneNumberOptions) =>
  createAuthEndpoint(
    "/phone-number/verify",
    {
      method: "POST",
      body: verifyPhoneNumberBodySchema,
      metadata: {
        openapi: {
          summary: "Verify phone number",
          description: "Use this endpoint to verify phone number",
          responses: {
            "200": {
              description: "Phone number verified successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: {
                        type: "boolean",
                        description: "Indicates if the verification was successful",
                        enum: [true],
                      },
                      token: {
                        type: "string",
                        nullable: true,
                        description:
                          "Session token if session is created, null if disableSession is true",
                      },
                      isNewUser: {
                        type: "boolean",
                        description:
                          "True when the verification created a new account (signup), false when it verified an existing user",
                      },
                      user: {
                        type: "object",
                        nullable: true,
                        properties: {
                          id: { type: "string" },
                          email: { type: "string", format: "email", nullable: true },
                          emailVerified: { type: "boolean", nullable: true },
                          name: { type: "string", nullable: true },
                          image: { type: "string", format: "uri", nullable: true },
                          phoneNumber: { type: "string" },
                          countryCode: { type: "string" },
                          phoneNumberVerified: { type: "boolean" },
                          createdAt: { type: "string", format: "date-time" },
                          updatedAt: { type: "string", format: "date-time" },
                        },
                        required: ["id", "phoneNumber", "countryCode", "phoneNumberVerified", "createdAt", "updatedAt"],
                      },
                    },
                    required: ["status"],
                  },
                },
              },
            },
            400: { description: "Invalid OTP" },
          },
        },
      },
    },
    async (ctx) => {
      // [CHANGED] Include countryCode and channel in OTP verification
      const identifier = otpIdentifier(ctx.body.countryCode, ctx.body.phoneNumber);

      if (opts?.verifyOTP) {
        const isValid = await opts.verifyOTP(
          {
            phoneNumber: ctx.body.phoneNumber,
            // [CHANGED] Pass countryCode
            countryCode: ctx.body.countryCode,
            code: ctx.body.code,
            // [CHANGED] Pass channel
            channel: ctx.body.channel,
          },
          ctx,
        );
        if (!isValid) {
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.INVALID_OTP.message });
        }
        // Clean up
        const otp = await ctx.context.internalAdapter.findVerificationValue(identifier);
        if (otp) {
          // [CHANGED] Use composite identifier (upstream used bare phoneNumber)
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
        }
      } else {
        // [CHANGED] OTP lookup uses composite identifier
        const otp = await ctx.context.internalAdapter.findVerificationValue(identifier);

        if (!otp || otp.expiresAt < new Date()) {
          if (otp && otp.expiresAt < new Date()) {
            throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.OTP_EXPIRED.message });
          }
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.OTP_NOT_FOUND.message });
        }
        const [otpValue, attempts] = otp.value.split(":");
        const allowedAttempts = opts?.allowedAttempts || 3;
        if (attempts && parseInt(attempts) >= allowedAttempts) {
          // [CHANGED] Delete by composite identifier
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
          throw new APIError("FORBIDDEN", { message: PHONE_NUMBER_ERROR_CODES.TOO_MANY_ATTEMPTS.message });
        }
        if (otpValue !== ctx.body.code) {
          // [CHANGED] Update by composite identifier
          await ctx.context.internalAdapter.updateVerificationByIdentifier(identifier, {
            value: `${otpValue}:${parseInt(attempts || "0") + 1}`,
          });
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.INVALID_OTP.message });
        }
        // [CHANGED] Delete by composite identifier
        await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
      }

      // ── updatePhoneNumber flow ────────────────────────────────────────────
      if (ctx.body.updatePhoneNumber) {
        const session = await getSessionFromCtx(ctx);
        if (!session) {
          throw new APIError("UNAUTHORIZED", { message: BASE_ERROR_CODES.USER_NOT_FOUND.message });
        }
        // [CHANGED] Check composite uniqueness (phoneNumber + countryCode)
        const existingUser = await ctx.context.adapter.findMany<UserWithPhoneNumber>({
          model: "user",
          where: [
            { field: "phoneNumber", value: ctx.body.phoneNumber },
            { field: "countryCode", value: ctx.body.countryCode },
          ],
        });
        if (existingUser.length) {
          throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.PHONE_NUMBER_EXIST.message });
        }
        const user = await ctx.context.internalAdapter.updateUser<UserWithPhoneNumber>(
          session.user.id,
          {
            [opts.phoneNumber]: ctx.body.phoneNumber,
            // [ADDED] Update countryCode too
            countryCode: ctx.body.countryCode,
            [opts.phoneNumberVerified]: true,
          },
        );
        return ctx.json({
          status: true,
          token: session.session.token,
          user: parseUserOutput(ctx.context.options, user),
          isNewUser: false,
        });
      }

      // ── regular verify / sign-up flow ─────────────────────────────────────
      let user = await ctx.context.adapter.findOne<UserWithPhoneNumber>({
        model: "user",
        where: [
          { value: ctx.body.phoneNumber, field: opts.phoneNumber },
          // [ADDED] Also match on countryCode
          { value: ctx.body.countryCode, field: "countryCode" },
        ],
      });

      // [ADDED] Track whether this verification resulted in a new user being created
      let isNewUser = false;

      if (!user) {
        if (opts?.signUpOnVerification) {
          const {
            phoneNumber,
            countryCode,
            code,
            disableSession,
            updatePhoneNumber,
            channel,
            ...rest
          } = ctx.body;
          const additionalFields = parseUserInput(ctx.context.options, rest, "create");
          user = await ctx.context.internalAdapter.createUser<UserWithPhoneNumber>({
            ...additionalFields,
            email: opts.signUpOnVerification.getTempEmail(phoneNumber),
            name: opts.signUpOnVerification.getTempName
              ? opts.signUpOnVerification.getTempName(phoneNumber)
              : phoneNumber,
            [opts.phoneNumber]: phoneNumber,
            // [ADDED] Store countryCode on new user
            countryCode: countryCode,
            [opts.phoneNumberVerified]: true,
          });
          if (!user) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: BASE_ERROR_CODES.FAILED_TO_CREATE_USER.message });
          }
          // [ADDED] Mark as new user signup
          isNewUser = true;
        }
      } else {
        user = await ctx.context.internalAdapter.updateUser<UserWithPhoneNumber>(
          user.id,
          { [opts.phoneNumberVerified]: true },
        );
      }

      if (!user) {
        throw new APIError("INTERNAL_SERVER_ERROR", { message: BASE_ERROR_CODES.FAILED_TO_UPDATE_USER.message });
      }

      await opts?.callbackOnVerification?.(
        {
          phoneNumber: ctx.body.phoneNumber,
          // [CHANGED] Pass countryCode and channel to callback
          countryCode: ctx.body.countryCode,
          channel: ctx.body.channel,
          user,
        },
        ctx,
      );

      if (!ctx.body.disableSession) {
        // [ADDED] Run session creation and onLoginSuccess hook in parallel to avoid serial round-trips
        const [session, additionalData] = await Promise.all([
          ctx.context.internalAdapter.createSession(user.id),
          opts.onLoginSuccess ? opts.onLoginSuccess({ user, isNewUser }, ctx) : Promise.resolve(undefined),
        ]);
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION.message });
        }
        await setSessionCookie(ctx, { session, user });
        return ctx.json({
          status: true,
          token: session.token,
          user: parseUserOutput(ctx.context.options, user),
          isNewUser,
          // [ADDED] additionalData: injected by the onLoginSuccess hook, undefined when hook not configured
          ...(additionalData !== undefined ? { additionalData } : {}),
        });
      }

      return ctx.json({
        status: true,
        token: null,
        user: parseUserOutput(ctx.context.options, user),
        isNewUser,
      });
    },
  );

// ── Endpoint: requestPasswordResetPhoneNumber ─────────────────────────────────

// [CHANGED] Added `countryCode` (required) and `channel` (optional) to body schema
const requestPasswordResetPhoneNumberBodySchema = z.object({
  phoneNumber: z.string(),
  // [ADDED]
  countryCode: z.string().meta({
    description: 'International dial code. Eg: "+1", "+91"',
  }),
  // [ADDED]
  channel: z
    .string()
    .optional()
    .meta({
      description: 'OTP delivery channel. Eg: "SMS" or "WHATSAPP"',
    }),
});

/**
 * POST `/phone-number/request-password-reset`
 */
export const requestPasswordResetPhoneNumber = (
  opts: RequiredPhoneNumberOptions,
) =>
  createAuthEndpoint(
    "/phone-number/request-password-reset",
    {
      method: "POST",
      body: requestPasswordResetPhoneNumberBodySchema,
      metadata: {
        openapi: {
          description: "Request OTP for password reset via phone number",
          responses: {
            "200": {
              description: "OTP sent successfully for password reset",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: {
                        type: "boolean",
                        description: "Indicates if the OTP was sent successfully",
                        enum: [true],
                      },
                    },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
    },
    async (ctx) => {
      // [CHANGED] User query checks both phoneNumber and countryCode
      const user = await ctx.context.adapter.findOne<UserWithPhoneNumber>({
        model: "user",
        where: [
          { value: ctx.body.phoneNumber, field: opts.phoneNumber },
          { value: ctx.body.countryCode, field: "countryCode" },
        ],
      });

      // [CHANGED] Use resolveOTP helper
      const code = await resolveOTP(
        opts,
        {
          phoneNumber: ctx.body.phoneNumber,
          countryCode: ctx.body.countryCode,
          channel: ctx.body.channel,
        },
        ctx,
      );

      // [CHANGED] OTP identifier includes countryCode; channel stored in record
      await ctx.context.internalAdapter.createVerificationValue({
        value: `${code}:0`,
        identifier: resetIdentifier(ctx.body.countryCode, ctx.body.phoneNumber),
        expiresAt: getDate(opts.expiresIn, "sec"),
        ...(ctx.body.channel ? { channel: ctx.body.channel } : {}),
      } as Parameters<typeof ctx.context.internalAdapter.createVerificationValue>[0]);

      // Avoid leaking whether the phone exists
      if (!user) {
        return ctx.json({ status: true });
      }

      if (opts.sendPasswordResetOTP) {
        await ctx.context.runInBackgroundOrAwait(
          // [CHANGED] Pass countryCode and channel to callback
          opts.sendPasswordResetOTP(
            {
              phoneNumber: ctx.body.phoneNumber,
              countryCode: ctx.body.countryCode,
              code,
              channel: ctx.body.channel,
            },
            ctx,
          ),
        );
      }
      return ctx.json({ status: true });
    },
  );

// ── Endpoint: resetPasswordPhoneNumber ───────────────────────────────────────

// [CHANGED] Added `countryCode` (required) to body schema
const resetPasswordPhoneNumberBodySchema = z.object({
  otp: z.string().meta({
    description: 'One-time password for password reset. Eg: "123456"',
  }),
  phoneNumber: z.string().meta({
    description: 'Local phone number without country code. Eg: "9876543210"',
  }),
  // [ADDED]
  countryCode: z.string().meta({
    description: 'International dial code. Eg: "+1", "+91"',
  }),
  newPassword: z.string().meta({
    description: 'The new password. Eg: "new-and-secure-password"',
  }),
});

/**
 * POST `/phone-number/reset-password`
 */
export const resetPasswordPhoneNumber = (opts: RequiredPhoneNumberOptions) =>
  createAuthEndpoint(
    "/phone-number/reset-password",
    {
      method: "POST",
      body: resetPasswordPhoneNumberBodySchema,
      metadata: {
        openapi: {
          description: "Reset password using phone number OTP",
          responses: {
            "200": {
              description: "Password reset successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: {
                        type: "boolean",
                        description: "Indicates if the password was reset successfully",
                        enum: [true],
                      },
                    },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
    },
    async (ctx) => {
      // [CHANGED] OTP lookup uses composite reset identifier
      const phoneResetIdentifier = resetIdentifier(
        ctx.body.countryCode,
        ctx.body.phoneNumber,
      );
      const verification =
        await ctx.context.internalAdapter.findVerificationValue(phoneResetIdentifier);
      if (!verification) {
        throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.OTP_NOT_FOUND.message });
      }
      if (verification.expiresAt < new Date()) {
        throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.OTP_EXPIRED.message });
      }
      const [otpValue, attempts] = verification.value.split(":");
      const allowedAttempts = opts?.allowedAttempts || 3;
      if (attempts && parseInt(attempts) >= allowedAttempts) {
        await ctx.context.internalAdapter.deleteVerificationByIdentifier(
          phoneResetIdentifier,
        );
        throw new APIError("FORBIDDEN", { message: PHONE_NUMBER_ERROR_CODES.TOO_MANY_ATTEMPTS.message });
      }
      if (ctx.body.otp !== otpValue) {
        await ctx.context.internalAdapter.updateVerificationByIdentifier(
          phoneResetIdentifier,
          { value: `${otpValue}:${parseInt(attempts || "0") + 1}` },
        );
        throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.INVALID_OTP.message });
      }

      // [CHANGED] User query checks both phoneNumber and countryCode
      const userRes = await ctx.context.adapter.findOne<
        UserWithPhoneNumber & { account: Account[] | undefined }
      >({
        model: "user",
        where: [
          { field: "phoneNumber", value: ctx.body.phoneNumber },
          { field: "countryCode", value: ctx.body.countryCode },
        ],
        join: { account: true },
      });
      if (!userRes) {
        throw new APIError("BAD_REQUEST", { message: PHONE_NUMBER_ERROR_CODES.UNEXPECTED_ERROR.message });
      }
      const { account: accounts = [], ...user } = userRes;
      const minLength = ctx.context.password.config.minPasswordLength;
      const maxLength = ctx.context.password.config.maxPasswordLength;
      if (ctx.body.newPassword.length < minLength) {
        throw new APIError("BAD_REQUEST", { message: BASE_ERROR_CODES.PASSWORD_TOO_SHORT.message });
      }
      if (ctx.body.newPassword.length > maxLength) {
        throw new APIError("BAD_REQUEST", { message: BASE_ERROR_CODES.PASSWORD_TOO_LONG.message });
      }
      const hashedPassword = await ctx.context.password.hash(ctx.body.newPassword);
      const account = accounts.find((a) => a.providerId === "credential");
      if (!account) {
        await ctx.context.internalAdapter.createAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: hashedPassword,
        });
      } else {
        await ctx.context.internalAdapter.updatePassword(user.id, hashedPassword);
      }
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(
        phoneResetIdentifier,
      );

      if (ctx.context.options.emailAndPassword?.onPasswordReset) {
        await ctx.context.options.emailAndPassword.onPasswordReset(
          { user },
          ctx.request,
        );
      }
      if (ctx.context.options.emailAndPassword?.revokeSessionsOnPasswordReset) {
        await ctx.context.internalAdapter.deleteSessions(user.id);
      }

      return ctx.json({ status: true });
    },
  );

// ── Utility re-exported for tests ─────────────────────────────────────────────

/** @internal */
export function getDate(span: number, unit: "sec" | "ms" = "ms"): Date {
  return new Date(Date.now() + (unit === "sec" ? span * 1000 : span));
}
