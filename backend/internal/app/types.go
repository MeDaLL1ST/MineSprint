package app

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	ID              string
	Name            string
	Username        string
	Conn            *websocket.Conn
	Send            chan []byte
	ActiveSkin      string
	OwnedSkins      []string
	HasSubscription bool
	IsPrivileged    bool
}

type Cell struct {
	Mine     bool
	Opened   bool
	Flagged  bool
	Adj      int
	OpenedBy string
}

type Game struct {
	mu             sync.Mutex // protects all mutable Game fields
	ID             string
	Mode           string
	Rows           int
	Cols           int
	Mines          int
	Board          []Cell
	Generated      bool
	Players        []string
	Names          map[string]string
	Scores         map[string]int
	Hovers         map[string]int
	Skins          map[string]string // playerID -> skinID
	Over           bool
	WinnerID       string
	EndReason      string
	StartedAt      time.Time
	EndedAt        time.Time
	Persisted      bool
	RoomCode       string
	OwnerID        string
	LastAction     time.Time
	RevivedPlayers map[string]bool
}

type Room struct {
	Code       string
	OwnerID    string
	Game       *Game
	CreatedAt  time.Time
	EmptySince *time.Time
}

type Action struct {
	Type   string `json:"type"`
	Mode   string `json:"mode,omitempty"`
	Code   string `json:"code,omitempty"`
	Rows   int    `json:"rows,omitempty"`
	Cols   int    `json:"cols,omitempty"`
	Mines  int    `json:"mines,omitempty"`
	Cell   int    `json:"cell,omitempty"`
	SkinID string `json:"skinId,omitempty"`
}

type ClientCell struct {
	I  int    `json:"i"`
	O  bool   `json:"o"`
	F  bool   `json:"f"`
	M  bool   `json:"m,omitempty"`
	A  int    `json:"a,omitempty"`
	By string `json:"by,omitempty"`
}

type PlayerBrief struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Score  int    `json:"score"`
	SkinID string `json:"skinId,omitempty"`
}

type State struct {
	GameID     string         `json:"gameId"`
	RoomCode   string         `json:"roomCode,omitempty"`
	InviteLink string         `json:"inviteLink,omitempty"`
	ShareLink  string         `json:"shareLink,omitempty"`
	Mode       string         `json:"mode"`
	Online     bool           `json:"online"`
	OwnerID    string         `json:"ownerId,omitempty"`
	Rows       int            `json:"rows"`
	Cols       int            `json:"cols"`
	Mines      int            `json:"mines"`
	FlagsLeft  int            `json:"flagsLeft"`
	Generated  bool           `json:"generated"`
	Over       bool           `json:"over"`
	Won        bool           `json:"won"`
	WinnerID   string         `json:"winnerId,omitempty"`
	WinnerName string         `json:"winnerName,omitempty"`
	StartedAt  int64          `json:"startedAt"`
	EndedAt    int64          `json:"endedAt,omitempty"`
	You        PlayerBrief    `json:"you"`
	Players    []PlayerBrief  `json:"players"`
	Hovers     map[string]int `json:"hovers,omitempty"`
	Status     string         `json:"status"`
	Board      []ClientCell   `json:"board"`
	EndReason  string         `json:"endReason,omitempty"`
	CanRevive  bool           `json:"canRevive,omitempty"`
	ActiveSkin string         `json:"activeSkin,omitempty"`
	OwnedSkins []string       `json:"ownedSkins,omitempty"`
}

type LeaderboardEntry struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Games      int    `json:"games"`
	Wins       int    `json:"wins"`
	CoopWins   int    `json:"coopWins"`
	VersusWins int    `json:"versusWins"`
	TotalScore int    `json:"totalScore"`
}

type AdminTopUser struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Games        int       `json:"games"`
	Wins         int       `json:"wins"`
	TotalScore   int       `json:"totalScore"`
	LastSeen     time.Time `json:"lastSeen"`
	Banned       bool      `json:"banned"`
	IsPrivileged bool      `json:"isPrivileged"`
}

type AdminRecentMatch struct {
	ID          string    `json:"id"`
	Mode        string    `json:"mode"`
	Rows        int       `json:"rows"`
	Cols        int       `json:"cols"`
	Mines       int       `json:"mines"`
	DurationSec int       `json:"durationSec"`
	CreatedAt   time.Time `json:"createdAt"`
	Players     string    `json:"players"`
}
