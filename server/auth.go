// Endpoint auth (1ms.dog docs/tool-contract.md, "端点鉴权"): when MS_AUTH_SECRET is set, every request except
// /healthz must carry `Authorization: Bearer v1.<exp>.<nonce>.<scope>.<hmac>`. The scope is in the token (comma
// separated; a subset of probe,reach,ping,rtc,ipv6,seg,dns,data), and the HMAC-SHA256 over
// `v1|exp|nonce|scope`, base64url without padding, must verify before the scope is read. Unset means no check, which
// is the self-hosted default and the rollout switch; this is in addition to the per-visitor limits, never instead of
// them. The secret comes from the environment (systemd LoadCredential or EnvironmentFile) and never from here.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"strconv"
	"strings"
	"time"
)

// A page token names the endpoints it may use; a service token may name "*". A token signed for another endpoint
// (say reach) verifies but does not carry "ping", so it is refused here.
const serviceScope = "*"

func authSecret() string { return os.Getenv("MS_AUTH_SECRET") }

// checkAuth returns ("", true) when the request may pass, or the 401 reason when it may not.
func checkAuth(secret, header string, now time.Time) (code string, ok bool) {
	if secret == "" {
		return "", true
	}
	h := strings.TrimSpace(header)
	if !strings.HasPrefix(h, "Bearer ") {
		return "no_token", false
	}
	tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	parts := strings.Split(tok, ".")
	if len(parts) != 5 || parts[0] != "v1" || parts[2] == "" || parts[3] == "" {
		return "bad_token", false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= exp {
		return "bad_token", false
	}
	got, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[4], "="))
	if err != nil {
		return "bad_token", false
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("v1|" + parts[1] + "|" + parts[2] + "|" + parts[3]))
	if !hmac.Equal(got, m.Sum(nil)) {
		return "bad_token", false
	}
	for _, s := range strings.Split(parts[3], ",") {
		s = strings.TrimSpace(s)
		if s == "ping" || s == serviceScope {
			return "", true
		}
	}
	return "bad_token", false
}
