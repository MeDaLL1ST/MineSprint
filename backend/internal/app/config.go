package app

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port             string
	DBDSN            string
	BotToken         string
	BotUsername      string
	PublicBaseURL    string
	Domain           string
	AdminTGID        string
	RoomTTL          time.Duration
	InternalSecret   string
	InternalServerURL string
}

func LoadConfig() Config {
	ttlMin := getenvInt("ROOM_TTL_MINUTES", 30)

	return Config{
		Port:              getenv("PORT", "8080"),
		DBDSN:             strings.TrimSpace(os.Getenv("DB_DSN")),
		BotToken:          strings.TrimSpace(os.Getenv("BOT_TOKEN")),
		BotUsername:       strings.TrimPrefix(strings.TrimSpace(os.Getenv("BOT_USERNAME")), "@"),
		PublicBaseURL:     strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/"),
		Domain:            strings.TrimSpace(os.Getenv("DOMAIN")),
		AdminTGID:         getenv("ADMIN_TG_ID", "887152362"),
		RoomTTL:           time.Duration(ttlMin) * time.Minute,
		InternalSecret:    getenv("INTERNAL_SECRET", "changeme"),
		InternalServerURL: getenv("INTERNAL_SERVER_URL", "http://localhost:8080"),
	}
}

func getenv(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func getenvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
