package main

import (
	"strings"
	"testing"
)

func TestFillControlsPresent(t *testing.T) {
	html, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		t.Fatal(err)
	}
	js, err := staticFiles.ReadFile("static/app.js")
	if err != nil {
		t.Fatal(err)
	}
	page := string(html)
	for _, want := range []string{`id="every"`, `value="4"`, `aria-label="Fill kick"`, `aria-label="Fill snare"`, `aria-label="Fill hat"`} {
		if !strings.Contains(page, want) {
			t.Errorf("index.html missing %s", want)
		}
	}
	swing, every, name := strings.Index(page, `id="swing"`), strings.Index(page, `id="every"`), strings.Index(page, `id="name"`)
	if !(swing >= 0 && swing < every && every < name) {
		t.Errorf("want swing < every < name, got %d %d %d", swing, every, name)
	}
	if !strings.Contains(string(js), "Every must be a whole number from 1 to 16") {
		t.Error("app.js missing the Every error message")
	}
}
