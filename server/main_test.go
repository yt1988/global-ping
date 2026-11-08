package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const pageOrigin = "https://ping.1ms.dog"

func timings(n int, lost ...int) []Timing {
	skip := map[int]bool{}
	for _, i := range lost {
		skip[i] = true
	}
	out := make([]Timing, n)
	for i := range out {
		out[i] = Timing{I: i + 1}
		if !skip[i] {
			rtt := 10 + float64(i)
			ttl := 50
			out[i].RTT = &rtt
			out[i].TTL = &ttl
		}
	}
	return out
}

func pingTo(want netip.Addr, calls *atomic.Int32) pingerFunc {
	return func(ctx context.Context, addr netip.Addr, n int) ([]Timing, error) {
		if calls != nil {
			calls.Add(1)
		}
		if want.IsValid() && addr != want {
			return nil, fmt.Errorf("pinged %s, wanted %s", addr, want)
		}
		return timings(n), nil
	}
}

func resolveMap(m map[string][]string) resolveFunc {
	return func(ctx context.Context, host, ipv string) ([]netip.Addr, error) {
		if strings.HasSuffix(host, ".invalid") {
			return nil, fmt.Errorf("no such host")
		}
		ss := []string{"1.1.1.1"}
		if v, ok := m[host]; ok {
			ss = v
		}
		out := make([]netip.Addr, 0, len(ss))
		for _, s := range ss {
			out = append(out, netip.MustParseAddr(s))
		}
		return out, nil
	}
}

func newTestServer(t *testing.T, ping pingerFunc, resolve resolveFunc) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(handler(newLimits(time.Now), ping, resolve, map[string]bool{pageOrigin: true}))
	t.Cleanup(s.Close)
	return s
}

