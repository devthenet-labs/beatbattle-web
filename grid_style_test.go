package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestStepPadsAreDrumPadSized guards the sequencer grid's layout: a future edit
// that drops the fixed 48px pad size or the horizontally-scrolling grid container
// should fail this test instead of silently shrinking pads or breaking scroll.
func TestStepPadsAreDrumPadSized(t *testing.T) {
	handler := newHandler("x")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/style.css", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/style.css = %d, want %d", rec.Code, http.StatusOK)
	}
	css := rec.Body.String()
	for _, want := range []string{"48px", "overflow-x: auto"} {
		if !strings.Contains(css, want) {
			t.Errorf("style.css lacks %q", want)
		}
	}
}

// TestLoadedLineSitsAboveGrid guards the "Loaded: <name> by <handle>" status line:
// it must exist, start hidden, and come before the step grid in the page.
func TestLoadedLineSitsAboveGrid(t *testing.T) {
	handler := newHandler("x")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/ = %d, want %d", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	loaded := strings.Index(body, `id="loaded"`)
	grid := strings.Index(body, `id="grid"`)
	if loaded < 0 || grid < 0 || loaded >= grid {
		t.Fatalf("loaded line at %d, grid at %d; want loaded before grid", loaded, grid)
	}
	if tag := body[loaded : loaded+strings.Index(body[loaded:], ">")]; !strings.Contains(tag, "hidden") {
		t.Errorf("loaded line is not hidden by default: %q", tag)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/app.js = %d, want %d", rec.Code, http.StatusOK)
	}
	js := rec.Body.String()
	for _, want := range []string{"'Loaded: '", "' by '"} {
		if !strings.Contains(js, want) {
			t.Errorf("app.js lacks %q", want)
		}
	}
}
