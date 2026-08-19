package httpapi

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"pingping-assistant-admin/internal/domain"
	"pingping-assistant-admin/internal/service"
)

const maxProductImageSize = 5 << 20

type ProductImageOptions struct {
	Directory string
	URLPrefix string
}

func defaultProductImageOptions() ProductImageOptions {
	return ProductImageOptions{
		Directory: filepath.Join(os.TempDir(), "pingping-admin-api", "product-images"),
		URLPrefix: "/admin-api/v1/product-images",
	}
}

func normalizeProductImageOptions(options ProductImageOptions) ProductImageOptions {
	defaults := defaultProductImageOptions()
	if strings.TrimSpace(options.Directory) == "" {
		options.Directory = defaults.Directory
	}
	options.URLPrefix = "/" + strings.Trim(strings.TrimSpace(options.URLPrefix), "/")
	if options.URLPrefix == "/" {
		options.URLPrefix = defaults.URLPrefix
	}
	return options
}

func (a *API) uploadProductImage(w http.ResponseWriter, r *http.Request, account domain.Account, _ string) {
	if !service.Can(account, "products.edit") {
		writeError(w, r, service.ErrForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxProductImageSize+(1<<20))
	if err := r.ParseMultipartForm(maxProductImageSize); err != nil {
		writeError(w, r, fmt.Errorf("%w: 商品图片不能超过 5 MB", service.ErrInvalidInput))
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, r, service.ErrInvalidInput)
		return
	}
	defer file.Close()
	filename, err := saveProductImage(a.productImages.Directory, file)
	if err != nil {
		if errors.Is(err, service.ErrInvalidInput) {
			writeError(w, r, err)
		} else {
			writeError(w, r, fmt.Errorf("save product image: %w", err))
		}
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"url": a.productImages.URLPrefix + "/" + filename})
}

func saveProductImage(directory string, source io.Reader) (string, error) {
	header := make([]byte, 512)
	read, err := io.ReadFull(source, header)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return "", err
	}
	header = header[:read]
	extension, ok := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/webp": ".webp",
	}[http.DetectContentType(header)]
	if !ok {
		return "", fmt.Errorf("%w: 请选择 JPG、PNG 或 WebP 图片", service.ErrInvalidInput)
	}
	if err = os.MkdirAll(directory, 0o750); err != nil {
		return "", err
	}
	randomID := make([]byte, 16)
	if _, err = rand.Read(randomID); err != nil {
		return "", err
	}
	filename := hex.EncodeToString(randomID) + extension
	path := filepath.Join(directory, filename)
	target, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return "", err
	}
	written, copyErr := io.Copy(target, io.LimitReader(io.MultiReader(bytes.NewReader(header), source), maxProductImageSize+1))
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil || written > maxProductImageSize {
		_ = os.Remove(path)
		if written > maxProductImageSize {
			return "", fmt.Errorf("%w: 商品图片不能超过 5 MB", service.ErrInvalidInput)
		}
		if copyErr != nil {
			return "", copyErr
		}
		return "", closeErr
	}
	return filename, nil
}

func (a *API) serveProductImages() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filename := strings.TrimPrefix(r.URL.Path, a.productImages.URLPrefix+"/")
		if !validProductImageFilename(filename) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, filepath.Join(a.productImages.Directory, filename))
	})
}

func validProductImageFilename(filename string) bool {
	if filename != filepath.Base(filename) {
		return false
	}
	extension := filepath.Ext(filename)
	if extension != ".jpg" && extension != ".png" && extension != ".webp" {
		return false
	}
	id := strings.TrimSuffix(filename, extension)
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}
