package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

func NewMux(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/leaderboard", s.handleLeaderboard)
	mux.HandleFunc("/api/admin/stats", s.handleAdminStats)
	mux.HandleFunc("/api/admin/ban", s.handleAdminBan)
	mux.HandleFunc("/api/admin/unban", s.handleAdminUnban)
	mux.HandleFunc("/api/internal/revive", s.handleInternalRevive)
	mux.HandleFunc("/api/internal/purchase_skin", s.handleInternalPurchaseSkin)
	mux.HandleFunc("/api/internal/purchase_shape", s.handleInternalPurchaseShape)
	mux.HandleFunc("/api/internal/subscribe", s.handleInternalSubscribe)
	mux.HandleFunc("/api/admin/grant-skin", s.handleAdminGrantSkin)
	mux.HandleFunc("/api/admin/revoke-skin", s.handleAdminRevokeSkin)
	mux.HandleFunc("/api/admin/grant-privilege", s.handleAdminGrantPrivilege)
	mux.HandleFunc("/api/admin/revoke-privilege", s.handleAdminRevokePrivilege)
	mux.HandleFunc("/ws", s.handleWS)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	if _, err := s.requireAdmin(r); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	items, err := s.queryLeaderboard(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireAdmin(r); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
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

	leaderboard, err := s.queryLeaderboard(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	topUsers, err := s.queryTopUsers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	users, err := s.queryRecentUsers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	recentMatches, err := s.queryRecentMatches(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	var totalRevives int
	_ = s.db.QueryRow(r.Context(), `select count(*) from purchases where type = 'revive'`).Scan(&totalRevives)

	var totalSubscriptions int
	_ = s.db.QueryRow(r.Context(), `select count(*) from purchases where type = 'subscription'`).Scan(&totalSubscriptions)

	var activeSubscriptions int
	_ = s.db.QueryRow(r.Context(), `select count(*) from subscriptions where expires_at > now()`).Scan(&activeSubscriptions)

	var privilegedCount int
	_ = s.db.QueryRow(r.Context(), `select count(*) from privileged_users`).Scan(&privilegedCount)

	skinRows, err := s.db.Query(r.Context(), `select skin_id, count(*)::int from purchases where type = 'skin' group by skin_id`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer skinRows.Close()
	skinPurchases := map[string]int{}
	for skinRows.Next() {
		var skinID string
		var cnt int
		if err := skinRows.Scan(&skinID, &cnt); err == nil {
			skinPurchases[skinID] = cnt
		}
	}

	s.mu.RLock()
	liveUsers := len(s.clients)
	liveRooms := len(s.rooms)
	liveGames := len(s.games)
	s.mu.RUnlock()

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
		"byMode": byMode,
		"purchases": map[string]any{
			"revives":            totalRevives,
			"skins":              skinPurchases,
			"subscriptions":      totalSubscriptions,
			"activeSubscriptions": activeSubscriptions,
			"privilegedUsers":    privilegedCount,
		},
		"leaderboard":   leaderboard,
		"users":         users,
		"topUsers":      topUsers,
		"recentMatches": recentMatches,
	})
}

func (s *Server) handleAdminBan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	adminID, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	if req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId is required"})
		return
	}
	if req.UserID == s.cfg.AdminTGID {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "admin ban is forbidden"})
		return
	}

	if err := s.setUserBan(req.UserID, adminID, strings.TrimSpace(req.Reason), true); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminUnban(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	_, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	if req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId is required"})
		return
	}

	if err := s.setUserBan(req.UserID, "", "", false); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) requireAdmin(r *http.Request) (string, error) {
	initData := strings.TrimSpace(r.Header.Get("X-Telegram-Init-Data"))
	if initData == "" {
		return "", http.ErrNoCookie
	}

	userID, _, _, err := validateInitData(s.cfg.BotToken, initData)
	if err != nil {
		return "", err
	}
	if userID != s.cfg.AdminTGID {
		return "", http.ErrNotSupported
	}
	return userID, nil
}

