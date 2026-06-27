import { describe, it, expect } from "vitest";
import { oauthPublicConfig, readOAuthSecrets } from "../oauthConfig.js";

describe("oauthConfig", () => {
  it("readOAuthSecrets returns null providers when env incomplete", () => {
    const secrets = readOAuthSecrets({});
    expect(secrets.github).toBeNull();
    expect(secrets.x).toBeNull();
  });

  it("readOAuthSecrets parses complete provider config", () => {
    const secrets = readOAuthSecrets({
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
      GITHUB_REDIRECT_URI: "https://play.example.com/auth/github/callback",
      X_CLIENT_ID: "x-id",
      X_CLIENT_SECRET: "x-secret",
      X_REDIRECT_URI: "https://play.example.com/auth/x/callback",
    });
    expect(secrets.github?.clientId).toBe("gh-id");
    expect(secrets.x?.redirectUri).toContain("/auth/x/callback");
  });

  it("readOAuthSecrets ignores placeholder credentials", () => {
    const secrets = readOAuthSecrets({
      GITHUB_CLIENT_ID: "your_github_client_id_here",
      GITHUB_CLIENT_SECRET: "your_github_client_secret_here",
      GITHUB_REDIRECT_URI: "https://play.example.com/auth/github/callback",
    });
    expect(secrets.github).toBeNull();
  });

  it("oauthPublicConfig strips secrets", () => {
    const secrets = readOAuthSecrets({
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
      GITHUB_REDIRECT_URI: "https://play.example.com/auth/github/callback",
    });
    const pub = oauthPublicConfig(secrets);
    expect(pub.github).toEqual({
      clientId: "gh-id",
      redirectUri: "https://play.example.com/auth/github/callback",
    });
    expect(pub.x).toBeNull();
    expect(pub.github).not.toHaveProperty("clientSecret");
  });
});
