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

export function readOAuthSecrets(env: NodeJS.ProcessEnv = process.env): OAuthSecrets {
  const ghId = trim(env.GITHUB_CLIENT_ID);
  const ghSecret = trim(env.GITHUB_CLIENT_SECRET);
  const ghRedirect = trim(env.GITHUB_REDIRECT_URI);
  const xId = trim(env.X_CLIENT_ID);
  const xSecret = trim(env.X_CLIENT_SECRET);
  const xRedirect = trim(env.X_REDIRECT_URI);

  return {
    github: ghId && ghSecret && ghRedirect
      ? { clientId: ghId, clientSecret: ghSecret, redirectUri: ghRedirect }
      : null,
    x: xId && xSecret && xRedirect
      ? { clientId: xId, clientSecret: xSecret, redirectUri: xRedirect }
      : null,
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