func (s *Server) queryLeaderboard(ctx context.Context) ([]LeaderboardEntry, error) {
	rows, err := s.db.Query(ctx, `
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
left join banned_users b on b.user_id = u.id
where b.user_id is null
group by u.id, u.name
order by wins desc, total_score desc, games desc
limit 20
`)
	if err != nil {
		return nil, err
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
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

func (s *Server) queryTopUsers(ctx context.Context) ([]AdminTopUser, error) {
	rows, err := s.db.Query(ctx, `
select
  u.id,
  u.name,
  coalesce(st.games, 0)::int as games,
  coalesce(st.wins, 0)::int as wins,
  coalesce(st.total_score, 0)::int as total_score,
  u.last_seen,
  (b.user_id is not null) as banned,
  (p.user_id is not null) as is_privileged
from users u
left join (
  select
    mp.user_id,
    count(mp.match_id)::int as games,
    coalesce(sum(case when mp.result = 'win' then 1 else 0 end), 0)::int as wins,
    coalesce(sum(mp.score), 0)::int as total_score
  from match_players mp
  group by mp.user_id
) st on st.user_id = u.id
left join banned_users b on b.user_id = u.id
left join privileged_users p on p.user_id = u.id
order by games desc, wins desc, total_score desc, u.last_seen desc
limit 15
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AdminTopUser, 0)
	for rows.Next() {
		var item AdminTopUser
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Games,
			&item.Wins,
			&item.TotalScore,
			&item.LastSeen,
			&item.Banned,
			&item.IsPrivileged,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

func (s *Server) queryRecentUsers(ctx context.Context) ([]AdminTopUser, error) {
	rows, err := s.db.Query(ctx, `
select
  u.id,
  u.name,
  coalesce(st.games, 0)::int as games,
  coalesce(st.wins, 0)::int as wins,
  coalesce(st.total_score, 0)::int as total_score,
  u.last_seen,
  (b.user_id is not null) as banned,
  (p.user_id is not null) as is_privileged
from users u
left join (
  select
    mp.user_id,
    count(mp.match_id)::int as games,
    coalesce(sum(case when mp.result = 'win' then 1 else 0 end), 0)::int as wins,
    coalesce(sum(mp.score), 0)::int as total_score
  from match_players mp
  group by mp.user_id
) st on st.user_id = u.id
left join banned_users b on b.user_id = u.id
left join privileged_users p on p.user_id = u.id
order by u.last_seen desc
limit 25
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AdminTopUser, 0)
	for rows.Next() {
		var item AdminTopUser
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Games,
			&item.Wins,
			&item.TotalScore,
			&item.LastSeen,
			&item.Banned,
			&item.IsPrivileged,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

func (s *Server) queryRecentMatches(ctx context.Context) ([]AdminRecentMatch, error) {
	rows, err := s.db.Query(ctx, `
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
		return nil, err
	}
	defer rows.Close()

	items := make([]AdminRecentMatch, 0)
	for rows.Next() {
		var item AdminRecentMatch
		if err := rows.Scan(
			&item.ID,
			&item.Mode,
			&item.Rows,
			&item.Cols,
			&item.Mines,
			&item.DurationSec,
			&item.CreatedAt,
			&item.Players,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

func (s *Server) handleInternalRevive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	var req struct {
		Secret   string `json:"secret"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Secret), []byte(s.cfg.InternalSecret)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	if err := s.revivePlayer(req.PlayerID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	s.recordPurchase(req.PlayerID, "revive", "", 2)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleInternalPurchaseSkin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	var req struct {
		Secret   string `json:"secret"`
		PlayerID string `json:"playerId"`
		SkinID   string `json:"skinId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Secret), []byte(s.cfg.InternalSecret)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	req.PlayerID = strings.TrimSpace(req.PlayerID)
	req.SkinID = strings.TrimSpace(req.SkinID)
	if req.PlayerID == "" || req.SkinID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "playerId and skinId are required"})
		return
	}

	if err := s.purchaseSkinForPlayer(req.PlayerID, req.SkinID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	s.recordPurchase(req.PlayerID, "skin", req.SkinID, 49)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleInternalPurchaseShape(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	var req struct {
		Secret   string `json:"secret"`
		PlayerID string `json:"playerId"`
		ShapeID  string `json:"shapeId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Secret), []byte(s.cfg.InternalSecret)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	req.PlayerID = strings.TrimSpace(req.PlayerID)
	req.ShapeID = strings.TrimSpace(req.ShapeID)
	if req.PlayerID == "" || req.ShapeID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "playerId and shapeId are required"})
		return
	}

	if err := s.purchaseShapeForPlayer(req.PlayerID, req.ShapeID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	s.recordPurchase(req.PlayerID, "shape", req.ShapeID, 79)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleInternalSubscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	var req struct {
		Secret   string `json:"secret"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Secret), []byte(s.cfg.InternalSecret)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	req.PlayerID = strings.TrimSpace(req.PlayerID)
	if req.PlayerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "playerId is required"})
		return
	}

	if err := s.activateSubscription(req.PlayerID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	s.recordPurchase(req.PlayerID, "subscription", "", 259)

	// Notify connected client immediately
	s.mu.RLock()
	c := s.clients[req.PlayerID]
	s.mu.RUnlock()
	if c != nil {
		c.HasSubscription = true
		s.send(c, map[string]any{
			"type":            "subscription_activated",
			"hasSubscription": true,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminGrantSkin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	_, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
		SkinID string `json:"skinId"` // specific skin ID or "all"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	req.SkinID = strings.TrimSpace(req.SkinID)
	if req.UserID == "" || req.SkinID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId and skinId are required"})
		return
	}

	if err := s.adminGrantSkin(req.UserID, req.SkinID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminRevokeSkin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	_, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
		SkinID string `json:"skinId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	req.SkinID = strings.TrimSpace(req.SkinID)
	if req.UserID == "" || req.SkinID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId and skinId are required"})
		return
	}

	ctx := r.Context()
	if err := s.revokeUserSkin(ctx, req.UserID, req.SkinID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// Notify connected client immediately
	s.mu.RLock()
	c := s.clients[req.UserID]
	s.mu.RUnlock()
	if c != nil {
		c.OwnedSkins = s.getUserOwnedSkins(ctx, req.UserID)
		if c.ActiveSkin == req.SkinID {
			c.ActiveSkin = "default"
		}
		s.send(c, map[string]any{
			"type":       "skin_revoked",
			"skinId":     req.SkinID,
			"activeSkin": c.ActiveSkin,
			"ownedSkins": c.OwnedSkins,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminGrantPrivilege(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	adminID, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	if req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId is required"})
		return
	}

	if err := s.grantUserPrivilege(req.UserID, adminID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// Update connected client immediately
	s.mu.RLock()
	c := s.clients[req.UserID]
	s.mu.RUnlock()
	if c != nil {
		c.IsPrivileged = true
		s.send(c, map[string]any{
			"type":         "privilege_granted",
			"isPrivileged": true,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminRevokePrivilege(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	_, err := s.requireAdmin(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": err.Error()})
		return
	}

	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}

	req.UserID = strings.TrimSpace(req.UserID)
	if req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId is required"})
		return
	}

	if err := s.revokeUserPrivilege(req.UserID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// Update connected client immediately
	s.mu.RLock()
	c := s.clients[req.UserID]
	s.mu.RUnlock()
	if c != nil {
		c.IsPrivileged = false
		s.send(c, map[string]any{
			"type":         "privilege_revoked",
			"isPrivileged": false,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
