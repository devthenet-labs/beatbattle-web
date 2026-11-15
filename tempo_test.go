package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, path string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	newHandler("abc123").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, rec.Code)
	}
	return rec.Body.String()
}

func TestTempoMarkup(t *testing.T) {
	body := get(t, "/")
	bpm := strings.Index(body, `id="bpm-out"`)
	tempo := strings.Index(body, `id="tempo-out"`)
	if bpm < 0 || tempo < 0 || tempo < bpm {
		t.Fatalf("tempo-out must follow bpm-out (bpm=%d tempo=%d)", bpm, tempo)
	}
}

func TestTempoScript(t *testing.T) {
	body := get(t, "/app.js")
	for _, want := range []string{
		"function tempoWord", "'slow'", "'medium'", "'fast'", "n < 90", "n >= 130",
		"$('tempo-out').textContent = tempoWord(state.bpm)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("app.js missing %q", want)
		}
	}
}
