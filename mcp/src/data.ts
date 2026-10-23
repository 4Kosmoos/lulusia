// The factory data the tools read, behind a short cache: one answer from Claude often calls several
// tools in a row, and they would otherwise ask FRM for the same data each time.

import { cached } from "@lulusia/lib/cache";
import type { FrmReader, Machine, Player, PowerCircuit, SessionInfo } from "@lulusia/lib/frm";
import { loadInventory, type Inventory } from "@lulusia/lib/inventory";

export interface FactoryData {
  session(): Promise<SessionInfo>;
  players(): Promise<Player[]>;
  power(): Promise<PowerCircuit[]>;
  inventory(): Promise<Inventory>;
  machines(): Promise<Machine[]>;
}

/** Data read through `frm`, kept `ttlMs` (data at most that old). */
export function createFactoryData(frm: FrmReader, ttlMs = 10_000): FactoryData {
  return {
    session: cached(() => frm.sessionInfo(), ttlMs),
    players: cached(() => frm.players(), ttlMs),
    power: cached(() => frm.power(), ttlMs),
    inventory: cached(() => loadInventory(frm), ttlMs),
    machines: cached(() => frm.machines(), ttlMs),
  };
}
