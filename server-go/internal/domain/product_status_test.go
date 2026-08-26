package domain

import "testing"

func TestProductStatusCompatibility(t *testing.T) {
	for _, status := range []string{"", ProductStatusSelling, ProductStatusOutOfStock} {
		if !IsProductActiveStatus(status) {
			t.Fatalf("status %q should remain active", status)
		}
	}
	if IsProductActiveStatus(ProductStatusInactive) {
		t.Fatal("inactive product must not be treated as active")
	}
}
