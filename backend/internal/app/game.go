package app

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *Server) startSolo(c *Client, rows, cols, mines int) {
	if err := validateConfig(rows, cols, mines); err != nil {
		s.sendError(c, err.Error())
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.leaveCurrentGameLocked(c.ID)

	game := newGame("solo", rows, cols, mines, []string{c.ID}, map[string]string{c.ID: c.Name})
	s.games[game.ID] = game
	s.playerGame[c.ID] = game.ID
	s.sendStateLocked(c, game)
}

func (s *Server) createRoom(c *Client, mode string, rows, cols, mines int) {
	mode = normalizeMode(mode)
	if mode != "coop" && mode != "versus" {
		s.sendError(c, "Для комнаты доступны только coop и versus")
		return
	}
	if err := validateConfig(rows, cols, mines); err != nil {
		s.sendError(c, err.Error())
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.leaveCurrentGameLocked(c.ID)

	code := s.generateRoomCodeLocked()

	game := newGame(mode, rows, cols, mines, []string{c.ID}, map[string]string{c.ID: c.Name})
	game.RoomCode = code
	game.OwnerID = c.ID

	room := &Room{
		Code:      code,
		OwnerID:   c.ID,
		Game:      game,
		CreatedAt: time.Now(),
	}

	s.rooms[code] = room
	s.games[game.ID] = game
	s.playerGame[c.ID] = game.ID

	s.send(c, map[string]any{
		"type":      "room_created",
		"code":      code,
		"link":      s.buildInviteLink(code),
		"shareLink": s.buildShareLink(code),
	})

	s.pushGameLocked(game)
}

func (s *Server) joinRoom(c *Client, code string) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		s.sendError(c, "Укажи код комнаты")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	room := s.rooms[code]
	if room == nil || room.Game == nil {
		s.sendError(c, "Комната не найдена")
		return
	}

	if current := s.currentGameLocked(c.ID); current != nil {
		if current.RoomCode == code {
			s.sendStateLocked(c, current)
			return
		}
		s.leaveCurrentGameLocked(c.ID)
	}

	game := room.Game

	if !contains(game.Players, c.ID) {
		if len(game.Players) >= 8 {
			s.sendError(c, "Комната заполнена")
			return
		}
		game.Players = append(game.Players, c.ID)
		game.Names[c.ID] = c.Name
		if _, ok := game.Scores[c.ID]; !ok {
			game.Scores[c.ID] = 0
		}
		if game.Hovers == nil {
			game.Hovers = map[string]int{}
		}
		s.playerGame[c.ID] = game.ID
	}

	if len(game.Players) == 1 || game.OwnerID == "" || !contains(game.Players, game.OwnerID) {
		game.OwnerID = c.ID
		room.OwnerID = c.ID
	}

	room.EmptySince = nil
	game.LastAction = time.Now()

	s.send(c, map[string]any{
		"type":    "room_joined",
		"code":    code,
		"message": "Вы вошли в комнату " + code,
	})

	s.pushGameLocked(game)
}

func (s *Server) leaveRoom(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.currentGameLocked(c.ID) == nil {
		return
	}

	s.leaveCurrentGameLocked(c.ID)

	s.send(c, map[string]any{
		"type":    "left_room",
		"message": "Вы вышли из комнаты",
	})
}

func (s *Server) restartRoom(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	game := s.currentGameLocked(c.ID)
	if game == nil || game.Mode == "solo" {
		s.sendError(c, "Нет активной комнаты")
		return
	}

	room := s.rooms[game.RoomCode]
	if room == nil {
		s.sendError(c, "Комната не найдена")
		return
	}

	names := map[string]string{}
	for _, pid := range game.Players {
		names[pid] = game.Names[pid]
	}

	next := newGame(game.Mode, game.Rows, game.Cols, game.Mines, append([]string{}, game.Players...), names)
	next.RoomCode = game.RoomCode
	next.OwnerID = game.OwnerID

	delete(s.games, game.ID)
	s.games[next.ID] = next
	room.Game = next
	room.EmptySince = nil

	for _, pid := range next.Players {
		s.playerGame[pid] = next.ID
	}

	s.pushGameLocked(next)
}

func (s *Server) revealCell(c *Client, idx int) {
	var matchID string
	var openedCount int
	var action string

	s.mu.Lock()
	defer s.mu.Unlock()

	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.sendError(c, "Нет активной игры")
		return
	}
	if game.Over {
		return
	}
	if idx < 0 || idx >= len(game.Board) {
		return
	}

	game.LastAction = time.Now()

	if !game.Generated {
		generateBoard(game, idx)
		game.Generated = true
	}

	cell := &game.Board[idx]
	if cell.Opened || cell.Flagged {
		return
	}

	matchID = game.ID

	if cell.Mine {
		cell.Opened = true
		cell.OpenedBy = c.ID
		game.Over = true
		game.EndedAt = time.Now()
		game.EndReason = "mine"

		switch game.Mode {
		case "versus":
			game.WinnerID = determineVersusWinner(game, c.ID)
		default:
			game.WinnerID = ""
		}

		action = "explode"
		s.persistLaterLocked(game)
		s.pushGameLocked(game)
		go s.recordMove(matchID, c.ID, action, 0)
		return
	}

	openedCount = floodOpen(game, idx, c.ID)
	if openedCount <= 0 {
		return
	}

	game.Scores[c.ID] += openedCount
	action = "reveal"

	if allSafeOpened(game) {
		game.Over = true
		game.EndedAt = time.Now()
		game.EndReason = "clear"

		switch game.Mode {
		case "solo":
			game.WinnerID = c.ID
		case "coop":
			game.WinnerID = ""
		case "versus":
			game.WinnerID = determineVersusWinner(game, "")
		}

		s.persistLaterLocked(game)
	}

	s.pushGameLocked(game)
	go s.recordMove(matchID, c.ID, action, openedCount)
}

