package crawler

import (
	"net/url"
	"testing"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
)

func TestSafeNavigation(t *testing.T) {
	base, _ := url.Parse("https://example.com/app/")
	for _, c := range []struct {
		href  string
		allow bool
	}{{"/page", true}, {"#/route", true}, {"#/delete/account", false}, {"#/route?send=1", false}, {"/next#anchor", false}, {"https://third.example.org/", false}, {"/logout", false}, {"/delete/account", false}, {"/page?delete=1", false}, {"javascript:alert(1)", false}, {"/a.pdf", false}, {"http://example.com/page", false}, {"https://example.com:443/safe", true}} {
		got, reason := SafeLink(base, c.href, domain.Origin(base))
		if (got != "") != c.allow {
			t.Errorf("%s: %s %s", c.href, got, reason)
		}
	}
}

func TestCanonicalOriginBoundary(t *testing.T) {
	for _, c := range []struct {
		from, to string
		ok       bool
	}{
		{"http://example.com/", "https://www.example.com/", true},
		{"http://example.com:8080/", "http://www.example.com:8080/", true},
		{"https://example.com/", "http://www.example.com/", false},
		{"https://example.com/", "https://evil.example/", false},
		{"http://example.com:8080/", "http://www.example.com:8081/", false},
	} {
		a, _ := url.Parse(c.from)
		b, _ := url.Parse(c.to)
		_, ok := CanonicalOrigin(a, b)
		if ok != c.ok {
			t.Fatal(c.from, c.to, ok)
		}
	}
}
