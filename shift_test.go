package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestShiftControlsServed guards the Shift left / Shift right buttons and the
// helper that backs them.
func TestShiftControlsServed(t *testing.T) {
	handler := newHandler("x")
	get := func(path string) string {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s = %d, want %d", path, rec.Code, http.StatusOK)
		}
		return rec.Body.String()
	}
	html := get("/")
	for _, want := range []string{`id="shift-left"`, `id="shift-right"`, "Shift left", "Shift right"} {
		if !strings.Contains(html, want) {
			t.Errorf("/ lacks %q", want)
		}
	}
	if !strings.Contains(get("/app.js"), "shiftTracks") {
		t.Errorf("/app.js lacks shiftTracks")
	}
}
