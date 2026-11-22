package webui

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

//go:embed all:dist
var assets embed.FS

func Handler() http.Handler {
	root, _ := fs.Sub(assets, "dist")
	files := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		if _, err := fs.Stat(root, "index.html"); err != nil {
			http.Error(w, "前端尚未构建。请执行 scripts/build.ps1 或 npm run build。", 503)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
			name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
			if !strings.HasPrefix(name, "assets/") || strings.HasSuffix(name, ".gz") {
				http.NotFound(w, r)
				return
			}
			if _, err := fs.Stat(root, name+".gz"); err == nil {
				w.Header().Add("Vary", "Accept-Encoding")
				if acceptsGzip(r.Header.Get("Accept-Encoding")) {
					w.Header().Set("Content-Encoding", "gzip")
					w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
					gzipRequest := r.Clone(r.Context())
					gzipRequest.URL.Path += ".gz"
					files.ServeHTTP(w, gzipRequest)
					return
				}
			}
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		files.ServeHTTP(w, r)
	})
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, part := range strings.Split(header, ",") {
		encoding, params, _ := strings.Cut(part, ";")
		encoding = strings.TrimSpace(strings.ToLower(encoding))
		if encoding != "gzip" && encoding != "*" {
			continue
		}
		q := 1.0
		for _, param := range strings.Split(params, ";") {
			key, value, _ := strings.Cut(strings.TrimSpace(param), "=")
			if key == "q" {
				q, _ = strconv.ParseFloat(strings.TrimSpace(value), 64)
			}
		}
		if encoding == "gzip" {
			return q > 0
		}
		wildcard = q > 0
	}
	return wildcard
}
