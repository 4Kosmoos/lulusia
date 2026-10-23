// The real entry point, launched like Claude launches it: a child process spoken to over stdio, with the
// 2025 protocol handshake that hosts use today, and only a minimal environment plus FRM_URL.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { startFakeFrm } from "./fake-frm.ts";

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const NODE_ARGS = ["--disable-warning=ExperimentalWarning", ENTRY];

test("over stdio: handshake, a tool call, and nothing but protocol on stdout", async () => {
  const frm = await startFakeFrm();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: NODE_ARGS,
    env: { ...getDefaultEnvironment(), FRM_URL: frm.url },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  // A line on stdout that is not JSON-RPC would break the connection: the client would fail below.
  const client = new Client({ name: "lulusia-tests", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "lulusia");
    const result = await client.callTool({ name: "power", arguments: {} });
    assert.ok(!result.isError);
    assert.equal((result.structuredContent as { total: { capacityMW: number } }).total.capacityMW, 8100);
  } finally {
    await client.close();
    await frm.close();
  }
  assert.match(stderr, /Lulusia MCP server .+ ready, reading FRM at http:\/\/127\.0\.0\.1:\d+/);
});

test("without FRM_URL, it stops at once with a clear message", () => {
  const run = spawnSync(process.execPath, NODE_ARGS, { env: getDefaultEnvironment(), encoding: "utf8", timeout: 20_000 });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Missing environment variable FRM_URL/);
});
