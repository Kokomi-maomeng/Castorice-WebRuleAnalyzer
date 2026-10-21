package domain

import "testing"

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		raw, want string
		valid     bool
	}{
		{"https://example.com/#/route", "https://example.com/#/route", true},
		{"EXAMPLE.com", "https://example.com/", true}, {"http://Example.COM.:8080/a?q=hello#x", "http://example.com:8080/a?q=hello", true},
		{"https://例子.中国/a", "https://xn--fsqu00a.xn--fiqs8s/a", true}, {"https://8.8.8.8", "https://8.8.8.8/", true}, {"https://[2606:4700:4700::1111]:443/a", "https://[2606:4700:4700::1111]:443/a", true},
		{"", "", false}, {"ftp://example.com", "", false}, {"file:///C:/data", "", false}, {"https://user:password@example.com", "", false}, {"http://127.1", "", false}, {"http://example.com:0", "", false}, {"https://bad host/", "", false}, {"https://example.com\\@localhost", "", false},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			u, err := NormalizeURL(c.raw)
			if (err == nil) != c.valid {
				t.Fatalf("valid=%v err=%v", c.valid, err)
			}
			if err == nil && u.String() != c.want {
				t.Fatalf("got %s want %s", u, c.want)
			}
		})
	}
}
func TestHostNormalizationAndPSL(t *testing.T) {
	cases := []struct{ raw, host, kind string }{{"EXAMPLE.COM.", "example.com", "domain"}, {"例子.中国", "xn--fsqu00a.xn--fiqs8s", "domain"}, {"1.1.1.1", "1.1.1.1", "ipv4"}, {"::ffff:8.8.8.8", "8.8.8.8", "ipv4"}, {"2606:4700::1111", "2606:4700::1111", "ipv6"}}
	for _, c := range cases {
		h, k, e := NormalizeHost(c.raw)
		if e != nil || h != c.host || k != c.kind {
			t.Fatalf("%q: %s %s %v", c.raw, h, k, e)
		}
	}
	if Registrable("service.example.co.uk") != "example.co.uk" {
		t.Fatal("must use PSL, not final two labels")
	}
	if Registrable("127.0.0.1") != "" {
		t.Fatal("IP is not a domain")
	}
}
