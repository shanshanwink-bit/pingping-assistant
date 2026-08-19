package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"pingping-assistant-admin/internal/service"
)

func TestSecurityHeaders(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

func TestProductDeleteRequiresAuthentication(t *testing.T) {
	server := NewServer("", nil, service.NewAdminService(nil, time.Hour))
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/admin-api/v1/products/1", nil)

	server.Handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("DELETE product status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}
