// Our own servers behind the "our server" rows come from the shell's injected meta, not from this repository:
//   <meta name="ms-servers" content="reach=…;ping=https://<tokyo>:2097,https://<shanghai>:2097;dns=…">
// The list's order is the display order (Tokyo first, Shanghai second). With no meta — self-hosted, or before the
// shell injects it — there are no server rows and the worldwide view keeps working. Nothing here calls 1ms.dog's
// servers on its own. docs/tool-contract.md §2 has the meta's rules; src/egress.js is the shared parser.
import { endpoints } from "./egress.js";

const KEYS = ["tokyo", "shanghai"];
const apiOf = u => /\/v1\/ping\/?$/.test(u) ? u.replace(/\/+$/, "") : u.replace(/\/+$/, "") + "/v1/ping";

export const SERVERS = String(endpoints("ms-servers").ping || "")
  .split(",").map(s => s.trim()).filter(Boolean).slice(0, KEYS.length)
  .map((api, i) => ({ key: KEYS[i], api: apiOf(api) }));
