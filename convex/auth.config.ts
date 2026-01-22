/**
 * Convex Auth Configuration
 *
 * Configures Clerk as the authentication provider.
 * Convex verifies JWTs issued by Clerk to authenticate users.
 */

const authConfig = {
  providers: [
    {
      // Clerk domain for JWT verification
      // This should match your Clerk instance
      domain:
        process.env.CLERK_ISSUER_URL ||
        "https://composed-drake-56.clerk.accounts.dev",
      // Application ID (optional, for multi-app setups)
      applicationID: "convex",
    },
  ],
};

export default authConfig;
