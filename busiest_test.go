package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func getBody(t *testing.T, path string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	newHandler("x").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("%s = %d, want %d", path, rec.Code, http.StatusOK)
	}
	return rec.Body.String()
}

func TestBusiestLineInIndex(t *testing.T) {
	body := getBody(t, "/")
	b := strings.Index(body, `id="busiest"`)
	g := strings.Index(body, `id="grid"`)
	c := strings.Index(body, `class="controls"`)
	if b < 0 || g < 0 || c < 0 || !(g < b && b < c) {
		t.Fatalf("busiest line misplaced: grid=%d busiest=%d controls=%d", g, b, c)
	}
}

func TestBusiestScriptAndStyle(t *testing.T) {
	js := getBody(t, "/app.js")
	for _, want := range []string{"busiestTrack", "Busiest: none"} {
		if !strings.Contains(js, want) {
			t.Errorf("app.js lacks %q", want)
		}
	}
	if !strings.Contains(getBody(t, "/style.css"), ".busiest") {
		t.Error("style.css lacks .busiest")
	}
}
