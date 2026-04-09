package app

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
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

	if s.isUserBanned(userID) {
		http.Error(w, "banned", http.StatusForbidden)
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
	if prev, ok := s.clients[c.ID]; ok && prev != c {
		close(prev.Send)
		_ = prev.Conn.Close()
	}
	s.clients[c.ID] = c
	go s.upsertUser(c.ID, c.Name, c.Username)
	g := s.currentGameLocked(c.ID)
	s.mu.Unlock()

	if g != nil {
		g.mu.Lock()
		s.sendStateLocked(c, g)
		g.mu.Unlock()
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
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
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
	case "hover":
		s.setHover(c, act.Cell)
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

// playerMsg is a pre-serialised message destined for one player.
type playerMsg struct {
	pid string
	msg []byte
}

// buildBroadcastMsgs builds per-player state messages from g.
// Caller must hold g.mu (or exclusive s.mu so no hot-path can mutate g).
func (s *Server) buildBroadcastMsgs(g *Game) []playerMsg {
	msgs := make([]playerMsg, 0, len(g.Players))
	for _, pid := range g.Players {
		data, err := json.Marshal(map[string]any{
			"type":    "state",
			"payload": s.buildStateLocked(g, pid),
		})
		if err != nil {
			continue
		}
		msgs = append(msgs, playerMsg{pid: pid, msg: data})
	}
	return msgs
}

// buildHoverMsgs builds hover-notification messages for all players in g.
// Caller must hold g.mu.
func (s *Server) buildHoverMsgs(g *Game, playerID string, cell int, active bool) []playerMsg {
	data, _ := json.Marshal(map[string]any{
		"type":     "hover",
		"playerId": playerID,
		"cell":     cell,
		"active":   active,
	})
	msgs := make([]playerMsg, 0, len(g.Players))
	for _, pid := range g.Players {
		msgs = append(msgs, playerMsg{pid: pid, msg: data})
	}
	return msgs
}

// sendBroadcast delivers pre-built messages to their recipients.
// Safe to call with no lock held; acquires s.mu.RLock internally.
// Use for hot-path callers that hold no server lock.
func (s *Server) sendBroadcast(msgs []playerMsg) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, m := range msgs {
		if c, ok := s.clients[m.pid]; ok {
			select {
			case c.Send <- m.msg:
			default:
			}
		}
	}
}

// sendBroadcastLocked delivers pre-built messages to their recipients.
// Caller must already hold s.mu (any form); does not acquire s.mu.
// Use for cold-path callers that hold s.mu.Lock.
func (s *Server) sendBroadcastLocked(msgs []playerMsg) {
	for _, m := range msgs {
		if c, ok := s.clients[m.pid]; ok {
			select {
			case c.Send <- m.msg:
			default:
			}
		}
	}
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
