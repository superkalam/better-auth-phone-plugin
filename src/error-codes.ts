import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

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
export const PHONE_NUMBER_ERROR_CODES = defineErrorCodes({
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
  PHONE_NUMBER_COUNTRY_CODE_REQUIRED: "Country code is required",
});
