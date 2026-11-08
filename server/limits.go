package main

import (
	"net/netip"
	"sync"
	"time"
)

// Limits, all in memory and all per sliding hour unless noted. The VPS is small (939 MB) and ICMP is cheap; the point
// is to stop one visitor (or one target) being hammered and to keep concurrency bounded, not to count bytes.
const (
	perVisitor    = 20             // tests a visitor may ask for
	perTarget     = 60             // tests to one address, whoever asks
	sitePerMinute = 120            // tests the whole site starts in a minute
	sitePerHour   = 2000           // … and in an hour
	busyAtOnce    = 32             // tests under way at the same time
	visitorAtOnce = 2              // … for one visitor
	window        = time.Hour
	minute        = time.Minute
	retryWhenBusy = 5
	sweepEvery    = time.Minute
	maxKeys       = 50000 // visitors tracked: past this, new ones wait
)

type limits struct {
	mu       sync.Mutex
	now      func() time.Time
	visitors map[uint64]*visitor
	targets  map[netip.Addr][]time.Time
	site     []time.Time
	busy     int
	last     time.Time
}

type visitor struct {
	hits []time.Time
	busy int
}

func newLimits(now func() time.Time) *limits {
	return &limits{now: now, visitors: map[uint64]*visitor{}, targets: map[netip.Addr][]time.Time{}}
}

// recent: the times still inside the window, oldest first
func recent(ts []time.Time, now time.Time, w time.Duration) []time.Time {
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= w {
		i++
	}
	return ts[i:]
}

// seconds until the oldest of ts leaves the window
func retryAfter(ts []time.Time, now time.Time, w time.Duration) int {
	if len(ts) == 0 {
		return 1
	}
	return int(w-now.Sub(ts[0]))/int(time.Second) + 1
}

func (l *limits) sweep(now time.Time) {
	if now.Sub(l.last) < sweepEvery {
		return
	}
	l.last = now
	for k, v := range l.visitors {
		v.hits = recent(v.hits, now, window)
		if len(v.hits) == 0 && v.busy == 0 {
			delete(l.visitors, k)
		}
	}
	for a, ts := range l.targets {
		if ts = recent(ts, now, window); len(ts) == 0 {
			delete(l.targets, a)
		} else {
			l.targets[a] = ts
		}
	}
}

// visit counts a request from this visitor; "" when it may go on, else which limit it hit and the seconds to wait
func (l *limits) visit(key uint64) (string, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)
	v := l.visitors[key]
	if v == nil {
		if len(l.visitors) >= maxKeys {
			return "busy", retryWhenBusy
		}
		v = &visitor{}
		l.visitors[key] = v
	}
	v.hits = recent(v.hits, now, window)
	if len(v.hits) >= perVisitor {
		return "visitor", retryAfter(v.hits, now, window)
	}
	v.hits = append(v.hits, now)
	return "", 0
}

// dest counts a test to a: "" when it may go on, else which limit it hit and the seconds to wait
func (l *limits) dest(a netip.Addr) (string, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.site = recent(l.site, now, window)
	lastMinute := recent(l.site, now, minute)
	if len(lastMinute) >= sitePerMinute {
		return "site", retryAfter(lastMinute, now, minute)
	}
	if len(l.site) >= sitePerHour {
		return "site", retryAfter(l.site, now, window)
	}
	ts := recent(l.targets[a], now, window)
	if len(ts) >= perTarget {
		return "target", retryAfter(ts, now, window)
	}
	if ts == nil && len(l.targets) >= maxKeys {
		return "busy", retryWhenBusy
	}
	l.targets[a] = append(ts, now)
	l.site = append(l.site, now)
	return "", 0
}

// enter: one more test under way, if the site and the visitor have room for it
func (l *limits) enter(key uint64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	v := l.visitors[key]
	if l.busy >= busyAtOnce || v == nil || v.busy >= visitorAtOnce {
		return false
	}
	l.busy++
	v.busy++
	return true
}

func (l *limits) leave(key uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.busy--
	if v := l.visitors[key]; v != nil {
		v.busy--
	}
}
