package scanner

import (
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/chromedp/cdproto/network"
	"testing"
	"time"
)

func TestRedirectAtRequestLimitPreservesPreviousHop(t *testing.T) {
	r := newRuntime(model.ScanTask{ID: "synthetic-request-limit"})
	for i := 0; i < MaxRequests-1; i++ {
		r.requests[string(rune(i+1))] = model.NetworkRequest{}
	}
	r.add("redirect", "https://old.example/", "GET", "Document", "", "", time.Now(), 1)
	key := r.active["redirect"]
	r.response("redirect", &network.Response{Status: 302})
	r.finish("redirect", 2, "redirected", "")
	r.add("redirect", "https://new.example/", "GET", "Document", "", "", time.Now(), 2)
	r.response("redirect", &network.Response{Status: 200})
	r.finish("redirect", 3, "finished", "")
	old := r.requests[key]
	if old.StatusCode != 302 || old.State != "redirected" || !r.limit || r.active["redirect"] != "" {
		t.Fatalf("redirect overwritten: %+v", old)
	}
}
