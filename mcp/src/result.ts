// Tool results: structured data (checked by the SDK against the tool's output schema), and the same data
// as JSON text, which is what the model reads.

import { FrmError } from "@lulusia/lib/frm";
import type { CallToolResult } from "@modelcontextprotocol/server";

export function ok(output: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

/** A failure the model reads and can act on: say what went wrong and what to do next. */
export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs a tool. FRM not answering becomes a tool error that explains the likely cause. */
export async function withFrm(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof FrmError)) throw error;
    return fail(
      `${error.message}. The game server's API (FRM) did not answer: the server is probably restarting ` +
        "(after a known FRM bug, it restarts on its own within 10 minutes). Try again in a few minutes.",
    );
  }
}

/** One decimal: enough for rates and power, and lighter to read. */
export const round = (value: number): number => Math.round(value * 10) / 10;

/** Read-only, no side effect, closed world: hosts may run these tools without asking. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
