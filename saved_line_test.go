package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fetchStatic(t *testing.T, path string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	newHandler("x").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("%s = %d, want %d", path, rec.Code, http.StatusOK)
	}
	return rec.Body.String()
}

// TestSavedLine guards the "Saved: <name>" line under the save form.
func TestSavedLine(t *testing.T) {
	html := fetchStatic(t, "/")
	i := strings.Index(html, `id="saved"`)
	if i < 0 {
		t.Fatal(`index.html lacks id="saved"`)
	}
	end := strings.Index(html[i:], ">")
	if !strings.Contains(html[i:i+end], "hidden") {
		t.Error("#saved is not hidden on a fresh page")
	}
	if f := strings.Index(html, "</form>"); f < 0 || f > i {
		t.Error("#saved should come after the save form")
	}
	if js := fetchStatic(t, "/app.js"); !strings.Contains(js, "'Saved: '") {
		t.Error("app.js lacks the Saved: text")
	}
	if css := fetchStatic(t, "/style.css"); !strings.Contains(css, ".saved") {
		t.Error("style.css lacks .saved")
	}
}
