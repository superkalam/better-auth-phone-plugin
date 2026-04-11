/**
 * client.ts
 *
 * Based on: better-auth v1.6.2
 * Source:   packages/better-auth/src/plugins/phone-number/client.ts
 *
 * Changes from upstream:
 *   [CHANGED] Import of `phoneNumber` now comes from this package's index.ts,
 *             not the upstream monorepo.
 *   [REMOVED] `version` field — PACKAGE_VERSION is internal to the monorepo.
 *   [CHANGED] Plugin id: "phoneNumber" → "betterAuthPhone" to match the server
 *             plugin id "better-auth-phone".
 *   [ADDED]   `/sign-in/phone-number` path retained in atomListeners; upstream
 *             already had this; no change in behaviour.
 *   [UNCHANGED] atomListeners paths, $ERROR_CODES, type re-exports.
 */

import type { BetterAuthClientPlugin } from "@better-auth/core";
import type { phoneNumber } from "./index";
import { PHONE_NUMBER_ERROR_CODES } from "./error-codes";

export * from "./error-codes";
export type * from "./types";

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
export const phoneNumberClient = () => {
  return {
    // [CHANGED] "phoneNumber" → "betterAuthPhone"
    id: "betterAuthPhone",
    $InferServerPlugin: {} as ReturnType<typeof phoneNumber>,
    atomListeners: [
      {
        matcher(path: string) {
          return (
            path === "/phone-number/update" ||
            path === "/phone-number/verify" ||
            path === "/sign-in/phone-number"
          );
        },
        signal: "$sessionSignal",
      },
    ],
    $ERROR_CODES: PHONE_NUMBER_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};
