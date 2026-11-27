// Our own servers behind the "our server" rows come from the shell's injected meta, not from this repository:
//   <meta name="ms-servers" content="reach=…;ping=tyo@https://<tokyo>:2097,sha@https://…,lax@https://…;dns=…">
// Each entry is named by its city, so the rows follow the meta rather than a fixed pair. With no meta — self-hosted,
// or before the shell injects it — there are no server rows and the worldwide view keeps working. Nothing here calls
// 1ms.dog's servers on its own. docs/tool-contract.md §2 has the meta's rules; src/egress.js is the shared parser.
import { endpoints, servers } from "./egress.js";

// a city we know is a row with its own name; an entry without one is from an older injection (Tokyo, then Shanghai)
const CITIES = { lax: "losangeles", nue: "nuremberg", tyo: "tokyo", sha: "shanghai" };
const OLD = ["tokyo", "shanghai"];
const apiOf = u => /\/v1\/ping\/?$/.test(u) ? u.replace(/\/+$/, "") : u.replace(/\/+$/, "") + "/v1/ping";

export const SERVERS = servers(endpoints("ms-servers").ping)
  .map((s, i) => ({ key: CITIES[s.city] || (s.city ? "" : OLD[i] || ""), api: apiOf(s.url) }))
  .filter(s => s.key);
