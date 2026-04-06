package main

import (
	"log"
	"math/rand"
	"net/http"
	"time"

	"tg-minesweeper/backend/internal/app"
)

func main() {
	rand.Seed(time.Now().UnixNano())

	cfg := app.LoadConfig()
	if cfg.DBDSN == "" {
		log.Fatal("DB_DSN is required")
	}
	if cfg.BotToken == "" {
		log.Fatal("BOT_TOKEN is required")
	}

	db, err := app.OpenDB(cfg)
	if err != nil {
		log.Fatalf("db init error: %v", err)
	}
	defer db.Close()

	server := app.NewServer(cfg, db)
	go server.StartCleanupLoop()

	log.Printf("server started on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, app.NewMux(server)); err != nil {
		log.Fatal(err)
	}
}
