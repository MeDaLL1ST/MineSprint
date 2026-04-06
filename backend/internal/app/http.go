package app

import (
	"encoding/json"
	"net/http"
)

func NewMux(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/leaderboard", s.handleLeaderboard)
	mux.HandleFunc("/api/admin/stats", s.handleAdminStats)
	mux.HandleFunc("/ws", s.handleWS)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
select
  u.id,
  u.name,
  count(mp.match_id)::int as games,
  coalesce(sum(case when mp.result = 'win' then 1 else 0 end), 0)::int as wins,
  coalesce(sum(case when m.mode = 'coop' and mp.result = 'win' then 1 else 0 end), 0)::int as coop_wins,
  coalesce(sum(case when m.mode = 'versus' and mp.result = 'win' then 1 else 0 end), 0)::int as versus_wins,
  coalesce(sum(mp.score), 0)::int as total_score
from users u
join match_players mp on mp.user_id = u.id
join matches m on m.id = mp.match_id
group by u.id, u.name
order by wins desc, total_score desc, games desc
limit 20
`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]LeaderboardEntry, 0)
	for rows.Next() {
		var item LeaderboardEntry
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Games,
			&item.Wins,
			&item.CoopWins,
			&item.VersusWins,
			&item.TotalScore,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	initData := r.Header.Get("X-Telegram-Init-Data")
	if initData == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "missing init data"})
		return
	}

	userID, _, _, err := validateInitData(s.cfg.BotToken, initData)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid init data"})
		return
	}
	if userID != s.cfg.AdminTGID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	var totalUsers int
	var active7d int
	var totalMatches int
	var totalMoves int
	var avgDuration float64

	_ = s.db.QueryRow(r.Context(), `select count(*) from users`).Scan(&totalUsers)
	_ = s.db.QueryRow(r.Context(), `select count(*) from users where last_seen > now() - interval '7 days'`).Scan(&active7d)
	_ = s.db.QueryRow(r.Context(), `select count(*) from matches`).Scan(&totalMatches)
	_ = s.db.QueryRow(r.Context(), `select count(*) from move_events`).Scan(&totalMoves)
	_ = s.db.QueryRow(r.Context(), `select coalesce(avg(duration_sec), 0) from matches`).Scan(&avgDuration)

	modeRows, err := s.db.Query(r.Context(), `select mode, count(*)::int from matches group by mode`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer modeRows.Close()

	byMode := map[string]int{"solo": 0, "coop": 0, "versus": 0}
	for modeRows.Next() {
		var mode string
		var count int
		if err := modeRows.Scan(&mode, &count); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		byMode[mode] = count
	}

	topUsersRows, err := s.db.Query(r.Context(), `
select
  u.id,
  u.name,
  count(mp.match_id)::int as games,
  coalesce(sum(case when mp.result = 'win' then 1 else 0 end), 0)::int as wins,
  coalesce(sum(mp.score), 0)::int as total_score,
  u.last_seen
from users u
left join match_players mp on mp.user_id = u.id
group by u.id, u.name, u.last_seen
order by games desc, wins desc, total_score desc
limit 10
`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer topUsersRows.Close()

	topUsers := make([]AdminTopUser, 0)
	for topUsersRows.Next() {
		var row AdminTopUser
		if err := topUsersRows.Scan(&row.ID, &row.Name, &row.Games, &row.Wins, &row.TotalScore, &row.LastSeen); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		topUsers = append(topUsers, row)
	}

	recentRows, err := s.db.Query(r.Context(), `
select
  m.id,
  m.mode,
  m.rows,
  m.cols,
  m.mines,
  m.duration_sec,
  m.created_at,
  coalesce(string_agg(mp.name || ' (' || mp.score::text || ')', ', ' order by mp.score desc), '') as players
from matches m
left join match_players mp on mp.match_id = m.id
group by m.id, m.mode, m.rows, m.cols, m.mines, m.duration_sec, m.created_at
order by m.created_at desc
limit 10
`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer recentRows.Close()

	recentMatches := make([]AdminRecentMatch, 0)
	for recentRows.Next() {
		var row AdminRecentMatch
		if err := recentRows.Scan(
			&row.ID,
			&row.Mode,
			&row.Rows,
			&row.Cols,
			&row.Mines,
			&row.DurationSec,
			&row.CreatedAt,
			&row.Players,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		recentMatches = append(recentMatches, row)
	}

	s.mu.Lock()
	liveUsers := len(s.clients)
	liveRooms := len(s.rooms)
	liveGames := len(s.games)
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"summary": map[string]any{
			"totalUsers":   totalUsers,
			"active7d":     active7d,
			"totalMatches": totalMatches,
			"totalMoves":   totalMoves,
			"avgDuration":  int(avgDuration),
			"liveUsers":    liveUsers,
			"liveRooms":    liveRooms,
			"liveGames":    liveGames,
		},
		"byMode":        byMode,
		"topUsers":      topUsers,
		"recentMatches": recentMatches,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
