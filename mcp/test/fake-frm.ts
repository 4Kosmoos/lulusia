// A fake FRM on a local port, answering with the fixtures: an anonymized extract of the real factory
// (see scripts/make-fixtures.ts).

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const ENDPOINTS = ["getSessionInfo", "getPlayer", "getPower", "getProdStats", "getWorldInv", "getCloudInv", "getFactory"];

export interface FakeFrm {
  url: string;
  /** Every request received, as "GET /getPower". */
  requests: string[];
  /** When true, answers like FRM after its known bug (#313): an error on every endpoint. */
  down: boolean;
  close(): Promise<void>;
}

export async function startFakeFrm(): Promise<FakeFrm> {
  const answers = new Map(
    ENDPOINTS.map((endpoint) => [`/${endpoint}`, readFileSync(new URL(`fixtures/${endpoint}.json`, import.meta.url), "utf8")]),
  );
  const server = createServer((request, response) => {
    fake.requests.push(`${request.method} ${request.url}`);
    const body = fake.down ? undefined : answers.get(request.url ?? "");
    response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    response.end(body ?? JSON.stringify({ error: "No matching endpoint found." }));
  });
  const fake: FakeFrm = {
    url: "",
    requests: [],
    down: false,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
