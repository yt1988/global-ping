package main

import (
	"net/netip"
	"strings"
)

// A domain name (letters, digits, hyphens or underscores, at least two labels) or an IP address; never a local name.
// The page normalises the input first; the server checks it again, because the page is not the only thing that can
// call this endpoint.
func validHost(h string) bool {
	if a, err := netip.ParseAddr(h); err == nil {
		return a.Zone() == ""
	}
	if len(h) > 253 || !strings.Contains(h, ".") || h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return false
	}
	for _, l := range strings.Split(h, ".") {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for _, c := range l {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
				return false
			}
		}
	}
	return true
}
