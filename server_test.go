package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

const wantCSP = "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; " +
	"style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

func TestHandler(t *testing.T) {
	handler := newHandler("abc123")
	cases := []struct {
		name, method, path string
		status             int
		contentType, body  string
	}{
		{"page", http.MethodGet, "/", http.StatusOK, "text/html; charset=utf-8", `<script src="/app.js"`},
		{"script", http.MethodGet, "/app.js", http.StatusOK, "text/javascript; charset=utf-8", "Beat Battle web UI"},
		{"styles", http.MethodGet, "/style.css", http.StatusOK, "text/css; charset=utf-8", "--neon"},
		{"readiness", http.MethodGet, "/healthz", http.StatusOK, "application/json", `"status":"ok"`},
		{"favicon svg", http.MethodGet, "/favicon.svg", http.StatusOK, "image/svg+xml", "<svg"},
		{"favicon ico", http.MethodGet, "/favicon.ico", http.StatusOK, "image/svg+xml", "<svg"},
		{"unknown path", http.MethodGet, "/missing", http.StatusNotFound, "", ""},
		{"embedded dir not exposed", http.MethodGet, "/static/app.js", http.StatusNotFound, "", ""},
		{"wrong method", http.MethodPost, "/", http.StatusMethodNotAllowed, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.status {
				t.Fatalf("%s %s = %d, want %d", tc.method, tc.path, rec.Code, tc.status)
			}
			if got := rec.Header().Get("Content-Type"); tc.contentType != "" && got != tc.contentType {
				t.Errorf("Content-Type = %q, want %q", got, tc.contentType)
			}
			if !strings.Contains(rec.Body.String(), tc.body) {
				t.Errorf("body lacks %q", tc.body)
			}
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
			}
			if got := rec.Header().Get("Content-Security-Policy"); got != wantCSP {
				t.Errorf("CSP = %q, want %q", got, wantCSP)
			}
		})
	}
}

func TestReadinessReportsRevision(t *testing.T) {
	rec := httptest.NewRecorder()
	newHandler("abc123").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("readiness body is not JSON: %v", err)
	}
	if got["revision"] != "abc123" {
		t.Errorf("revision = %q, want abc123", got["revision"])
	}
}

func TestAssetsAreCacheable(t *testing.T) {
	handler := newHandler("x")
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	etag := first.Header().Get("ETag")
	if etag == "" || !strings.Contains(first.Header().Get("Cache-Control"), "max-age") {
		t.Fatalf("missing ETag or Cache-Control: %v", first.Header())
	}
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	req.Header.Set("If-None-Match", etag)
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, req)
	if second.Code != http.StatusNotModified {
		t.Errorf("conditional GET = %d, want 304", second.Code)
	}
}

// TestNoInlineScriptOrStyle guards the CSP: the page may not rely on inline code.
func TestNoInlineScriptOrStyle(t *testing.T) {
	rec := httptest.NewRecorder()
	newHandler("x").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	page := rec.Body.String()
	for _, tag := range regexp.MustCompile(`(?i)<script[^>]*>`).FindAllString(page, -1) {
		if !strings.Contains(tag, " src=") {
			t.Errorf("inline script tag: %s", tag)
		}
	}
	for name, re := range map[string]*regexp.Regexp{
		"style element": regexp.MustCompile(`(?i)<style`),
		"style attr":    regexp.MustCompile(`(?i)\sstyle=`),
		"event handler": regexp.MustCompile(`(?i)\son[a-z]+=`),
	} {
		if re.MatchString(page) {
			t.Errorf("index.html contains an %s", name)
		}
	}
}
