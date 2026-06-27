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
