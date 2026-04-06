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
	out := *g
	out.Players = append([]string{}, g.Players...)
	out.Names = map[string]string{}
	out.Scores = map[string]int{}
	out.Hovers = map[string]int{}
	out.Board = append([]Cell{}, g.Board...)

	for k, v := range g.Names {
		out.Names[k] = v
	}
	for k, v := range g.Scores {
		out.Scores[k] = v
	}
	for k, v := range g.Hovers {
		out.Hovers[k] = v
	}

	return &out
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
