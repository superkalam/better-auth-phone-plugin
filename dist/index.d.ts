import * as zod_v4_core from 'zod/v4/core';
import * as zod from 'zod';
import * as better_call from 'better-call';
import * as better_auth from 'better-auth';
import { User } from 'better-auth';
import { GenericEndpointContext, Awaitable } from '@better-auth/core';
import { InferOptionSchema } from 'better-auth/types';

/**
 * Error codes for the better-auth-phone plugin.
 *
 * Changes from upstream (better-auth v1.6.2 phone-number plugin):
 *   [UNCHANGED] All 12 upstream error codes are kept as-is.
 *   [ADDED] PHONE_NUMBER_COUNTRY_CODE_REQUIRED — returned when countryCode is
 *           missing from a request that requires it.
 *
 * The import path changed from "@better-auth/core/utils/error-codes" to
 * "better-auth/error-codes" to match the public package export surface.
 */
declare const PHONE_NUMBER_ERROR_CODES: {
    INVALID_PHONE_NUMBER: better_auth.RawError<"INVALID_PHONE_NUMBER">;
    PHONE_NUMBER_EXIST: better_auth.RawError<"PHONE_NUMBER_EXIST">;
    PHONE_NUMBER_NOT_EXIST: better_auth.RawError<"PHONE_NUMBER_NOT_EXIST">;
    INVALID_PHONE_NUMBER_OR_PASSWORD: better_auth.RawError<"INVALID_PHONE_NUMBER_OR_PASSWORD">;
    UNEXPECTED_ERROR: better_auth.RawError<"UNEXPECTED_ERROR">;
    OTP_NOT_FOUND: better_auth.RawError<"OTP_NOT_FOUND">;
    OTP_EXPIRED: better_auth.RawError<"OTP_EXPIRED">;
    INVALID_OTP: better_auth.RawError<"INVALID_OTP">;
    PHONE_NUMBER_NOT_VERIFIED: better_auth.RawError<"PHONE_NUMBER_NOT_VERIFIED">;
    PHONE_NUMBER_CANNOT_BE_UPDATED: better_auth.RawError<"PHONE_NUMBER_CANNOT_BE_UPDATED">;
    SEND_OTP_NOT_IMPLEMENTED: better_auth.RawError<"SEND_OTP_NOT_IMPLEMENTED">;
    TOO_MANY_ATTEMPTS: better_auth.RawError<"TOO_MANY_ATTEMPTS">;
    PHONE_NUMBER_COUNTRY_CODE_REQUIRED: better_auth.RawError<"PHONE_NUMBER_COUNTRY_CODE_REQUIRED">;
};

/**
 * Database schema for the better-auth-phone plugin.
 *
 * Changes from upstream (better-auth v1.6.2 phone-number plugin):
 *   [ADDED] user.countryCode  — stores the dial code separately (e.g. "+1", "+91")
 *   [ADDED] verification.channel — stores the OTP delivery method (e.g. "SMS", "WHATSAPP")
 *
 * Upstream user fields kept as-is: phoneNumber (unique, sortable), phoneNumberVerified.
 */
