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
