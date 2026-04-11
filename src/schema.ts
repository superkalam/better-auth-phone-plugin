import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

/**
 * Database schema for the better-auth-phone plugin.
 *
 * Changes from upstream (better-auth v1.6.2 phone-number plugin):
 *   [ADDED] user.countryCode  — stores the dial code separately (e.g. "+1", "+91")
 *   [ADDED] verification.channel — stores the OTP delivery method (e.g. "SMS", "WHATSAPP")
 *
 * Upstream user fields kept as-is: phoneNumber (unique, sortable), phoneNumberVerified.
 */
export const schema = {
  user: {
    fields: {
      // ── upstream ──────────────────────────────────────────────────────────
      phoneNumber: {
        type: "string",
        required: false,
        unique: true,
        sortable: true,
        returned: true,
      },
      phoneNumberVerified: {
        type: "boolean",
        required: false,
        returned: true,
        input: false,
      },
      // ── added: country code ───────────────────────────────────────────────
      // Stores the international dial code separate from the local number.
      // Example: countryCode = "+91", phoneNumber = "9876543210"
      //
      // NOTE: uniqueness is enforced at the application layer (composite
      // phoneNumber + countryCode) because Better Auth's schema DSL does not
      // yet support composite unique constraints natively.
      countryCode: {
        type: "string",
        required: false,
        returned: true,
      },
    },
  },
  verification: {
    fields: {
      // ── added: OTP delivery channel ───────────────────────────────────────
      // Tracks which channel was used to send each OTP (e.g. "SMS", "WHATSAPP").
      // Enables analytics, debugging, and provider-level routing.
      channel: {
        type: "string",
        required: false,
        input: true,
        returned: true,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;