declare const schema: {
    user: {
        fields: {
            phoneNumber: {
                type: "string";
                required: false;
                unique: true;
                sortable: true;
                returned: true;
            };
            phoneNumberVerified: {
                type: "boolean";
                required: false;
                returned: true;
                input: false;
            };
            countryCode: {
                type: "string";
                required: false;
                returned: true;
            };
        };
    };
    verification: {
        fields: {
            channel: {
                type: "string";
                required: false;
                input: true;
                returned: true;
            };
        };
    };
};

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
type PhoneOtpChannel = string | string[];
/** Per-channel delivery outcome from send-otp / password-reset OTP fan-out. */
type PhoneOtpChannelSendResult = {
    channel?: string;
    ok: boolean;
    error?: string;
};
interface UserWithPhoneNumber extends User {
    phoneNumber: string;
    countryCode: string;
    phoneNumberVerified: boolean;
}
interface PhoneNumberOptions {
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
    generateOTP?: ((data: {
        phoneNumber: string;
        countryCode: string;
        channel?: PhoneOtpChannel;
        otpLength: number;
    }, ctx?: GenericEndpointContext) => Awaitable<string>) | undefined;
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
    sendOTP: (data: {
        phoneNumber: string;
        countryCode: string;
        code: string;
        channel?: string;
    }, ctx?: GenericEndpointContext | undefined) => Awaitable<void>;
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
    verifyOTP?: ((data: {
        phoneNumber: string;
        countryCode: string;
        code: string;
        channel?: PhoneOtpChannel;
    }, ctx?: GenericEndpointContext) => Awaitable<boolean>) | undefined;
    /**
     * Callback to send OTP when a user requests a password reset.
     *
     * [MODIFIED vs upstream] `data` now includes `countryCode` and optional `channel`.
     * Multi-channel requests invoke this once per channel (same as `sendOTP`).
     */
    sendPasswordResetOTP?: ((data: {
        phoneNumber: string;
        countryCode: string;
        code: string;
        channel?: string;
    }, ctx?: GenericEndpointContext) => Awaitable<void>) | undefined;
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
    phoneNumberValidator?: ((phoneNumber: string, countryCode: string) => Awaitable<boolean>) | undefined;
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
    callbackOnVerification?: ((data: {
        phoneNumber: string;
        countryCode: string;
        channel?: PhoneOtpChannel;
        user: UserWithPhoneNumber;
    }, ctx?: GenericEndpointContext) => Awaitable<void>) | undefined;
    /**
     * Automatically sign up the user after their first phone verification.
     *
     * A temporary email address is required by Better Auth's user model.
     * You can update the email later via a separate flow.
     */
    signUpOnVerification?: {
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
    } | undefined;
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
    onLoginSuccess?: (data: {
        user: UserWithPhoneNumber;
        isNewUser: boolean;
    }, ctx: GenericEndpointContext) => Awaitable<Record<string, unknown>>;
}

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
declare const phoneNumber: (options?: PhoneNumberOptions | undefined) => {
    id: "better-auth-phone";
    hooks: {
        before: {
            matcher: (ctx: better_auth.HookEndpointContext) => boolean;
            handler: (inputContext: better_call.MiddlewareInputContext<better_call.MiddlewareOptions>) => Promise<never>;
        }[];
    };
    endpoints: {
        signInPhoneNumber: better_call.StrictEndpoint<"/sign-in/phone-number", {
            method: "POST";
            body: zod.ZodObject<{
                phoneNumber: zod.ZodString;
                countryCode: zod.ZodString;
                password: zod.ZodString;
                channel: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>>;
                rememberMe: zod.ZodOptional<zod.ZodBoolean>;
            }, zod_v4_core.$strip>;
            metadata: {
                openapi: {
                    summary: string;
                    description: string;
                    responses: {
                        200: {
                            description: string;
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            user: {
                                                $ref: string;
                                            };
                                            session: {
                                                $ref: string;
                                            };
                                        };
                                    };
                                };
                            };
                        };
                        400: {
                            description: string;
                        };
                    };
                };
            };
        }, {
            additionalData?: Record<string, unknown> | undefined;
            token: string;
            user: UserWithPhoneNumber;
        }>;
        sendPhoneNumberOTP: better_call.StrictEndpoint<"/phone-number/send-otp", {
            method: "POST";
            body: zod.ZodObject<{
                phoneNumber: zod.ZodString;
                countryCode: zod.ZodString;
                channel: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>>;
            }, zod_v4_core.$strip>;
            metadata: {
                openapi: {
                    summary: string;
                    description: string;
                    responses: {
                        200: {
                            description: string;
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            message: {
                                                type: string;
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        }, {
            message: string;
            channels: PhoneOtpChannelSendResult[];
        }>;
        verifyPhoneNumber: better_call.StrictEndpoint<"/phone-number/verify", {
            method: "POST";
            body: zod.ZodIntersection<zod.ZodObject<{
                phoneNumber: zod.ZodString;
                countryCode: zod.ZodString;
                code: zod.ZodString;
                channel: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>>;
                disableSession: zod.ZodOptional<zod.ZodBoolean>;
                updatePhoneNumber: zod.ZodOptional<zod.ZodBoolean>;
            }, zod_v4_core.$strip>, zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
            metadata: {
                openapi: {
                    summary: string;
                    description: string;
                    responses: {
                        "200": {
                            description: string;
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            status: {
                                                type: string;
                                                description: string;
                                                enum: boolean[];
                                            };
                                            token: {
                                                type: string;
                                                nullable: boolean;
                                                description: string;
                                            };
                                            isNewUser: {
                                                type: string;
                                                description: string;
                                            };
                                            user: {
                                                type: string;
                                                nullable: boolean;
                                                properties: {
                                                    id: {
                                                        type: string;
                                                    };
                                                    email: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                    };
                                                    emailVerified: {
                                                        type: string;
                                                        nullable: boolean;
                                                    };
                                                    name: {
                                                        type: string;
                                                        nullable: boolean;
                                                    };
                                                    image: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                    };
                                                    phoneNumber: {
                                                        type: string;
                                                    };
                                                    countryCode: {
                                                        type: string;
                                                    };
                                                    phoneNumberVerified: {
                                                        type: string;
                                                    };
                                                    createdAt: {
                                                        type: string;
                                                        format: string;
                                                    };
                                                    updatedAt: {
                                                        type: string;
                                                        format: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                        400: {
                            description: string;
                        };
                    };
                };
            };
        }, {
            status: boolean;
            token: string;
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            } & UserWithPhoneNumber;
            isNewUser: boolean;
        } | {
            status: boolean;
            token: null;
            user: UserWithPhoneNumber;
            isNewUser: boolean;
        }>;
        requestPasswordResetPhoneNumber: better_call.StrictEndpoint<"/phone-number/request-password-reset", {
            method: "POST";
            body: zod.ZodObject<{
                phoneNumber: zod.ZodString;
                countryCode: zod.ZodString;
                channel: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>>;
            }, zod_v4_core.$strip>;
            metadata: {
                openapi: {
                    description: string;
                    responses: {
                        "200": {
                            description: string;
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            status: {
                                                type: string;
                                                description: string;
                                                enum: boolean[];
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                    };
                };
            };
        }, {
            status: boolean;
        }>;
        resetPasswordPhoneNumber: better_call.StrictEndpoint<"/phone-number/reset-password", {
            method: "POST";
            body: zod.ZodObject<{
                otp: zod.ZodString;
                phoneNumber: zod.ZodString;
                countryCode: zod.ZodString;
                newPassword: zod.ZodString;
            }, zod_v4_core.$strip>;
            metadata: {
                openapi: {
                    description: string;
                    responses: {
                        "200": {
                            description: string;
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            status: {
                                                type: string;
                                                description: string;
                                                enum: boolean[];
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                    };
                };
            };
        }, {
            status: boolean;
        }>;
    };
    schema: {
        user: {
            fields: {
                phoneNumber: {
                    type: "string";
                    required: false;
                    unique: true;
                    sortable: true;
                    returned: true;
                };
                phoneNumberVerified: {
                    type: "boolean";
                    required: false;
                    returned: true;
                    input: false;
                };
                countryCode: {
                    type: "string";
                    required: false;
                    returned: true;
                };
            };
        };
        verification: {
            fields: {
                channel: {
                    type: "string";
                    required: false;
                    input: true;
                    returned: true;
                };
            };
        };
    };
    rateLimit: {
        pathMatcher(path: string): boolean;
        window: number;
        max: number;
    }[];
    options: PhoneNumberOptions | undefined;
    $ERROR_CODES: {
        INVALID_PHONE_NUMBER: better_auth.RawError<"INVALID_PHONE_NUMBER">;
        PHONE_NUMBER_EXIST: better_auth.RawError<"PHONE_NUMBER_EXIST">;
        PHONE_NUMBER_NOT_EXIST: better_auth.RawError<"PHONE_NUMBER_NOT_EXIST">;
        INVALID_PHONE_NUMBER_OR_PASSWORD: better_auth.RawError<"INVALID_PHONE_NUMBER_OR_PASSWORD">;
        UNEXPECTED_ERROR: better_auth.RawError<"UNEXPECTED_ERROR">;
        OTP_NOT_FOUND: better_auth.RawError<"OTP_NOT_FOUND">;
        OTP_EXPIRED: better_auth.RawError<"OTP_EXPIRED">;
        INVALID_OTP: better_auth.RawError<"INVALID_OTP">;
        PHONE_NUMBER_NOT_VERIFIED: better_auth.RawError<"PHONE_NUMBER_NOT_VERIFIED">;
        PHONE_NUMBER_CANNOT_BE_UPDATED: better_auth.RawError<"PHONE_NUMBER_CANNOT_BE_UPDATED">;
        SEND_OTP_NOT_IMPLEMENTED: better_auth.RawError<"SEND_OTP_NOT_IMPLEMENTED">;
        TOO_MANY_ATTEMPTS: better_auth.RawError<"TOO_MANY_ATTEMPTS">;
        PHONE_NUMBER_COUNTRY_CODE_REQUIRED: better_auth.RawError<"PHONE_NUMBER_COUNTRY_CODE_REQUIRED">;
    };
};

export { PHONE_NUMBER_ERROR_CODES, type PhoneNumberOptions, type PhoneOtpChannel, type PhoneOtpChannelSendResult, type UserWithPhoneNumber, phoneNumber };
