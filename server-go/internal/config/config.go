package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	Address               string
	MySQLHost             string
	MySQLPort             string
	MySQLDatabase         string
	MySQLUser             string
	MySQLPassword         string
	SessionTTL            time.Duration
	ProductImageDir       string
	ProductImageURLPrefix string
}

func Load() Config {
	return Config{
		Address:               env("ADMIN_API_ADDR", "127.0.0.1:3001"),
		MySQLHost:             env("MYSQL_HOST", "127.0.0.1"),
		MySQLPort:             env("MYSQL_PORT", "3306"),
		MySQLDatabase:         env("MYSQL_DATABASE", "pingping_assistant"),
		MySQLUser:             env("MYSQL_USER", "pingping_api"),
		MySQLPassword:         os.Getenv("MYSQL_PASSWORD"),
		SessionTTL:            durationEnv("ADMIN_SESSION_TTL", 12*time.Hour),
		ProductImageDir:       env("PRODUCT_IMAGE_DIR", "/var/lib/pingping-admin-api/product-images"),
		ProductImageURLPrefix: env("PRODUCT_IMAGE_URL_PREFIX", "/admin-api/v1/product-images"),
	}
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(env(name, fallback.String()))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
