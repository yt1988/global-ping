package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"context"
	"encoding/json"
	"net/http"
	"net/netip"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func token(secret, scope string, exp int64) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("v1|" + strconv.FormatInt(exp, 10) + "|n0nce|" + scope))
	return "v1." + strconv.FormatInt(exp, 10) + ".n0nce." + scope + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func TestCheckAuth(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	future, past := now.Unix()+300, now.Unix()-1
	cases := []struct {
		name   string
		secret string
		header string
		wantOK bool
		want   string
	}{
		{"no secret lets everything through", "", "", true, ""},
		{"secret, no header", "s3cret", "", false, "no_token"},
		{"secret, wrong scheme", "s3cret", "Basic abc", false, "no_token"},
		{"expired", "s3cret", "Bearer " + token("s3cret", "ping", past), false, "bad_token"},
		{"wrong scope", "s3cret", "Bearer " + token("s3cret", "reach", future), false, "bad_token"},
		{"empty scope", "s3cret", "Bearer v1." + strconv.FormatInt(future, 10) + ".n0nce..abc", false, "bad_token"},
		{"scope with spaces", "s3cret", "Bearer " + token("s3cret", "reach, ping", future), true, ""},
		{"tampered scope", "s3cret", "Bearer " + strings.Replace(token("s3cret", "reach", future), ".reach.", ".ping.", 1), false, "bad_token"},
		{"wrong secret", "s3cret", "Bearer " + token("other", "ping", future), false, "bad_token"},
		{"ping scope", "s3cret", "Bearer " + token("s3cret", "ping", future), true, ""},
		{"page token (all scopes)", "s3cret", "Bearer " + token("s3cret", "probe,reach,ping,rtc,ipv6,seg,dns,data", future), true, ""},
		{"service token", "s3cret", "Bearer " + token("s3cret", "*", future), true, ""},
		{"garbage", "s3cret", "Bearer v1.x.y.z", false, "bad_token"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, ok := checkAuth(c.secret, c.header, now)
			if ok != c.wantOK || code != c.want {
				t.Fatalf("got (%q, %v), want (%q, %v)", code, ok, c.want, c.wantOK)
			}
		})
	}
}

func TestHandlerAuth(t *testing.T) {
	now := time.Now().Unix()
	probe := "/v1/ping?host=192.168.1.1&v=4" // a private address: refused without connecting, so no ping is needed
	privateResolve := func(ctx context.Context, host, ipv string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("192.168.1.1")}, nil
	}

	t.Run("no secret: request passes without a token", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "")
		rr := httptest.NewRecorder()
		handler(newLimits(time.Now), pingTo(netip.Addr{}, nil), privateResolve, map[string]bool{pageOrigin: true}).ServeHTTP(rr, httptest.NewRequest("GET", probe, nil))
		if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"private"`) {
			t.Fatalf("status %d body %s, want 200 with private", rr.Code, rr.Body.String())
		}
	})

	t.Run("secret: no token is 401 no_token, healthz still answers", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "s3cret")
		h := handler(newLimits(time.Now), pingTo(netip.Addr{}, nil), privateResolve, map[string]bool{pageOrigin: true})
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", probe, nil))
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, want 401", rr.Code)
		}
		var body map[string]string
		json.NewDecoder(rr.Body).Decode(&body)
		if body["error"] != "no_token" {
			t.Fatalf("error %q, want no_token", body["error"])
		}
		rr = httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", "/healthz", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("healthz status %d, want 200", rr.Code)
		}
	})

	t.Run("secret: a valid token passes to the handler (limits still apply)", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "s3cret")
		req := httptest.NewRequest("GET", probe, nil)
		req.Header.Set("Authorization", "Bearer "+token("s3cret", "ping", now+300))
		rr := httptest.NewRecorder()
		handler(newLimits(time.Now), pingTo(netip.Addr{}, nil), privateResolve, map[string]bool{pageOrigin: true}).ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d, want 200", rr.Code)
		}
	})

	t.Run("secret: a reach token is 401 bad_token", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "s3cret")
		req := httptest.NewRequest("GET", probe, nil)
		req.Header.Set("Authorization", "Bearer "+token("s3cret", "reach", now+300))
		rr := httptest.NewRecorder()
		handler(newLimits(time.Now), pingTo(netip.Addr{}, nil), privateResolve, map[string]bool{pageOrigin: true}).ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, want 401", rr.Code)
		}
	})
}
