# Security Documentation

> Security posture, threat model, and OWASP mitigation matrix for HypeShelf.

## Security Principles

1. **Defense in Depth** - Multiple layers of security controls
2. **Least Privilege** - Users and services have minimal necessary permissions
3. **Secure by Default** - Security features enabled out of the box
4. **Zero Trust** - Verify every request, trust no implicit context

## OWASP Top 10 (2021) Mitigation Matrix

| ID | Risk | Mitigation | Status |
|----|------|------------|--------|
| A01 | Broken Access Control | Server-side RBAC in Convex; every mutation checks `ctx.auth` | ✅ Implemented |
| A02 | Cryptographic Failures | TLS 1.3 (Vercel); Clerk handles credential storage; Convex encrypts at rest | ✅ Delegated |
| A03 | Injection | Convex typed queries (no SQL); React escapes output; URL sanitization | ✅ Implemented |
| A04 | Insecure Design | Threat modeling documented; deny-by-default RBAC | ✅ Implemented |
| A05 | Security Misconfiguration | No default credentials; env vars for secrets; CSP headers | ✅ Implemented |
| A06 | Vulnerable Components | Lockfile pinning; npm audit in CI; Dependabot enabled | ✅ Implemented |
| A07 | Auth Failures | Delegated to Clerk (MFA, rate limiting, session management) | ✅ Delegated |
| A08 | Software/Data Integrity | Signed commits optional; lockfile integrity; PR reviews | ⚠️ Partial |
| A09 | Logging/Monitoring Failures | Structured logging; auth event tracking; OTel ready | ⚠️ Partial |
| A10 | SSRF | No server-side URL fetching; user links validated client-side only | ✅ Mitigated |

## Authentication Security

### Clerk Configuration

- **MFA**: Available (authenticator apps, not SMS)
- **Session Duration**: Default Clerk settings (secure)
- **OAuth Providers**: Google, Apple, Facebook (production credentials required)
- **Rate Limiting**: Clerk built-in protection against brute force

### JWT Verification

- Convex verifies Clerk JWTs using JWKS endpoint
- Tokens validated on every mutation/query
- No client-side trust of auth state for sensitive operations

## Input Validation

### User-Provided Content

| Field | Validation |
|-------|------------|
| `title` | String, max 200 chars, trimmed |
| `genre` | Enum (whitelist of allowed values) |
| `link` | URL format validation, https preferred |
| `blurb` | String, max 500 chars, trimmed |

### URL Handling

- User-provided links are stored but not fetched server-side
- Displayed with `rel="noopener noreferrer"` and `target="_blank"`
- Consider adding URL reputation checking for production

## Secrets Management

### Storage

| Secret Type | Storage Location |
|-------------|------------------|
| Clerk keys | Vercel env vars / GitHub Secrets |
| Convex deploy key | Vercel env vars / GitHub Secrets |
| Local dev secrets | `.env.local` (gitignored) |

### Protection

- Gitleaks pre-commit hook scans for secrets
- `.env.example` contains only placeholders
- CI scans PRs for secret patterns

### Rotation Procedure

1. Generate new key in provider dashboard
2. Update in Vercel environment variables
3. Update in GitHub Secrets (for CI)
4. Redeploy application
5. Revoke old key in provider dashboard

## Security Headers

Configured in `next.config.js`:

```javascript
// Recommended headers
{
  "Content-Security-Policy": "default-src 'self'; ...",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
}
```

## Incident Response

### If a Secret is Compromised

1. **Immediately rotate** the affected credential
2. Review access logs for unauthorized usage
3. Update all deployment environments
4. Document incident and remediation

### If a Vulnerability is Discovered

1. Assess severity and exploitability
2. Develop fix in private branch
3. Deploy fix before public disclosure
4. Update SECURITY.md with lessons learned

## Compliance Considerations

### GDPR / Privacy

- Minimal PII collection (email, display name from OAuth)
- No phone number required
- User data deletion available via Clerk dashboard
- Consider: Data export functionality for user requests

### Logging and PII

- Auth events logged (user ID, not email)
- No request body logging for mutations
- IP addresses not logged by application (Vercel may log at infra level)
