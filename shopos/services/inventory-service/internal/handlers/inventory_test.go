package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireInternal(t *testing.T) {
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }

	cases := []struct {
		name       string
		configured string
		sent       string
		want       int
	}{
		{"no token configured disables endpoint", "", "", http.StatusForbidden},
		{"no token configured, caller sends one", "", "anything", http.StatusForbidden},
		{"missing header", "secret", "", http.StatusForbidden},
		{"wrong token", "secret", "nope", http.StatusForbidden},
		{"correct token", "secret", "secret", http.StatusNoContent},
	}
	for _, c := range cases {
		h := NewInventoryHandler(nil, c.configured)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/inventory/reserve", nil)
		if c.sent != "" {
			req.Header.Set("X-Internal-Token", c.sent)
		}
		rec := httptest.NewRecorder()
		h.RequireInternal(ok)(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: got %d, want %d", c.name, rec.Code, c.want)
		}
	}
}
