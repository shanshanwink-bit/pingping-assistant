package main

import (
	"log"

	"pingping-assistant-admin/internal/config"
	"pingping-assistant-admin/internal/httpapi"
	"pingping-assistant-admin/internal/repository"
	"pingping-assistant-admin/internal/service"
)

func main() {
	cfg := config.Load()
	db, err := repository.OpenMySQL(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	repo := repository.NewAdminRepository(db)
	adminService := service.NewAdminService(repo, cfg.SessionTTL)
	server := httpapi.NewServer(cfg.Address, db, adminService, httpapi.ProductImageOptions{
		Directory: cfg.ProductImageDir,
		URLPrefix: cfg.ProductImageURLPrefix,
	})
	log.Printf("pingping admin api listening on %s", cfg.Address)
	log.Fatal(server.ListenAndServe())
}
