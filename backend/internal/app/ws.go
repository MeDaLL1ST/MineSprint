package app

import (
	"encoding/json"
	"net/http"
	"time"
)

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	initData := r.URL.Query().Get("init_data")
	if initData == "" {
		http.Error(w, "missing init_data", http.StatusUnauthorized)
		return
	}

	userID, name, username, err := validateInitData(s.cfg.BotToken, initData)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)

	client := &Client{
		ID:       userID,
		Name:     name,
		Username: username,
		Conn:     conn,
		Send:     make(chan []byte, 64),
	}

	s.registerClient(client)
	defer s.unregisterClient(client)
	defer conn.Close()

	go s.writeLoop(client)

	s.send(client, map[string]any{
		"type": "hello",
		"user": map[string]any{
			"id":       client.ID,
			"name":     client.Name,
			"username": client.Username,
		},
	})

	for {
		var act Action
		if err := conn.ReadJSON(&act); err != nil {
			return
		}
		s.handleAction(client, act)
	}
}

func (s *Server) registerClient(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if prev, ok := s.clients[c.ID]; ok && prev != c {
		close(prev.Send)
		_ = prev.Conn.Close()
	}

	s.clients[c.ID] = c
	go s.upsertUser(c.ID, c.Name, c.Username)

	if g := s.currentGameLocked(c.ID); g != nil {
		s.sendStateLocked(c, g)
	}
}

func (s *Server) unregisterClient(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.clients[c.ID]
	if !ok || current != c {
		return
	}

	delete(s.clients, c.ID)
	close(c.Send)
}

func (s *Server) writeLoop(c *Client) {
	for msg := range c.Send {
		c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := c.Conn.WriteMessage(1, msg); err != nil {
			return
		}
	}
}

func (s *Server) handleAction(c *Client, act Action) {
	switch act.Type {
	case "start_solo":
		s.startSolo(c, act.Rows, act.Cols, act.Mines)
	case "create_room":
		s.createRoom(c, act.Mode, act.Rows, act.Cols, act.Mines)
	case "join_room":
		s.joinRoom(c, act.Code)
	case "leave_room":
		s.leaveRoom(c)
	case "restart_room":
		s.restartRoom(c)
	case "reveal":
		s.revealCell(c, act.Cell)
	case "toggle_flag":
		s.toggleFlag(c, act.Cell)
	default:
		s.sendError(c, "Неизвестное действие")
	}
}

func (s *Server) currentGameLocked(playerID string) *Game {
	gid, ok := s.playerGame[playerID]
	if !ok {
		return nil
	}
	return s.games[gid]
}

func (s *Server) send(c *Client, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	defer func() { recover() }()
	select {
	case c.Send <- data:
	default:
	}
}

func (s *Server) sendError(c *Client, msg string) {
	s.send(c, map[string]any{
		"type":    "error",
		"message": msg,
	})
}

func (s *Server) sendStateLocked(c *Client, g *Game) {
	s.send(c, map[string]any{
		"type":    "state",
		"payload": s.buildStateLocked(g, c.ID),
	})
}

func (s *Server) pushGameLocked(g *Game) {
	for _, pid := range g.Players {
		if c := s.clients[pid]; c != nil {
			s.sendStateLocked(c, g)
		}
	}
}
