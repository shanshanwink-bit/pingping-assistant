package service

import "testing"

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("test-password-123")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "test-password-123") {
		t.Fatal("password should verify")
	}
	if VerifyPassword(hash, "wrong-password") {
		t.Fatal("wrong password should not verify")
	}
}
