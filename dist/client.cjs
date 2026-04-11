'use strict';

// node_modules/@better-auth/core/dist/utils/error-codes.mjs
function defineErrorCodes(codes) {
  return Object.fromEntries(Object.entries(codes).map(([key, value]) => [key, {
    code: key,
    message: value,
    toString: () => key
  }]));
}

// src/error-codes.ts
var PHONE_NUMBER_ERROR_CODES = defineErrorCodes({
  // ── upstream ──────────────────────────────────────────────────────────────
  INVALID_PHONE_NUMBER: "Invalid phone number",
  PHONE_NUMBER_EXIST: "Phone number already exists",
  PHONE_NUMBER_NOT_EXIST: "phone number isn't registered",
  INVALID_PHONE_NUMBER_OR_PASSWORD: "Invalid phone number or password",
  UNEXPECTED_ERROR: "Unexpected error",
  OTP_NOT_FOUND: "OTP not found",
  OTP_EXPIRED: "OTP expired",
  INVALID_OTP: "Invalid OTP",
  PHONE_NUMBER_NOT_VERIFIED: "Phone number not verified",
  PHONE_NUMBER_CANNOT_BE_UPDATED: "Phone number cannot be updated",
  SEND_OTP_NOT_IMPLEMENTED: "sendOTP not implemented",
  TOO_MANY_ATTEMPTS: "Too many attempts",
  // ── added ──────────────────────────────────────────────────────────────────
  PHONE_NUMBER_COUNTRY_CODE_REQUIRED: "Country code is required"
});

// src/client.ts
var phoneNumberClient = () => {
  return {
    // [CHANGED] "phoneNumber" → "betterAuthPhone"
    id: "betterAuthPhone",
    $InferServerPlugin: {},
    atomListeners: [
      {
        matcher(path) {
          return path === "/phone-number/update" || path === "/phone-number/verify" || path === "/sign-in/phone-number";
        },
        signal: "$sessionSignal"
      }
    ],
    $ERROR_CODES: PHONE_NUMBER_ERROR_CODES
  };
};

exports.PHONE_NUMBER_ERROR_CODES = PHONE_NUMBER_ERROR_CODES;
exports.phoneNumberClient = phoneNumberClient;
//# sourceMappingURL=client.cjs.map
//# sourceMappingURL=client.cjs.map