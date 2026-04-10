package app

import (
	"context"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func OpenDB(cfg Config) (*pgxpool.Pool, error) {
	db, err := pgxpool.New(context.Background(), cfg.DBDSN)
	if err != nil {
		return nil, err
	}

	if err := initSchema(context.Background(), db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initSchema(ctx context.Context, db *pgxpool.Pool) error {
	sql := `
create table if not exists users (
  id text primary key,
  name text not null,
  username text not null default '',
  last_seen timestamptz not null default now()
);

alter table users add column if not exists username text not null default '';

create table if not exists matches (
  id text primary key,
  mode text not null,
  room_code text,
  rows int not null,
  cols int not null,
  mines int not null,
  status text not null,
  winner_id text,
  duration_sec int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists match_players (
  match_id text not null references matches(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  score int not null default 0,
  result text not null,
  primary key (match_id, user_id)
);

create index if not exists idx_match_players_user_id on match_players(user_id);

create table if not exists move_events (
  id bigserial primary key,
  match_id text not null,
  user_id text not null,
  action text not null,
  cells_opened int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists banned_users (
  user_id text primary key,
  reason text not null default '',
  banned_by text not null default '',
  banned_at timestamptz not null default now()
);

create table if not exists user_skins (
  user_id text not null references users(id) on delete cascade,
  skin_id text not null,
  purchased_at timestamptz not null default now(),
  primary key (user_id, skin_id)
);

create table if not exists user_active_skin (
  user_id text primary key references users(id) on delete cascade,
  skin_id text not null
);

create table if not exists purchases (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  type text not null,
  skin_id text not null default '',
  amount_stars int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  user_id text primary key references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists privileged_users (
  user_id text primary key references users(id) on delete cascade,
  granted_by text not null,
  granted_at timestamptz not null default now()
);
`
	_, err := db.Exec(ctx, sql)
	return err
}

func (s *Server) upsertUser(id, name, username string) {
	_, _ = s.db.Exec(
		context.Background(),
		`insert into users (id, name, username, last_seen)
         values ($1, $2, $3, now())
         on conflict (id) do update
         set name = excluded.name,
             username = excluded.username,
             last_seen = now()`,
		id, name, username,
	)
}

func (s *Server) isUserBanned(userID string) bool {
	var exists bool
	err := s.db.QueryRow(
		context.Background(),
		`select exists(select 1 from banned_users where user_id = $1)`,
		userID,
	).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

func (s *Server) setUserBan(userID, adminID, reason string, banned bool) error {
	if banned {
		_, err := s.db.Exec(
			context.Background(),
			`insert into banned_users (user_id, reason, banned_by, banned_at)
             values ($1, $2, $3, now())
             on conflict (user_id) do update
             set reason = excluded.reason,
                 banned_by = excluded.banned_by,
                 banned_at = now()`,
			userID, reason, adminID,
		)
		if err != nil {
			return err
		}
		s.kickUser(userID)
		return nil
	}

	_, err := s.db.Exec(
		context.Background(),
		`delete from banned_users where user_id = $1`,
		userID,
	)
	return err
}

func (s *Server) kickUser(userID string) {
	var client *Client

	s.mu.Lock()
	client = s.clients[userID]
	delete(s.clients, userID)

	if s.currentGameLocked(userID) != nil {
		s.leaveCurrentGameLocked(userID)
	}
	s.mu.Unlock()

	if client != nil {
		close(client.Send)
		_ = client.Conn.Close()
	}
}

func (s *Server) getUserActiveSkin(ctx context.Context, userID string) string {
	var skinID string
	err := s.db.QueryRow(ctx,
		`select skin_id from user_active_skin where user_id = $1`,
		userID,
	).Scan(&skinID)
	if err != nil {
		return "default"
	}
	return skinID
}

func (s *Server) getUserOwnedSkins(ctx context.Context, userID string) []string {
	rows, err := s.db.Query(ctx,
		`select skin_id from user_skins where user_id = $1 order by purchased_at`,
		userID,
	)
	if err != nil {
		return []string{"default"}
	}
	defer rows.Close()

	skins := []string{"default"}
	for rows.Next() {
		var skinID string
		if err := rows.Scan(&skinID); err == nil && skinID != "default" {
			skins = append(skins, skinID)
		}
	}
	return skins
}

func (s *Server) purchaseSkinDB(ctx context.Context, userID, skinID string) error {
	_, err := s.db.Exec(ctx,
		`insert into user_skins (user_id, skin_id) values ($1, $2) on conflict do nothing`,
		userID, skinID,
	)
	if err != nil {
		return err
	}
	return s.setActiveSkinDB(ctx, userID, skinID)
}

func (s *Server) setActiveSkinDB(ctx context.Context, userID, skinID string) error {
	_, err := s.db.Exec(ctx,
		`insert into user_active_skin (user_id, skin_id) values ($1, $2)
         on conflict (user_id) do update set skin_id = excluded.skin_id`,
		userID, skinID,
	)
	return err
}

func (s *Server) recordPurchase(userID, purchaseType, skinID string, amountStars int) {
	_, _ = s.db.Exec(
		context.Background(),
		`insert into purchases (user_id, type, skin_id, amount_stars) values ($1, $2, $3, $4)`,
		userID, purchaseType, skinID, amountStars,
	)
}

func (s *Server) recordMove(matchID, userID, action string, cellsOpened int) {
	if strings.TrimSpace(matchID) == "" || strings.TrimSpace(userID) == "" {
		return
	}
	_, _ = s.db.Exec(
		context.Background(),
		`insert into move_events (match_id, user_id, action, cells_opened)
         values ($1, $2, $3, $4)`,
		matchID, userID, action, cellsOpened,
	)
}

func (s *Server) persistLaterLocked(g *Game) {
	if g.Persisted {
		return
	}
	g.Persisted = true
	snapshot := cloneGame(g)
	go s.persistMatch(snapshot)
}

func cloneGame(g *Game) *Game {
	// Construct field-by-field to avoid copying the sync.Mutex inside Game.
	names := make(map[string]string, len(g.Names))
	for k, v := range g.Names {
		names[k] = v
	}
	scores := make(map[string]int, len(g.Scores))
	for k, v := range g.Scores {
		scores[k] = v
	}
	hovers := make(map[string]int, len(g.Hovers))
	for k, v := range g.Hovers {
		hovers[k] = v
	}
	return &Game{
		ID:           g.ID,
		Mode:         g.Mode,
		Rows:         g.Rows,
		Cols:         g.Cols,
		Mines:        g.Mines,
		Board:        append([]Cell{}, g.Board...),
		Generated:    g.Generated,
		Players:      append([]string{}, g.Players...),
		Names:        names,
		Scores:       scores,
		Hovers:       hovers,
		Over:         g.Over,
		WinnerID:     g.WinnerID,
		EndReason:    g.EndReason,
		StartedAt:    g.StartedAt,
		EndedAt:      g.EndedAt,
		Persisted:    g.Persisted,
		RoomCode:     g.RoomCode,
		OwnerID:      g.OwnerID,
		LastAction:   g.LastAction,
		OpenedSafe:   g.OpenedSafe,
		FlaggedCount: g.FlaggedCount,
	}
}

func (s *Server) persistMatch(g *Game) {
	duration := 0
	if !g.EndedAt.IsZero() {
		duration = int(g.EndedAt.Sub(g.StartedAt).Seconds())
		if duration < 0 {
			duration = 0
		}
	}

	status := g.EndReason
	if status == "" {
		status = "finished"
	}

	_, err := s.db.Exec(
		context.Background(),
		`insert into matches (id, mode, room_code, rows, cols, mines, status, winner_id, duration_sec)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		g.ID,
		g.Mode,
		nullableString(g.RoomCode),
		g.Rows,
		g.Cols,
		g.Mines,
		status,
		nullableString(g.WinnerID),
		duration,
	)
	if err != nil {
		log.Printf("persist match error: %v", err)
		return
	}

	for _, pid := range g.Players {
		result := matchResultForPlayer(g, pid)
		_, err := s.db.Exec(
			context.Background(),
			`insert into match_players (match_id, user_id, name, score, result)
             values ($1, $2, $3, $4, $5)`,
			g.ID,
			pid,
			g.Names[pid],
			g.Scores[pid],
			result,
		)
		if err != nil {
			log.Printf("persist match player error: %v", err)
		}
	}
}

func nullableString(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func (s *Server) isUserSubscribed(ctx context.Context, userID string) bool {
	var exists bool
	_ = s.db.QueryRow(ctx,
		`select exists(select 1 from subscriptions where user_id = $1 and expires_at > now())`,
		userID,
	).Scan(&exists)
	return exists
}

func (s *Server) isUserPrivileged(ctx context.Context, userID string) bool {
	var exists bool
	_ = s.db.QueryRow(ctx,
		`select exists(select 1 from privileged_users where user_id = $1)`,
		userID,
	).Scan(&exists)
	return exists
}

func (s *Server) activateSubscription(userID string) error {
	_, err := s.db.Exec(context.Background(),
		`insert into subscriptions (user_id, expires_at)
         values ($1, now() + interval '30 days')
         on conflict (user_id) do update
         set expires_at = greatest(subscriptions.expires_at, now()) + interval '30 days'`,
		userID,
	)
	return err
}

func (s *Server) grantUserPrivilege(userID, grantedBy string) error {
	_, err := s.db.Exec(context.Background(),
		`insert into privileged_users (user_id, granted_by, granted_at)
         values ($1, $2, now())
         on conflict (user_id) do update
         set granted_by = excluded.granted_by,
             granted_at = now()`,
		userID, grantedBy,
	)
	return err
}

func (s *Server) revokeUserPrivilege(userID string) error {
	_, err := s.db.Exec(context.Background(),
		`delete from privileged_users where user_id = $1`,
		userID,
	)
	return err
}

func matchResultForPlayer(g *Game, playerID string) string {
	switch g.Mode {
	case "solo":
		if g.EndReason == "clear" {
			return "win"
		}
		return "loss"
	case "coop":
		if g.EndReason == "clear" {
			return "win"
		}
		return "loss"
	case "versus":
		if g.WinnerID == "" {
			return "draw"
		}
		if g.WinnerID == playerID {
			return "win"
		}
		return "loss"
	default:
		return "loss"
	}
}
