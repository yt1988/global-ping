// Our own servers behind the "our server" rows. They answer the same question as Globalping's probes and use none of
// its allowance. Self-hosted: point them at your own server(s) or use an empty array — then the page shows no server
// rows at all and the worldwide view keeps working (nothing silently calls 1ms.dog's servers). The server is in server/.
export const SERVERS = [
  { key: "tokyo", api: "https://ping-api.1ms.dog:2097/v1/ping" },
  { key: "shanghai", api: "https://ping-api.dog.1msapp.com:2097/v1/ping" },
];