func (s *Server) toggleFlag(c *Client, idx int) {
	var matchID string

	s.mu.Lock()
	defer s.mu.Unlock()

	game := s.currentGameLocked(c.ID)
	if game == nil || game.Over {
		return
	}
	if idx < 0 || idx >= len(game.Board) {
		return
	}

	game.LastAction = time.Now()
	matchID = game.ID

	cell := &game.Board[idx]
	if cell.Opened {
		return
	}

	flagged := countFlagged(game)
	if cell.Flagged {
		cell.Flagged = false
		s.pushGameLocked(game)
		go s.recordMove(matchID, c.ID, "unflag", 0)
		return
	}
	if flagged >= game.Mines {
		s.sendError(c, "Лимит флагов достигнут")
		return
	}

	cell.Flagged = true
	s.pushGameLocked(game)
	go s.recordMove(matchID, c.ID, "flag", 0)
}

func (s *Server) setHover(c *Client, idx int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	game := s.currentGameLocked(c.ID)
	if game == nil || game.Mode == "solo" {
		return
	}
	if game.Hovers == nil {
		game.Hovers = map[string]int{}
	}

	if idx < 0 || idx >= len(game.Board) {
		if _, ok := game.Hovers[c.ID]; ok {
			delete(game.Hovers, c.ID)
			s.pushHoverLocked(game, c.ID, -1, false)
		}
		return
	}

	if prev, ok := game.Hovers[c.ID]; ok && prev == idx {
		return
	}

	game.Hovers[c.ID] = idx
	s.pushHoverLocked(game, c.ID, idx, true)
}

func (s *Server) pushHoverLocked(g *Game, playerID string, cell int, active bool) {
	for _, pid := range g.Players {
		if c := s.clients[pid]; c != nil {
			s.send(c, map[string]any{
				"type":     "hover",
				"playerId": playerID,
				"cell":     cell,
				"active":   active,
			})
		}
	}
}

func (s *Server) leaveCurrentGameLocked(playerID string) {
	game := s.currentGameLocked(playerID)
	if game == nil {
		return
	}

	delete(s.playerGame, playerID)
	game.LastAction = time.Now()

	if game.Mode == "solo" {
		delete(s.games, game.ID)
		return
	}

	room := s.rooms[game.RoomCode]

	if game.Hovers != nil {
		delete(game.Hovers, playerID)
	}

	game.Players = removePlayer(game.Players, playerID)
	delete(game.Names, playerID)
	delete(game.Scores, playerID)

	if room == nil {
		if len(game.Players) == 0 {
			delete(s.games, game.ID)
			return
		}
		if game.OwnerID == playerID || !contains(game.Players, game.OwnerID) {
			game.OwnerID = game.Players[0]
		}
		s.pushHoverLocked(game, playerID, -1, false)
		s.pushGameLocked(game)
		return
	}

	if len(game.Players) == 0 {
		game.OwnerID = ""
		room.OwnerID = ""
		now := time.Now()
		room.EmptySince = &now
		return
	}

	room.EmptySince = nil

	if game.OwnerID == playerID || !contains(game.Players, game.OwnerID) {
		game.OwnerID = game.Players[0]
		room.OwnerID = game.OwnerID
	}

	s.pushHoverLocked(game, playerID, -1, false)
	s.pushGameLocked(game)
}

