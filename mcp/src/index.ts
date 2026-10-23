// Entry point: Claude (the desktop app, or Claude Code) launches this process and talks to it over
// stdin and stdout. stdout is the protocol channel: everything else goes to stderr.
//
// Configuration: FRM_URL, the address of FRM's web server (from the PC, through Tailscale).
// No FRM token: the server only reads, with a client that has no write method at all.

import { createFrmReader } from "@lulusia/lib/frm";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFactoryData } from "./data.ts";
import { VERSION, createServer } from "./server.ts";

const url = process.env.FRM_URL?.trim();
if (!url) {
  console.error("Missing environment variable FRM_URL: the address of FRM, like http://lulusia.<tailnet>.ts.net:8080");
  process.exit(1);
}

// FRM is reached over Tailscale and getFactory is large: more time than the bot's 5 s on the server.
const data = createFactoryData(createFrmReader({ url, timeoutMs: 15_000 }));
serveStdio(() => createServer(data));
console.error(`Lulusia MCP server ${VERSION} ready, reading FRM at ${url}`);
