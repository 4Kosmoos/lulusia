// Access tokens. The remote MCP server is an OAuth resource server: it never signs anyone in. The
// authorization server (WorkOS AuthKit in production) does, then gives Claude a signed JWT meant for this
// server only. Here we check that token: signature against the authorization server's public keys, issuer,
// audience (this server's URL) and expiry. The allowlist of users is checked in remote.ts.

import { OAuthError, OAuthErrorCode, type OAuthMetadata, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

const TIMEOUT_MS = 10_000;
const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/** Authorization server metadata, with the address of its public keys. */
export type AuthorizationServer = OAuthMetadata & { jwks_uri: string };

/**
 * Reads the authorization server's metadata (RFC 8414) and checks that it describes the expected issuer,
 * so that a wrong OAUTH_ISSUER stops the server at startup instead of failing every sign-in.
 */
export async function fetchAuthorizationServer(issuer: URL): Promise<AuthorizationServer> {
  const path = issuer.pathname === "/" ? "" : withoutTrailingSlash(issuer.pathname);
  const url = new URL(`/.well-known/oauth-authorization-server${path}`, issuer);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Authorization server metadata ${url}: HTTP ${response.status}`);
  const metadata = (await response.json()) as Partial<AuthorizationServer>;
  if (withoutTrailingSlash(String(metadata.issuer)) !== withoutTrailingSlash(issuer.href)) {
    throw new Error(`Authorization server metadata ${url}: issuer is ${metadata.issuer}, expected ${issuer.href}`);
  }
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof metadata[field] !== "string") throw new Error(`Authorization server metadata ${url}: no ${field}`);
  }
  return metadata as AuthorizationServer;
}

export interface JwtVerifierOptions {
  /** Expected `iss` claim: the authorization server's issuer. */
  issuer: string;
  /** Expected `aud` claim: this server's public URL, as entered in Claude. */
  audience: URL;
  /** The authorization server's public keys (createRemoteJWKSet in production). */
  keys: JWTVerifyGetKey;
}

/**
 * Checks access tokens. A token that fails any check is an `invalid_token` OAuth error: the SDK answers
 * 401 with the challenge that makes Claude sign in again. The user (token subject) goes into
 * `extra.userId` for the allowlist and the logs.
 */
export function createJwtVerifier({ issuer, audience, keys }: JwtVerifierOptions): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, { issuer, audience: audience.href }));
      } catch (error) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, `Invalid access token: ${(error as Error).message}`);
      }
      if (!payload.sub || payload.exp === undefined) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token: no subject or no expiry");
      }
      const clientId = payload.client_id ?? payload.azp ?? payload.sub;
      return {
        token,
        clientId: String(clientId),
        scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
        expiresAt: payload.exp,
        // jwtVerify has checked that the audience is this server.
        resource: audience,
        extra: { userId: payload.sub },
      };
    },
  };
}
