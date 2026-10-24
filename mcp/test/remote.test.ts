// The remote server over real HTTP, with a fake authorization server: its signing key and its tokens
// are made here, so every way a token can be wrong can be tried.

import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createFrmReader } from "@lulusia/lib/frm";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { SignJWT, createRemoteJWKSet, exportJWK, generateKeyPair } from "jose";
import { createJwtVerifier, fetchAuthorizationServer } from "../src/auth.ts";
import { createFactoryData } from "../src/data.ts";
import { createRemoteApp, type RemoteApp } from "../src/remote.ts";
import { startFakeFrm, type FakeFrm } from "./fake-frm.ts";

type Key = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

const ALLOWED = "user_allowed";
const KEY_ID = "test-key";

let frm: FakeFrm;
let issuerServer: Server;
let issuer: string;
let privateKey: Key;
let app: RemoteApp;
let mcpServer: Server;
let publicUrl: URL;
const logs: string[] = [];

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );

before(async () => {
  frm = await startFakeFrm();

  // Fake authorization server: its metadata (RFC 8414) and its public key.
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] };
  issuerServer = createServer((request, response) => {
    const body =
      request.url === "/.well-known/oauth-authorization-server"
        ? {
            issuer,
            authorization_endpoint: `${issuer}/oauth2/authorize`,
            token_endpoint: `${issuer}/oauth2/token`,
            registration_endpoint: `${issuer}/oauth2/register`,
            jwks_uri: `${issuer}/oauth2/jwks`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          }
        : request.url === "/oauth2/jwks"
          ? jwks
          : undefined;
    response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body ?? {}));
  });
  issuer = await listen(issuerServer);

  // The remote server, on a free port: its public URL is its local address.
  mcpServer = createServer();
  const address = await listen(mcpServer);
  publicUrl = new URL(`${address}/mcp`);
  const authorizationServer = await fetchAuthorizationServer(new URL(issuer));
  app = createRemoteApp({
    data: createFactoryData(createFrmReader({ url: frm.url }), 0),
    publicUrl,
    authorizationServer,
    verifier: createJwtVerifier({
      issuer: authorizationServer.issuer,
      audience: publicUrl,
      keys: createRemoteJWKSet(new URL(authorizationServer.jwks_uri)),
    }),
    allowedUsers: new Set([ALLOWED]),
    log: (line) => logs.push(line),
  });
  const handler = toNodeHandler(app);
  mcpServer.on("request", (request, response) => void handler(request, response));
});

after(async () => {
  await app.close();
  mcpServer.closeAllConnections();
  mcpServer.close();
  issuerServer.closeAllConnections();
  issuerServer.close();
  await frm.close();
});

/** An access token as the authorization server would sign it, with what each test changes. */
async function token(
  changes: { subject?: string; audience?: string; issuer?: string; expires?: string | number; key?: Key } = {},
): Promise<string> {
  return new SignJWT({ scope: "openid profile" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(changes.issuer ?? issuer)
    .setAudience(changes.audience ?? publicUrl.href)
    .setSubject(changes.subject ?? ALLOWED)
    .setIssuedAt()
    .setExpirationTime(changes.expires ?? "5m")
    .sign(changes.key ?? privateKey);
}

/** A JSON-RPC call to the endpoint, with or without a token. */
function callMcp(bearer?: string): Promise<Response> {
  return fetch(publicUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(bearer && { Authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

test("health check, without a token", async () => {
  const response = await fetch(new URL("/health", publicUrl));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok\n");
});

test("no token: 401 with the challenge that tells Claude where to sign in", async () => {
  const response = await callMcp();
  assert.equal(response.status, 401);
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /^Bearer /);
  assert.ok(challenge.includes(`resource_metadata="${publicUrl.origin}/.well-known/oauth-protected-resource/mcp"`), challenge);
});

test("discovery: protected resource metadata, and the authorization server's metadata", async () => {
  const resource = await (await fetch(new URL("/.well-known/oauth-protected-resource/mcp", publicUrl))).json();
  assert.equal(resource.resource, publicUrl.href);
  assert.deepEqual(resource.authorization_servers, [issuer]);
  const server = await (await fetch(new URL("/.well-known/oauth-authorization-server", publicUrl))).json();
  assert.equal(server.issuer, issuer);
  assert.equal(server.jwks_uri, `${issuer}/oauth2/jwks`);
});

test("a valid token of an allowed user: the MCP client works", async () => {
  const client = new Client({ name: "lulusia-tests", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(
    new StreamableHTTPClientTransport(publicUrl, { requestInit: { headers: { Authorization: `Bearer ${await token()}` } } }),
  );
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 6);
    const result = await client.callTool({ name: "power", arguments: {} });
    assert.ok(!result.isError);
  } finally {
    await client.close();
  }
  assert.ok(logs.some((line) => /^POST \/mcp 200 user_allowed \d+ ms$/.test(line)), logs.join("\n"));
});

test("tokens refused with 401: other audience, other issuer, expired, forged, garbage", async () => {
  const forger = await generateKeyPair("RS256");
  const refused = {
    "another server": await token({ audience: "https://elsewhere.example/mcp" }),
    "another issuer": await token({ issuer: "https://evil.example" }),
    expired: await token({ expires: Math.floor(Date.now() / 1000) - 60 }),
    "signed with another key": await token({ key: forger.privateKey }),
    "not a JWT": "not-a-token",
  };
  for (const [reason, bearer] of Object.entries(refused)) {
    const response = await callMcp(bearer);
    assert.equal(response.status, 401, reason);
    assert.match(response.headers.get("www-authenticate") ?? "", /invalid_token/, reason);
  }
});

test("a valid token of a user who is not on the allowlist: 403", async () => {
  const response = await callMcp(await token({ subject: "user_stranger" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "access_denied",
    error_description: "This account is not allowed on this server.",
  });
  assert.ok(logs.some((line) => line.startsWith("POST /mcp 403 user_stranger")));
});

test("another Host header is refused, an unknown path is 404", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(new URL("/health", publicUrl), { headers: { Host: "attacker.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 403);
  assert.equal((await fetch(new URL("/admin", publicUrl))).status, 404);
});

test("startup refuses an authorization server that does not match OAUTH_ISSUER", async () => {
  await assert.rejects(fetchAuthorizationServer(new URL("http://localhost:1")), /fetch failed|ECONNREFUSED/);
  const wrong = new URL(issuer.replace("127.0.0.1", "localhost"));
  await assert.rejects(fetchAuthorizationServer(wrong), /issuer is http:\/\/127\.0\.0\.1:\d+, expected http:\/\/localhost/);
});
