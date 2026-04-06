package app

import "time"

func (s *Server) StartCleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanupExpired()
	}
}

func (s *Server) cleanupExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()

	for code, room := range s.rooms {
		if room == nil || room.Game == nil {
			delete(s.rooms, code)
			continue
		}

		if room.EmptySince != nil && now.Sub(*room.EmptySince) >= s.cfg.RoomTTL {
			delete(s.games, room.Game.ID)
			delete(s.rooms, code)
		}
	}

	for gid, game := range s.games {
		if game == nil || game.Mode != "solo" {
			continue
		}

		playerID := ""
		if len(game.Players) > 0 {
			playerID = game.Players[0]
		}

		_, online := s.clients[playerID]
		if !online && now.Sub(game.LastAction) >= s.cfg.RoomTTL {
			delete(s.games, gid)
			delete(s.playerGame, playerID)
		}
	}
}
