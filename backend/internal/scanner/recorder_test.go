package scanner

import (
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/chromedp/cdproto/network"
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

func TestPauseKeepsTerminalEventsWithoutRecordingNewRequests(t *testing.T) {
	r := newRuntime(model.ScanTask{ID: "interactive", Options: model.ScanOptions{Mode: "interactive"}})
	send := func(id network.RequestID, url string, redirect *network.Response) {
		r.onEvent(&network.EventRequestWillBeSent{
			RequestID: id, Request: &network.Request{URL: url, Method: "GET"},
			Type: network.ResourceTypeFetch, RedirectResponse: redirect,
		})
	}
	finish := func(id network.RequestID) {
		r.onEvent(&network.EventResponseReceived{RequestID: id, Response: &network.Response{Status: 200}})
		r.onEvent(&network.EventLoadingFinished{RequestID: id})
	}
	send("started", "https://example.com/started", nil)
	send("redirect", "https://example.com/redirect", nil)
	oldHop := r.active["redirect"]
	r.task.RecordingPaused = true
	send("paused", "https://example.com/paused", nil)
	send("redirect", "https://example.com/paused-hop", &network.Response{Status: 302})
	r.onEvent(&network.EventWebSocketCreated{RequestID: "socket", URL: "wss://example.com/paused-socket"})
	finish("started")
	r.task.RecordingPaused = false
	finish("paused")
	finish("redirect")
	send("resumed", "https://example.com/resumed", nil)
	finish("resumed")
	if len(r.requests) != 3 || r.requests[r.active["started"]].State != "finished" ||
		r.requests[oldHop].State != "redirected" || r.requests[oldHop].StatusCode != 302 ||
		r.requests[r.active["resumed"]].State != "finished" {
		t.Fatalf("pause lost a recorded response or admitted paused requests: %+v", r.requests)
	}
}
