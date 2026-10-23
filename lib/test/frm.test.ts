// FRM client against a fake FRM server (a local HTTP server).

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { FrmError, createFrmClient, createFrmReader } from "../src/frm.ts";

interface Received {
  method?: string;
  url?: string;
  token?: string;
  body: string;
}

const received: Received[] = [];
let url = "";

/** Fake FRM: a few endpoints, with the answers FRM gives. */
function handle(request: IncomingMessage, response: ServerResponse, body: string): void {
  received.push({
    method: request.method,
    url: request.url,
    token: request.headers["x-frm-authorization"] as string | undefined,
    body,
  });
  const json = (status: number, payload: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  switch (request.url) {
    case "/getSessionInfo":
      return json(200, { SessionName: "Test session", IsPaused: false });
    case "/getPower":
      // What FRM answers after a game reload in the same process (FRM issue #313).
      return json(404, { error: "No matching endpoint found." });
    case "/getPlayer":
      return; // never answers
    case "/sendChatMessage":
      return json(200, [{ IsSent: true }]);
    case "/setSwitches":
      // One result per switch; the second one was demolished in the meantime.
      return json(200, [{ ID: "Sw_1", Status: false }, { error: "Power Switch not found.", ID: "Sw_2" }]);
    case "/createPing":
      return json(200, [{ error: "No player online." }]);
    default:
      return json(500, "not JSON with an error field");
  }
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => handle(request, response, body));
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test("reads an endpoint, with or without a trailing slash in the URL", async () => {
  const reader = createFrmReader({ url });
  assert.deepEqual(await reader.sessionInfo(), { SessionName: "Test session", IsPaused: false });
  assert.equal(received.at(-1)?.url, "/getSessionInfo");
  assert.equal(received.at(-1)?.method, "GET");
});

test("the reader has no write method at all", () => {
  const reader = createFrmReader({ url });
  for (const method of ["sendChatMessage", "createPing", "setSwitches", "setMachines"]) {
    assert.equal(method in reader, false, method);
  }
});

test("FRM's 'No matching endpoint' error comes with a hint about the known bug", async () => {
  const reader = createFrmReader({ url });
  await assert.rejects(reader.power(), (error: unknown) => {
    assert.ok(error instanceof FrmError);
    assert.match(error.message, /^getPower: No matching endpoint found\. \(known FRM bug/);
    return true;
  });
});

test("an answer that is not an FRM error still gives the HTTP status", async () => {
  const reader = createFrmReader({ url });
  await assert.rejects(reader.switches(), { message: "getSwitches: HTTP 500" });
});

test("FRM too slow: FrmError after the timeout", async () => {
  const reader = createFrmReader({ url, timeoutMs: 200 });
  await assert.rejects(reader.players(), (error: unknown) => {
    assert.ok(error instanceof FrmError);
    assert.equal(error.message, "FRM unreachable (getPlayer)");
    return true;
  });
});

test("FRM down: FrmError, with the network error as cause", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  closed.close();
  const reader = createFrmReader({ url: `http://127.0.0.1:${port}` });
  await assert.rejects(reader.sessionInfo(), (error: unknown) => {
    assert.ok(error instanceof FrmError);
    assert.equal(error.message, "FRM unreachable (getSessionInfo)");
    assert.ok(error.cause);
    return true;
  });
});

test("writes without a token fail before anything is sent", async () => {
  const client = createFrmClient({ url });
  const count = received.length;
  await assert.rejects(client.sendChatMessage("Bot", "hello"), /FRM token missing \(FRM_TOKEN\): cannot call sendChatMessage/);
  assert.equal(received.length, count);
});

test("chat messages are sent with the token, as pure ASCII JSON (FRM issue #314)", async () => {
  const client = createFrmClient({ url, token: "secret" });
  await client.sendChatMessage("Bot", "Café à 5 €");
  const request = received.at(-1);
  assert.equal(request?.method, "POST");
  assert.equal(request?.token, "secret");
  assert.equal(request?.body, String.raw`{"sender":"Bot","message":"Caf\u00e9 \u00e0 5 \u20ac"}`);
  assert.deepEqual(JSON.parse(request?.body ?? ""), { sender: "Bot", message: "Café à 5 €" });
});

test("switches: the IDs changed and those that failed", async () => {
  const client = createFrmClient({ url, token: "secret" });
  assert.deepEqual(await client.setSwitches(["Sw_1", "Sw_2"], false), { changed: ["Sw_1"], failed: ["Sw_2"] });
  assert.deepEqual(JSON.parse(received.at(-1)?.body ?? ""), [
    { ID: "Sw_1", status: false },
    { ID: "Sw_2", status: false },
  ]);
});

test("switches: nothing to change, no request", async () => {
  const client = createFrmClient({ url, token: "secret" });
  const count = received.length;
  assert.deepEqual(await client.setSwitches([], true), { changed: [], failed: [] });
  assert.equal(received.length, count);
});

test("an error in the results of a write is an FrmError", async () => {
  const client = createFrmClient({ url, token: "secret" });
  await assert.rejects(client.createPing({ x: 1, y: 2, z: 3 }), { message: "createPing: No player online." });
});
