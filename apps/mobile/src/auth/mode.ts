// Which identity system this build runs. Decided ONCE at module load from the
// build-time env, so components can branch on it without conditional hooks:
//   - "clerk": EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is set → real sign-in (Clerk),
//     API calls carry a Bearer session token.
//   - "dev": no key → development sign-in against the API's dev login (only
//     exists on non-production servers); the session rides the native cookie
//     jar. Lets the app run end-to-end before the Clerk account exists.
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

/** Demo build: no network at all — the data layer routes to the in-memory demo
 *  store (src/demo). For try-it-in-a-browser previews and store screenshots. */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";

export const AUTH_MODE: "clerk" | "dev" = CLERK_PUBLISHABLE_KEY && !DEMO ? "clerk" : "dev";
