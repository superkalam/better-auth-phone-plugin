import * as better_auth from 'better-auth';
import { phoneNumber } from './index.cjs';
export { PHONE_NUMBER_ERROR_CODES, PhoneNumberOptions, UserWithPhoneNumber } from './index.cjs';
import 'zod/v4/core';
import 'zod';
import 'better-call';
import '@better-auth/core';
import 'better-auth/types';

/**
 * Client-side plugin for better-auth-phone.
 *
 * Add this to your Better Auth client alongside the server plugin.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { phoneNumberClient } from "better-auth-phone/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [phoneNumberClient()],
 * });
 * ```
 */
declare const phoneNumberClient: () => {
    id: "betterAuthPhone";
    $InferServerPlugin: ReturnType<typeof phoneNumber>;
    atomListeners: {
        matcher(path: string): path is "/sign-in/phone-number" | "/phone-number/verify" | "/phone-number/update";
        signal: "$sessionSignal";
    }[];
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

export { phoneNumberClient };
