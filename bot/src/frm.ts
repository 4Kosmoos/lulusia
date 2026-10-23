// The bot's FRM client: reads and writes (chat, pings, switches, machines), with the token from .env.
// The client itself, its types and FrmError are in @lulusia/lib/frm.

import { createFrmClient } from "@lulusia/lib/frm";
import { config } from "./config.ts";

export const frm = createFrmClient({ url: config.frmUrl, token: config.frmToken });
