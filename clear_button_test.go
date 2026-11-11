package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClearButtonMarkupAndHandler(t *testing.T) {
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
	for _, want := range []string{`id="clear"`, `>Clear</button>`, `<button id="clear" class="btn"`} {
		if !strings.Contains(html, want) {
			t.Errorf("index.html lacks %q", want)
		}
	}
	stop, clear, bpm := strings.Index(html, `id="stop"`), strings.Index(html, `id="clear"`), strings.Index(html, `id="bpm"`)
	if !(stop >= 0 && stop < clear && clear < bpm) {
		t.Errorf("want stop < clear < bpm, got %d, %d, %d", stop, clear, bpm)
	}

	js := get("/app.js")
	for _, want := range []string{"function clearGrid", `$('clear').addEventListener('click', clearGrid)`} {
		if !strings.Contains(js, want) {
			t.Errorf("app.js lacks %q", want)
		}
	}
}
