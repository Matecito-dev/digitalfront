export type OAuthProvider = "github" | "x";

export interface OAuthPublicConfig {
  github: { clientId: string; redirectUri: string } | null;
  x: { clientId: string; redirectUri: string } | null;
}

export interface OAuthSecrets {
  github: { clientId: string; clientSecret: string; redirectUri: string } | null;
  x: { clientId: string; clientSecret: string; redirectUri: string } | null;
}

function trim(v: string | undefined): string {
  return v?.trim() ?? "";
}

/** Rechaza valores de ejemplo del .env.example */
export function isOAuthPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith("your_")) return true;
  if (v.endsWith("_here")) return true;
  return false;
}

function providerFromEnv(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): { clientId: string; clientSecret: string; redirectUri: string } | null {
  if (isOAuthPlaceholder(clientId) || isOAuthPlaceholder(clientSecret) || isOAuthPlaceholder(redirectUri)) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function readOAuthSecrets(env: NodeJS.ProcessEnv = process.env): OAuthSecrets {
  const ghId = trim(env.GITHUB_CLIENT_ID);
  const ghSecret = trim(env.GITHUB_CLIENT_SECRET);
  const ghRedirect = trim(env.GITHUB_REDIRECT_URI);
  const xId = trim(env.X_CLIENT_ID);
  const xSecret = trim(env.X_CLIENT_SECRET);
  const xRedirect = trim(env.X_REDIRECT_URI);

  return {
    github: providerFromEnv(ghId, ghSecret, ghRedirect),
    x: providerFromEnv(xId, xSecret, xRedirect),
  };
}

export function oauthPublicConfig(secrets: OAuthSecrets): OAuthPublicConfig {
  return {
    github: secrets.github
      ? { clientId: secrets.github.clientId, redirectUri: secrets.github.redirectUri }
      : null,
    x: secrets.x
      ? { clientId: secrets.x.clientId, redirectUri: secrets.x.redirectUri }
      : null,
  };
}

const DEFAULT_REDIRECTS = [
  "https://play.gamedevforge.com/auth/github/callback",
  "https://play.gamedevforge.com/auth/x/callback",
  "https://digitalfront.vercel.app/auth/github/callback",
  "https://digitalfront.vercel.app/auth/x/callback",
];

/** Redirect URI permitida en intercambio OAuth (dominio actual o env). */
export function resolveOAuthRedirect(
  provider: OAuthProvider,
  requested: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secrets = readOAuthSecrets(env);
  const cfg = provider === "github" ? secrets.github : secrets.x;
  if (!cfg) throw new Error(`${provider}_not_configured`);

  const extras = trim(env.DF_OAUTH_REDIRECTS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const allowed = new Set([cfg.redirectUri, ...DEFAULT_REDIRECTS, ...extras]);
  const req = requested?.trim();
  if (req && allowed.has(req)) return req;
  if (req) throw new Error("invalid_redirect_uri");
  return cfg.redirectUri;
}
