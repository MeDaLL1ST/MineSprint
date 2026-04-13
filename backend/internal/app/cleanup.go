package app

import "time"

func (s *Server) StartCleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanupExpired()
	}
}

type soloCandidate struct {
	gid      string
	playerID string
	game     *Game
	online   bool
}

func (s *Server) cleanupExpired() {
	now := time.Now()

	// Phase 1: collect candidates under the write lock (no game.mu taken here).
	s.mu.Lock()
	var expiredRooms []string
	var expiredRoomGameIDs []string
	for code, room := range s.rooms {
		if room == nil || room.Game == nil {
			expiredRooms = append(expiredRooms, code)
			continue
		}
		if room.EmptySince != nil && now.Sub(*room.EmptySince) >= s.cfg.RoomTTL {
			expiredRooms = append(expiredRooms, code)
			expiredRoomGameIDs = append(expiredRoomGameIDs, room.Game.ID)
		}
	}

	var soloCandidates []soloCandidate
	for gid, game := range s.games {
		if game == nil || game.Mode != "solo" {
			continue
		}
		playerID := ""
		if len(game.Players) > 0 {
			playerID = game.Players[0]
		}
		_, online := s.clients[playerID]
		soloCandidates = append(soloCandidates, soloCandidate{gid, playerID, game, online})
	}
	s.mu.Unlock()

	// Phase 2: check solo game timestamps without holding s.mu.
	// This is the only place game.mu is acquired, so it cannot block WS handlers.
	var expiredSolo []soloCandidate
	for _, c := range soloCandidates {
		c.game.mu.Lock()
		lastAction := c.game.LastAction
		c.game.mu.Unlock()
		if !c.online && now.Sub(lastAction) >= s.cfg.RoomTTL {
			expiredSolo = append(expiredSolo, c)
		}
	}

	// Phase 3: delete expired entries under a brief write lock.
	if len(expiredRooms) > 0 || len(expiredSolo) > 0 {
		s.mu.Lock()
		for _, code := range expiredRooms {
			delete(s.rooms, code)
		}
		for _, gid := range expiredRoomGameIDs {
			delete(s.games, gid)
		}
		for _, c := range expiredSolo {
			delete(s.games, c.gid)
			delete(s.playerGame, c.playerID)
		}
		s.mu.Unlock()
	}
}
