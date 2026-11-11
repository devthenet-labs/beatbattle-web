package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func getBody(t *testing.T, path string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	newHandler("x").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	b, _ := io.ReadAll(rec.Result().Body)
	return string(b)
}

func TestHitCountsLine(t *testing.T) {
	body := getBody(t, "/")
	grid := strings.Index(body, `id="grid"`)
	line := strings.Index(body, `id="hit-counts"`)
	controls := strings.Index(body, `class="controls"`)
	if !strings.Contains(body, "kick 0 · snare 0 · hat 0") {
		t.Fatal("missing initial counts text")
	}
	if grid < 0 || line < grid || controls < line {
		t.Fatalf("bad ordering grid=%d line=%d controls=%d", grid, line, controls)
	}
}

func TestHitCountsScript(t *testing.T) {
	body := getBody(t, "/app.js")
	for _, want := range []string{"countHits", "formatCounts"} {
		if !strings.Contains(body, want) {
			t.Errorf("app.js missing %s", want)
		}
	}
}