func (s *Server) buildStateLocked(g *Game, playerID string) State {
	board := make([]ClientCell, 0, len(g.Board))
	for i, cell := range g.Board {
		cc := ClientCell{
			I: i,
			O: cell.Opened,
			F: cell.Flagged,
		}
		if cell.Opened {
			cc.A = cell.Adj
			cc.By = cell.OpenedBy
			if cell.Mine {
				cc.M = true
			}
		}
		if g.Over && cell.Mine {
			cc.M = true
		}
		board = append(board, cc)
	}

	players := make([]PlayerBrief, 0, len(g.Players))
	for _, pid := range g.Players {
		players = append(players, PlayerBrief{
			ID:    pid,
			Name:  g.Names[pid],
			Score: g.Scores[pid],
		})
	}
	sort.SliceStable(players, func(i, j int) bool {
		if players[i].Score == players[j].Score {
			return players[i].Name < players[j].Name
		}
		return players[i].Score > players[j].Score
	})

	flagsLeft := g.Mines - countFlagged(g)
	if flagsLeft < 0 {
		flagsLeft = 0
	}

	winnerName := ""
	if g.WinnerID != "" {
		winnerName = g.Names[g.WinnerID]
	}

	hovers := map[string]int{}
	for pid, cell := range g.Hovers {
		if contains(g.Players, pid) {
			hovers[pid] = cell
		}
	}
	if len(hovers) == 0 {
		hovers = nil
	}

	return State{
		GameID:     g.ID,
		RoomCode:   g.RoomCode,
		InviteLink: s.buildInviteLink(g.RoomCode),
		ShareLink:  s.buildShareLink(g.RoomCode),
		Mode:       g.Mode,
		Online:     g.Mode != "solo",
		OwnerID:    g.OwnerID,
		Rows:       g.Rows,
		Cols:       g.Cols,
		Mines:      g.Mines,
		FlagsLeft:  flagsLeft,
		Generated:  g.Generated,
		Over:       g.Over,
		Won:        wonForPlayer(g, playerID),
		WinnerID:   g.WinnerID,
		WinnerName: winnerName,
		StartedAt:  g.StartedAt.Unix(),
		You: PlayerBrief{
			ID:    playerID,
			Name:  g.Names[playerID],
			Score: g.Scores[playerID],
		},
		Players: players,
		Hovers:  hovers,
		Status:  statusText(g, playerID),
		Board:   board,
	}
}

func (s *Server) buildInviteLink(code string) string {
	if strings.TrimSpace(code) == "" {
		return ""
	}
	if s.cfg.PublicBaseURL == "" {
		return "/?room=" + code
	}
	return s.cfg.PublicBaseURL + "/?room=" + code
}

func (s *Server) buildShareLink(code string) string {
	if strings.TrimSpace(code) == "" {
		return ""
	}
	if strings.TrimSpace(s.cfg.BotUsername) == "" {
		return s.buildInviteLink(code)
	}
	return "https://t.me/" + s.cfg.BotUsername + "?start=room_" + code
}

func statusText(g *Game, playerID string) string {
	if !g.Over {
		switch g.Mode {
		case "solo":
			return "Открой все безопасные клетки. Первый ход всегда безопасен."
		case "coop":
			return "Разминируйте поле вместе. Любая мина завершит раунд."
		case "versus":
			return "Соревнуйтесь за очки на одном поле. Мина завершает матч."
		}
	}

	switch g.Mode {
	case "solo":
		if g.EndReason == "clear" {
			return "Победа"
		}
		return "Вы проиграли"
	case "coop":
		if g.EndReason == "clear" {
			return "Поле обезврежено"
		}
		return "Мина взорвалась — раунд проигран"
	case "versus":
		if g.WinnerID == "" {
			return "Ничья"
		}
		if g.WinnerID == playerID {
			return "Вы победили"
		}
		return "Победил " + g.Names[g.WinnerID]
	}

	return "Игра завершена"
}

func wonForPlayer(g *Game, playerID string) bool {
	if !g.Over {
		return false
	}
	switch g.Mode {
	case "solo":
		return g.EndReason == "clear"
	case "coop":
		return g.EndReason == "clear"
	case "versus":
		return g.WinnerID == playerID && g.WinnerID != ""
	default:
		return false
	}
}

func normalizeMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "coop":
		return "coop"
	case "versus":
		return "versus"
	default:
		return "solo"
	}
}

