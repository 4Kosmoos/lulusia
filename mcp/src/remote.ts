// The remote server as one web-standard fetch handler, in the order a request goes through it:
// Host check, health check, OAuth discovery documents, then the MCP endpoint behind a bearer token and
// the allowlist. Served by http.ts, tested in process.

import {
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  requireBearerAuth,
  type AuthMetadataOptions,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import type { FactoryData } from "./data.ts";
import { createServer } from "./server.ts";

export interface RemoteOptions {
  data: FactoryData;
  /** Public URL of the MCP endpoint, exactly as entered in Claude ("https://host:8443/mcp"). */
  publicUrl: URL;
  /** Metadata of the authorization server (RFC 8414), also served here for clients that look for it. */
  authorizationServer: OAuthMetadata;
  verifier: OAuthTokenVerifier;
  /** Users (token subjects) allowed to use the server. */
  allowedUsers: ReadonlySet<string>;
  /** One line per request. Default: console.log. */
  log?: (line: string) => void;
}

export interface RemoteApp {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/** Hosts accepted besides the public one: the health check, from inside the container or the VPS. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

export function createRemoteApp(options: RemoteOptions): RemoteApp {
  const { publicUrl, allowedUsers, log = console.log } = options;
  const mcp = createMcpHandler(() => createServer(options.data));
  const metadata: AuthMetadataOptions = {
    oauthMetadata: options.authorizationServer,
    resourceServerUrl: publicUrl,
    resourceName: "Lulusia factory (read-only)",
  };
  // Fails now, at startup, if the issuer is not a valid HTTPS URL.
  buildOAuthProtectedResourceMetadata(metadata);
  const gate = requireBearerAuth({
    verifier: options.verifier,
    // The 401 challenge points there: that is how Claude finds the authorization server.
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(publicUrl),
    expectedResource: publicUrl,
  });
  const hosts = [publicUrl.hostname, ...LOCAL_HOSTS];

  async function route(request: Request): Promise<{ response: Response; user?: string }> {
    const rejected = hostHeaderValidationResponse(request, hosts);
    if (rejected) return { response: rejected };

    const path = new URL(request.url).pathname;
    if (path === "/health") return { response: new Response("ok\n") };

    const discovery = oauthMetadataResponse(request, metadata);
    if (discovery) return { response: discovery };

    if (path !== publicUrl.pathname) return { response: new Response("Not found\n", { status: 404 }) };

    const auth = await gate(request);
    if (auth instanceof Response) return { response: auth };
    const user = String(auth.extra?.userId);
    if (!allowedUsers.has(user)) {
      const body = { error: "access_denied", error_description: "This account is not allowed on this server." };
      return { response: Response.json(body, { status: 403 }), user };
    }
    return { response: await mcp.fetch(request, { authInfo: auth }), user };
  }

  return {
    async fetch(request) {
      const started = Date.now();
      const { response, user } = await route(request);
      const path = new URL(request.url).pathname;
      if (path !== "/health") log(`${request.method} ${path} ${response.status} ${user ?? "-"} ${Date.now() - started} ms`);
      return response;
    },
    close: () => mcp.close(),
  };
}
