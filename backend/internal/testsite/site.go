// Package testsite provides deterministic, side-effect-free browser integration
// fixtures. It is only linked into tests and cmd/testsite, never the product.
package testsite

import (
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed testfont.ttf
var font []byte

func Handler(mappedHosts bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/second" && r.URL.Path != "/third" {
			http.NotFound(w, r)
			return
		}
		origin := "http://" + r.Host
		assets, api := origin, origin
		if mappedHosts {
			_, port, _ := net.SplitHostPort(r.Host)
			assets = "http://assets.scan.test:" + port
			api = "http://api.scan.test:" + port
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Castorice 本地测试站</title><link rel="stylesheet" href="%s/style.css"></head><body><h1>Castorice 测试站</h1><p class="font-test">A</p><img alt="测试图片" src="%s/pixel.svg"><nav><a href="/second">子页面</a> <a href="/third">第三页</a> <a href="/redirect">重定向</a> <a href="/#/spa">SPA 路由</a> <a href="/logout">退出（不得自动访问）</a> <a href="/delete?item=1">删除（不得自动访问）</a> <a href="http://third.invalid/">第三方（不得导航）</a></nav><script src="%s/script.js"></script><script>window.apiOrigin=%q;</script><div style="height:1400px">滚动测试</div></body></html>`, assets, assets, assets, api)
	})
	mux.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		_, _ = fmt.Fprint(w, `@font-face{font-family:fixture;src:url('/font.ttf')} .font-test{font-family:fixture}body{font-family:system-ui;background:#f1edf6;color:#392d4a;padding:32px}nav a{display:inline-block;margin:12px} `)
	})
	mux.HandleFunc("/font.ttf", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write(font)
	})
	mux.HandleFunc("/pixel.svg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = fmt.Fprint(w, `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" rx="10" fill="#6c4eab"/></svg>`)
	})
	mux.HandleFunc("/script.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript")
		_, _ = fmt.Fprint(w, `setTimeout(()=>{const a=window.apiOrigin;fetch(a+'/api/data?token=fixture-secret').catch(()=>{});fetch(a+'/bad').catch(()=>{});fetch(a+'/disconnect').catch(()=>{});window.fixtureWS=new WebSocket(a.replace('http:','ws:')+'/ws');},100);setTimeout(()=>fetch(window.apiOrigin+'/api/late').catch(()=>{}),350);window.addEventListener('scroll',()=>fetch(window.apiOrigin+'/api/lazy').catch(()=>{}),{once:true});`)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = fmt.Fprint(w, `{"fixture":true}`)
	})
	mux.HandleFunc("/redirect", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/second", 302) })
	mux.HandleFunc("/redirect-private", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", 302)
	})
	mux.HandleFunc("/bad", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(503)
		_, _ = fmt.Fprint(w, "fixture unavailable")
	})
	mux.HandleFunc("/disconnect", func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	})
	mux.HandleFunc("/hang", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(15 * time.Second):
			w.WriteHeader(200)
		}
	})
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		u, err := url.Parse(r.Header.Get("Origin"))
		return err == nil && (strings.HasSuffix(u.Hostname(), ".scan.test") || u.Hostname() == "scan.test" || u.Hostname() == "127.0.0.1")
	}}
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.WriteMessage(websocket.TextMessage, []byte("fixture connected"))
		for {
			if _, _, err = conn.ReadMessage(); err != nil {
				return
			}
		}
	})
	return mux
}