func validateConfig(rows, cols, mines int) error {
	if rows < 5 || rows > 30 {
		return fmt.Errorf("rows: допустимо от 5 до 30")
	}
	if cols < 5 || cols > 30 {
		return fmt.Errorf("cols: допустимо от 5 до 30")
	}
	maxMines := rows*cols - 1
	if mines < 1 || mines > maxMines {
		return fmt.Errorf("mines: допустимо от 1 до %d", maxMines)
	}
	return nil
}

func newGame(mode string, rows, cols, mines int, players []string, names map[string]string) *Game {
	scores := map[string]int{}
	playerNames := map[string]string{}
	for _, pid := range players {
		scores[pid] = 0
		playerNames[pid] = names[pid]
	}

	return &Game{
		ID:         uuid.NewString(),
		Mode:       mode,
		Rows:       rows,
		Cols:       cols,
		Mines:      mines,
		Board:      make([]Cell, rows*cols),
		Players:    append([]string{}, players...),
		Names:      playerNames,
		Scores:     scores,
		Hovers:     map[string]int{},
		StartedAt:  time.Now(),
		LastAction: time.Now(),
	}
}

func (s *Server) generateRoomCodeLocked() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		var b strings.Builder
		for i := 0; i < 6; i++ {
			b.WriteByte(alphabet[rand.Intn(len(alphabet))])
		}
		code := b.String()
		if _, exists := s.rooms[code]; !exists {
			return code
		}
	}
}

func generateBoard(g *Game, safeIdx int) {
	total := len(g.Board)
	candidates := make([]int, 0, total-1)
	for i := 0; i < total; i++ {
		if i != safeIdx {
			candidates = append(candidates, i)
		}
	}

	rand.Shuffle(len(candidates), func(i, j int) {
		candidates[i], candidates[j] = candidates[j], candidates[i]
	})

	for i := 0; i < g.Mines && i < len(candidates); i++ {
		g.Board[candidates[i]].Mine = true
	}

	for i := range g.Board {
		if g.Board[i].Mine {
			continue
		}
		count := 0
		for _, nb := range neighbors(g.Rows, g.Cols, i) {
			if g.Board[nb].Mine {
				count++
			}
		}
		g.Board[i].Adj = count
	}
}

func neighbors(rows, cols, idx int) []int {
	r := idx / cols
	c := idx % cols
	out := make([]int, 0, 8)

	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if dr == 0 && dc == 0 {
				continue
			}
			nr := r + dr
			nc := c + dc
			if nr < 0 || nr >= rows || nc < 0 || nc >= cols {
				continue
			}
			out = append(out, nr*cols+nc)
		}
	}
	return out
}

func floodOpen(g *Game, start int, playerID string) int {
	if start < 0 || start >= len(g.Board) {
		return 0
	}
	if g.Board[start].Opened || g.Board[start].Flagged || g.Board[start].Mine {
		return 0
	}

	queue := []int{start}
	seen := map[int]bool{start: true}
	opened := 0

	for len(queue) > 0 {
		idx := queue[0]
		queue = queue[1:]

		cell := &g.Board[idx]
		if cell.Opened || cell.Flagged || cell.Mine {
			continue
		}

		cell.Opened = true
		cell.OpenedBy = playerID
		opened++

		if cell.Adj != 0 {
			continue
		}

		for _, nb := range neighbors(g.Rows, g.Cols, idx) {
			if seen[nb] {
				continue
			}
			nc := &g.Board[nb]
			if nc.Opened || nc.Flagged || nc.Mine {
				continue
			}
			seen[nb] = true
			queue = append(queue, nb)
		}
	}

	return opened
}

func allSafeOpened(g *Game) bool {
	openedSafe := 0
	for _, cell := range g.Board {
		if !cell.Mine && cell.Opened {
			openedSafe++
		}
	}
	return openedSafe == len(g.Board)-g.Mines
}

func countFlagged(g *Game) int {
	n := 0
	for _, cell := range g.Board {
		if cell.Flagged {
			n++
		}
	}
	return n
}

func determineVersusWinner(g *Game, excludeID string) string {
	bestScore := -1
	winner := ""
	tied := false

	for _, pid := range g.Players {
		if pid == excludeID {
			continue
		}
		score := g.Scores[pid]
		if score > bestScore {
			bestScore = score
			winner = pid
			tied = false
		} else if score == bestScore {
			tied = true
		}
	}

	if bestScore < 0 || tied {
		return ""
	}
	return winner
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func removePlayer(items []string, playerID string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item != playerID {
			out = append(out, item)
		}
	}
	return out
}
