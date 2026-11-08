package main

import (
	"context"
	"math/rand/v2"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

const (
	payloadSize = 56               // like the system ping's default
	interval    = 500 * time.Millisecond // Globalping's spacing: 16 packets take about 7.5 s there too
	waitLast    = 2 * time.Second  // how long the last packet may take to come back
)

// Timing is one packet: the number the page uses for the slot, and null RTT when no reply came.
type Timing struct {
	I   int      `json:"i"`
	RTT *float64 `json:"rtt"`
	TTL *int     `json:"ttl"`
}

// pingerFunc sends n ICMP echo requests to one address. It is a value so the tests can replace it; only this function
// (ping below) touches the network.
type pingerFunc func(ctx context.Context, addr netip.Addr, n int) ([]Timing, error)

// ping sends n echo requests, 0.5 s apart, to addr, and returns one Timing per packet in order. A packet with no reply
// has RTT nil. It needs CAP_NET_RAW (raw ICMP sockets); the kernel computes ICMPv6 checksums.
func ping(ctx context.Context, addr netip.Addr, n int) ([]Timing, error) {
	network, laddr, proto := "ip4:icmp", "0.0.0.0", 1
	var request, reply icmp.Type = ipv4.ICMPTypeEcho, ipv4.ICMPTypeEchoReply
	if addr.Is6() {
		network, laddr, proto = "ip6:ipv6-icmp", "::", 58
		request, reply = ipv6.ICMPType(128), ipv6.ICMPType(129)
	}
	c, err := icmp.ListenPacket(network, laddr)
	if err != nil {
		return nil, err
	}
	defer c.Close()

	out := make([]Timing, n)
	for i := range out {
		out[i] = Timing{I: i + 1}
	}
	sent := make([]atomic.Int64, n+1)
	var p4 *ipv4.PacketConn
	var p6 *ipv6.PacketConn
	if addr.Is4() {
		p4 = c.IPv4PacketConn()
		if err := p4.SetControlMessage(ipv4.FlagTTL, true); err != nil {
			return nil, err
		}
	} else {
		p6 = c.IPv6PacketConn()
		if err := p6.SetControlMessage(ipv6.FlagHopLimit, true); err != nil {
			return nil, err
		}
	}

	id := rand.IntN(1 << 16)
	var mu sync.Mutex
	got := 0
	allDone := make(chan struct{})
	var once sync.Once
	readDone := make(chan struct{})
	readCtx, stopRead := context.WithCancel(ctx)
	defer stopRead()

	go func() {
		defer close(readDone)
		buf := make([]byte, 1500)
		for readCtx.Err() == nil {
			c.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
			var nb, ttl int
			var src net.Addr
			var rerr error
			if p4 != nil {
				var cm *ipv4.ControlMessage
				nb, cm, src, rerr = p4.ReadFrom(buf)
				if cm != nil {
					ttl = cm.TTL
				}
			} else {
				var cm *ipv6.ControlMessage
				nb, cm, src, rerr = p6.ReadFrom(buf)
				if cm != nil {
					ttl = cm.HopLimit
				}
			}
			if rerr != nil {
				if readCtx.Err() != nil {
					return
				}
				continue
			}
			ia, ok := src.(*net.IPAddr)
			if !ok || !ia.IP.Equal(net.IP(addr.AsSlice())) {
				continue
			}
			m, err := icmp.ParseMessage(proto, buf[:nb])
			if err != nil || m.Type != reply {
				continue
			}
			echo, ok := m.Body.(*icmp.Echo)
			if !ok || echo.ID != id || echo.Seq < 1 || echo.Seq > n {
				continue
			}
			at := sent[echo.Seq].Load()
			if at == 0 {
				continue
			}
			mu.Lock()
			if out[echo.Seq-1].RTT == nil {
				rtt := float64(time.Since(time.Unix(0, at)).Microseconds()) / 1000
				out[echo.Seq-1].RTT = &rtt
				if ttl > 0 {
					v := ttl
					out[echo.Seq-1].TTL = &v
				}
				got++
				if got == n {
					once.Do(func() { close(allDone) })
				}
			}
			mu.Unlock()
		}
	}()

send:
	for i := 1; i <= n; i++ {
		m := icmp.Message{Type: request, Code: 0, Body: &icmp.Echo{ID: id, Seq: i, Data: make([]byte, payloadSize)}}
		b, err := m.Marshal(nil)
		if err != nil {
			return out, err
		}
		sent[i].Store(time.Now().UnixNano())
		if _, err := c.WriteTo(b, &net.IPAddr{IP: net.IP(addr.AsSlice())}); err != nil {
			return out, err
		}
		if i < n {
			select {
			case <-ctx.Done():
				break send
			case <-allDone:
				break send
			case <-time.After(interval):
			}
		}
	}

	if !done(allDone) {
		select {
		case <-allDone:
		case <-ctx.Done():
		case <-time.After(time.Until(time.Unix(0, sent[n].Load()).Add(waitLast))):
		}
	}
	stopRead()
	c.SetReadDeadline(time.Now())
	<-readDone
	mu.Lock()
	defer mu.Unlock()
	return out, nil
}

func done(ch chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}
