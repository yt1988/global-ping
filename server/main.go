// 1ms-ping: Global Ping's server, the Tokyo view. One program on one machine, listening on one TLS port.
//
// It sends 16 ICMP echo requests to one address a visitor asks about, 0.5 s apart, and reports each packet's round
// trip time and TTL, with which packets got no reply. It is a second view for the page (Global Ping's worldwide view
// comes from Globalping's probes): it uses none of Globalping's allowance, it always knows the real loss positions,
// and comparing it with Globalping's Tokyo probe shows whether the two networks see the same path.
//
// It is reachable directly (DNS only, no proxy in front), so its own limits are the only guard against being used to
// probe others: one address per request, never a private, reserved or own address, a few checks per visitor and per
// target an hour, a cap for the whole site, and a short concurrency limit. It keeps nothing: no access log, and the
// counters (visitors as a keyed hash of their IP) live in memory for an hour.
//
//	GET /v1/ping?host=<domain or IP>&v=4|6        → JSON (see Result)
//	GET /healthz                                  → "ok"
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const packets = 16 // Globalping's maximum, and what the page shows for every region

// Result is one row for the page. A failed request sets OK=false and K names why (bad, private, dns, limit, busy,
// fail); the page has a sentence for each.
type Result struct {
	OK      bool     `json:"ok"`
	K       string   `json:"k,omitempty"`
	Retry   int      `json:"retry,omitempty"` // seconds, for limit and busy
	Host    string   `json:"host,omitempty"`
	IP      string   `json:"ip,omitempty"`
	Family  int      `json:"family,omitempty"`
	Sent    int      `json:"sent,omitempty"`
	Rcv     int      `json:"rcv,omitempty"`
	Timings []Timing `json:"timings,omitempty"`
}

func main() {
	cred := os.Getenv("CREDENTIALS_DIRECTORY") // systemd LoadCredential=
	addr := flag.String("addr", ":2097", "listen address")
	cert := flag.String("cert", filepath.Join(cred, "fullchain.pem"), "certificate chain (PEM)")
	key := flag.String("key", filepath.Join(cred, "privkey.pem"), "private key (PEM)")
	plain := flag.Bool("plain", false, "serve plain HTTP (local testing only)")
	self := flag.String("self", "", "this machine's public addresses behind NAT, comma separated: never probed")
	origin := flag.String("origin", "https://ping.1ms.dog", "the page's origin(s) that may read the answer, comma separated")
	flag.Parse()
	log.SetFlags(0)

	for _, s := range strings.Split(*self, ",") {
		if a, err := netip.ParseAddr(strings.TrimSpace(s)); err == nil {
			selfAddrs[a.Unmap()] = true
		}
	}
	if ifs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range ifs {
			if p, err := netip.ParsePrefix(a.String()); err == nil {
				selfAddrs[p.Addr().Unmap()] = true
			}
		}
	}

	origins := map[string]bool{}
	for _, o := range strings.Split(*origin, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins[o] = true
		}
	}

	srv := &http.Server{
		Addr: *addr, Handler: handler(newLimits(time.Now), ping, resolve, origins),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 8 << 10,
		ErrorLog:       log.New(discard{}, "", 0), // TLS handshake noise from scanners is not worth a log line
	}
	if *plain {
		log.Fatal(srv.ListenAndServe())
	}
	srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	log.Fatal(srv.ListenAndServeTLS(*cert, *key))
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// The page that may read answers from a visitor's browser; anything else gets them without CORS headers. Localhost is
// always allowed, so the page can be worked on locally.
func allowedOrigin(o string, origins map[string]bool) bool {
	if origins[o] {
		return true
	}
	u := strings.TrimPrefix(o, "http://")
	h, _, _ := strings.Cut(u, ":")
	return u != o && (h == "localhost" || h == "127.0.0.1")
}

type resolveFunc func(ctx context.Context, host, ipv string) ([]netip.Addr, error)

func handler(lim *limits, ping pingerFunc, resolve resolveFunc, origins map[string]bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /v1/ping", func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && allowedOrigin(o, origins) {
			w.Header().Set("Access-Control-Allow-Origin", o)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		res, status := servePing(r, lim, ping, resolve)
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(res)
	})
	return mux
}

func servePing(r *http.Request, lim *limits, ping pingerFunc, resolve resolveFunc) (*Result, int) {
	q := r.URL.Query()
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(q.Get("host"))), ".")
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	ipv := q.Get("v")
	if !validHost(host) || (ipv != "" && ipv != "4" && ipv != "6") {
		return &Result{K: "bad"}, http.StatusBadRequest
	}

	visitor := visitorKey(r.RemoteAddr)
	if which, retry := lim.visit(visitor); which != "" {
		return &Result{K: "limit", Retry: retry}, http.StatusTooManyRequests
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	addrs, err := resolve(ctx, host, ipv)
	if err != nil || len(addrs) == 0 {
		return &Result{K: "dns"}, http.StatusOK
	}
	var pick netip.Addr
	for _, a := range addrs {
		if ipv == "4" && !a.Is4() || ipv == "6" && !a.Is6() {
			continue
		}
		if addrKind(a) == "public" {
			pick = a
			break
		}
	}
	if !pick.IsValid() {
		return &Result{K: "private"}, http.StatusOK // never sent a packet
	}
	if which, retry := lim.dest(pick); which != "" {
		return &Result{K: "limit", Retry: retry}, http.StatusTooManyRequests
	}
	if !lim.enter(visitor) {
		return &Result{K: "busy", Retry: retryWhenBusy}, http.StatusTooManyRequests
	}
	defer lim.leave(visitor)

	timings, err := ping(ctx, pick, packets)
	if err != nil {
		return &Result{K: "fail"}, http.StatusOK
	}
	family, rcv := 4, 0
	if pick.Is6() {
		family = 6
	}
	for _, t := range timings {
		if t.RTT != nil {
			rcv++
		}
	}
	return &Result{OK: true, Host: host, IP: pick.String(), Family: family, Sent: len(timings), Rcv: rcv, Timings: timings}, http.StatusOK
}
