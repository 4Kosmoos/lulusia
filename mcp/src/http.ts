// Entry point of the remote server: MCP over Streamable HTTP, run in Docker on the VPS and published on
// the Internet by Tailscale Funnel. Claude calls it from Anthropic's cloud, with an access token from the
// authorization server. The stdio entry point for local use is index.ts.
//
// Configuration (mcp/.env on the server, see .env.example): FRM_URL, MCP_PUBLIC_URL, OAUTH_ISSUER,
// ALLOWED_USERS, and optionally PORT.

import { createServer as createHttpServer } from "node:http";
import { createFrmReader } from "@lulusia/lib/frm";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createRemoteJWKSet } from "jose";
import { createJwtVerifier, fetchAuthorizationServer } from "./auth.ts";
import { createFactoryData } from "./data.ts";
import { createRemoteApp } from "./remote.ts";
import { VERSION } from "./server.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name} (see mcp/.env.example)`);
    process.exit(1);
  }
  return value;
}

const publicUrl = new URL(required("MCP_PUBLIC_URL"));
const issuer = new URL(required("OAUTH_ISSUER"));
const allowedUsers = new Set(
  required("ALLOWED_USERS")
    .split(",")
    .map((user) => user.trim())
    .filter(Boolean),
);
const frmUrl = required("FRM_URL");
const port = Number(process.env.PORT ?? 3100);

const authorizationServer = await fetchAuthorizationServer(issuer);
const app = createRemoteApp({
  data: createFactoryData(createFrmReader({ url: frmUrl })),
  publicUrl,
  authorizationServer,
  verifier: createJwtVerifier({
    issuer: authorizationServer.issuer,
    audience: publicUrl,
    keys: createRemoteJWKSet(new URL(authorizationServer.jwks_uri)),
  }),
  allowedUsers,
});

const handler = toNodeHandler(app, { onerror: (error) => console.error("Request failed:", error) });
const server = createHttpServer((request, response) => void handler(request, response));
server.listen(port, () => {
  console.log(
    `Lulusia MCP server ${VERSION} (HTTP) listening on port ${port}: public URL ${publicUrl.href}, ` +
      `issuer ${authorizationServer.issuer}, ${allowedUsers.size} allowed users, FRM at ${frmUrl}`,
  );
});

// docker compose stop: finish the requests in progress, then exit.
process.on("SIGTERM", () => {
  server.close();
  void app.close().then(() => process.exit(0));
});
