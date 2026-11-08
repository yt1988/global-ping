// The only deployment-specific address in the page's code: where the Tokyo view comes from.
//
// Self-hosted, change it to your own server, or set it to "" — then the page shows no Tokyo row at all and the
// worldwide view keeps working (nothing silently calls 1ms.dog's server). The server itself is in server/.
export const TOKYO_API = "https://ping-api.1ms.dog:2097/v1/ping";
