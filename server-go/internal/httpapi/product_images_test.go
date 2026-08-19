package httpapi

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pingping-assistant-admin/internal/service"
)

func TestSaveProductImage(t *testing.T) {
	directory := t.TempDir()
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 32)...)
	filename, err := saveProductImage(directory, bytes.NewReader(png))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(filename) != ".png" {
		t.Fatalf("filename = %q, want .png extension", filename)
	}
	stored, err := os.ReadFile(filepath.Join(directory, filename))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, png) {
		t.Fatal("stored image differs from uploaded image")
	}
}

func TestSaveProductImageRejectsUnsupportedContent(t *testing.T) {
	_, err := saveProductImage(t.TempDir(), strings.NewReader("not an image"))
	if !errors.Is(err, service.ErrInvalidInput) {
		t.Fatalf("error = %v, want invalid input", err)
	}
}

func TestValidProductImageFilename(t *testing.T) {
	valid := "00112233445566778899aabbccddeeff.webp"
	if !validProductImageFilename(valid) {
		t.Fatalf("expected %q to be valid", valid)
	}
	for _, filename := range []string{"../" + valid, "0011.png", "00112233445566778899aabbccddeeff.svg"} {
		if validProductImageFilename(filename) {
			t.Fatalf("expected %q to be invalid", filename)
		}
	}
}