func get(t *testing.T, url string, header ...string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func decode(t *testing.T, res *http.Response) Result {
	t.Helper()
	var r Result
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestHealthz(t *testing.T) {
	s := newTestServer(t, pingTo(netip.Addr{}, nil), resolveMap(nil))
	res := get(t, s.URL+"/healthz")
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	b, _ := io.ReadAll(res.Body)
	if strings.TrimSpace(string(b)) != "ok" {
		t.Fatalf("body %q", b)
	}
}

func TestBadInput(t *testing.T) {
	s := newTestServer(t, pingTo(netip.Addr{}, nil), resolveMap(nil))
	for _, q := range []string{"/v1/ping", "/v1/ping?host=bad%20host", "/v1/ping?host=example.com&v=5", "/v1/ping?host="} {
		res := get(t, s.URL+q)
		if res.StatusCode != 400 {
			t.Fatalf("%s: status %d", q, res.StatusCode)
		}
		if r := decode(t, res); r.K != "bad" {
			t.Fatalf("%s: k %q", q, r.K)
		}
	}
}

func TestPrivateAndDNSNeverPing(t *testing.T) {
	var calls atomic.Int32
	s := newTestServer(t, pingTo(netip.Addr{}, &calls), resolveMap(map[string][]string{"priv.example": {"10.0.0.5"}}))
	res := get(t, s.URL+"/v1/ping?host=priv.example&v=4")
	if res.StatusCode != 200 {
		t.Fatalf("private: status %d", res.StatusCode)
	}
	if r := decode(t, res); r.K != "private" || r.OK {
		t.Fatalf("private: %+v", r)
	}
	res = get(t, s.URL+"/v1/ping?host=nx.invalid&v=4")
	if r := decode(t, res); r.K != "dns" {
		t.Fatalf("dns: %+v", r)
	}
	if calls.Load() != 0 {
		t.Fatalf("pinged %d times for addresses that must never be pinged", calls.Load())
	}
}

func TestSuccessAndCORS(t *testing.T) {
	want := netip.MustParseAddr("9.9.9.9")
	s := newTestServer(t, pingTo(want, nil), resolveMap(map[string][]string{"one.example": {"9.9.9.9"}}))
	res := get(t, s.URL+"/v1/ping?host=one.example&v=4", "Origin", pageOrigin)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != pageOrigin {
		t.Fatalf("CORS %q", got)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("cache-control %q", cc)
	}
	r := decode(t, res)
	if !r.OK || r.Family != 4 || r.Sent != 16 || r.Rcv != 16 || len(r.Timings) != 16 {
		t.Fatalf("%+v", r)
	}
	if r.IP != "9.9.9.9" || r.Timings[0].I != 1 || r.Timings[0].RTT == nil || r.Timings[0].TTL == nil {
		t.Fatalf("wild rows: %+v", r.Timings[0])
	}
	res = get(t, s.URL+"/v1/ping?host=one.example&v=4", "Origin", "https://evil.example")
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unknown origin echoed: %q", got)
	}
}

func TestFamilyIsChosen(t *testing.T) {
	v6 := netip.MustParseAddr("2606:4700::1111")
	var calls atomic.Int32
	s := newTestServer(t, pingTo(v6, &calls), resolveMap(map[string][]string{"dual.example": {"1.1.1.1", "2606:4700::1111"}}))
	r := decode(t, get(t, s.URL+"/v1/ping?host=dual.example&v=6"))
	if !r.OK || r.Family != 6 {
		t.Fatalf("%+v", r)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls %d", calls.Load())
	}
}

func TestLostPacketsAreNull(t *testing.T) {
	ping := func(ctx context.Context, addr netip.Addr, n int) ([]Timing, error) { return timings(n, 7), nil }
	s := newTestServer(t, ping, resolveMap(nil))
	r := decode(t, get(t, s.URL+"/v1/ping?host=1.1.1.1&v=4"))
	if r.Rcv != 15 || r.Timings[7].RTT != nil || r.Timings[7].I != 8 {
		t.Fatalf("rcv %d, row %+v", r.Rcv, r.Timings[7])
	}
}

func TestVisitorLimit(t *testing.T) {
	s := newTestServer(t, pingTo(netip.Addr{}, nil), resolveMap(nil))
	for i := 0; i < perVisitor; i++ {
		res := get(t, s.URL+"/v1/ping?host=1.1.1.1&v=4")
		r := decode(t, res)
		if res.StatusCode != 200 || !r.OK {
			t.Fatalf("request %d: %d %+v", i+1, res.StatusCode, r)
		}
	}
	res := get(t, s.URL+"/v1/ping?host=1.1.1.1&v=4")
	last := decode(t, res)
	if res.StatusCode != 429 || last.K != "limit" || last.Retry <= 0 {
		t.Fatalf("after %d: %d %+v", perVisitor, res.StatusCode, last)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	s := newTestServer(t, pingTo(netip.Addr{}, nil), resolveMap(nil))
	req, _ := http.NewRequest("POST", s.URL+"/v1/ping?host=1.1.1.1&v=4", nil)
	post, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer post.Body.Close()
	if post.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST status %d", post.StatusCode)
	}
}

func TestLimitsUnit(t *testing.T) {
	now := time.Unix(0, 0)
	lim := newLimits(func() time.Time { return now })
	key := uint64(42)
	for i := 0; i < perVisitor; i++ {
		if which, _ := lim.visit(key); which != "" {
			t.Fatalf("visit %d limited: %s", i+1, which)
		}
	}
	if which, retry := lim.visit(key); which != "visitor" || retry <= 0 {
		t.Fatalf("visitor limit: %q %d", which, retry)
	}
	other := uint64(43)
	if which, _ := lim.visit(other); which != "" {
		t.Fatalf("first visit of the second visitor: %s", which)
	}
	addr := netip.MustParseAddr("9.9.9.9")
	for i := 0; i < perTarget; i++ {
		if which, _ := lim.dest(addr); which != "" {
			t.Fatalf("dest %d limited: %s", i+1, which)
		}
	}
	if which, _ := lim.dest(addr); which != "target" {
		t.Fatalf("target limit: %q", which)
	}
	if !lim.enter(other) || !lim.enter(other) {
		t.Fatal("visitor concurrency should allow 2")
	}
	if lim.enter(other) {
		t.Fatal("visitor concurrency should stop at 2")
	}
	lim.leave(other)
	if !lim.enter(other) {
		t.Fatal("a slot should free up")
	}
	lim.leave(other)
	lim.leave(other)
	now = now.Add(time.Hour + time.Minute)
	if which, _ := lim.visit(key); which != "" {
		t.Fatalf("after an hour: %s", which)
	}
}

func TestVisitorKeyHidesAddresses(t *testing.T) {
	a := visitorKey("[2606:4700::1111]:443")
	b := visitorKey("[2606:4700::2222]:443") // same /64: one subscriber
	c := visitorKey("1.1.1.1:443")
	d := visitorKey("8.8.8.8:443")
	if a == 0 || c == 0 || d == 0 {
		t.Fatal("keys must be non-zero")
	}
	if a != b {
		t.Fatal("same /64 should count as one visitor")
	}
	if c == d {
		t.Fatal("different addresses should differ")
	}
}

func TestAddrKind(t *testing.T) {
	for _, s := range []string{"10.0.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "fd00:ec2::254", "::1", "fe80::1", "2001:db8::1", "224.0.0.1"} {
		if k := addrKind(netip.MustParseAddr(s)); k == "public" {
			t.Errorf("%s should not be public", s)
		}
	}
	for _, s := range []string{"1.1.1.1", "8.8.8.8", "2606:4700::1111"} {
		if k := addrKind(netip.MustParseAddr(s)); k != "public" {
			t.Errorf("%s should be public, got %s", s, k)
		}
	}
}

func TestValidHost(t *testing.T) {
	for _, h := range []string{"example.com", "a-b.example.com", "_dmarc.example.com", "1.1.1.1", "2606:4700::1111"} {
		if !validHost(h) {
			t.Errorf("%q should be valid", h)
		}
	}
	for _, h := range []string{"", "localhost", "example", "a..b", "-a.example", "a b.com", strings.Repeat("x", 254)} {
		if validHost(h) {
			t.Errorf("%q should be invalid", h)
		}
	}
}
