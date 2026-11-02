package main

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"
)

//go:embed static/index.html static/app.js static/style.css static/battles.html static/battles.js static/battle.html static/battle.js static/beat.html static/beat.js
var staticFiles embed.FS

// csp is the Content-Security-Policy every response carries. There is no
// inline script or style anywhere, so nothing needs 'unsafe-inline'.
const csp = "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; " +
	"style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

// asset is one embedded file with the headers it is served under.
type asset struct {
	body        []byte
	contentType string
	etag        string
}

func loadAsset(name, contentType string) asset {
	body, err := staticFiles.ReadFile("static/" + name)
	if err != nil {
		panic("embedded asset missing: " + name) // the embed directive guarantees it
	}
	sum := sha256.Sum256(body)
	return asset{body: body, contentType: contentType, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
}

// serve answers GET (and HEAD) with the asset, honouring If-None-Match.
func (a asset) serve(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", a.contentType)
	h.Set("ETag", a.etag)
	h.Set("Cache-Control", "public, max-age=300, must-revalidate")
	// ServeContent handles If-None-Match and HEAD; the zero modtime sends no Last-Modified.
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(a.body))
}

// newHandler serves the UI at /, its assets, and the readiness check at /healthz.
func newHandler(revision string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "revision": revision})
	})
	routes := map[string]asset{
		"GET /{$}":          loadAsset("index.html", "text/html; charset=utf-8"),
		"GET /app.js":       loadAsset("app.js", "text/javascript; charset=utf-8"),
		"GET /style.css":    loadAsset("style.css", "text/css; charset=utf-8"),
		"GET /battles":      loadAsset("battles.html", "text/html; charset=utf-8"),
		"GET /battles/{id}": loadAsset("battle.html", "text/html; charset=utf-8"),
		"GET /battles.js":   loadAsset("battles.js", "text/javascript; charset=utf-8"),
		"GET /battle.js":    loadAsset("battle.js", "text/javascript; charset=utf-8"),
		"GET /beat/{id}":    loadAsset("beat.html", "text/html; charset=utf-8"),
		"GET /beat.js":      loadAsset("beat.js", "text/javascript; charset=utf-8"),
	}
	for pattern, a := range routes {
		mux.HandleFunc(pattern, a.serve)
	}
	return withSecurityHeaders(mux)
}

// withSecurityHeaders sets the headers every response carries.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
