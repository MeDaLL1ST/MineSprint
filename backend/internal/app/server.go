package app

import (
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	cfg      Config
	db       *pgxpool.Pool
	upgrader websocket.Upgrader

	mu         sync.Mutex
	clients    map[string]*Client
	games      map[string]*Game
	playerGame map[string]string
	rooms      map[string]*Room
}

func NewServer(cfg Config, db *pgxpool.Pool) *Server {
	return &Server{
		cfg: cfg,
		db:  db,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients:    map[string]*Client{},
		games:      map[string]*Game{},
		playerGame: map[string]string{},
		rooms:      map[string]*Room{},
	}
}
