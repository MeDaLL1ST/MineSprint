package app

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// getCoopCapacity returns the max players for a coop room based on owner's subscription/privilege.
// Returns 0 for unlimited (admin or admin-granted privilege), 10 for subscribed, 3 otherwise.
func (s *Server) getCoopCapacity(ownerID string) int {
	if ownerID == s.cfg.AdminTGID {
		return 0
	}
	ctx := context.Background()
	if s.isUserPrivileged(ctx, ownerID) {
		return 0
	}
	if s.isUserSubscribed(ctx, ownerID) {
		return 10
	}
	return 3
}

// maxFieldSize returns the maximum allowed board dimension for a client.
func (s *Server) maxFieldSize(c *Client) int {
	if c.ID == s.cfg.AdminTGID || c.IsPrivileged || c.HasSubscription {
		return 50
	}
	return 30
}

func (s *Server) startSolo(c *Client, rows, cols, mines int, shape string) {
	if shape == "" {
		shape = "square"
	}
	if !validShapeIDs[shape] {
		s.sendError(c, "Неизвестная форма карты")
		return
	}
	if !s.canUseShape(c, shape) {
		s.sendError(c, "Эта форма не куплена. Приобретите её или оформите Pro подписку (⭐ 259/мес)")
		return
	}
	if err := validateConfig(rows, cols, mines, s.maxFieldSize(c), shape); err != nil {
		s.sendError(c, err.Error())
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.leaveCurrentGameLocked(c.ID)

	game := newGame("solo", shape, rows, cols, mines, []string{c.ID}, map[string]string{c.ID: c.Name}, map[string]string{c.ID: c.ActiveSkin})
	s.games[game.ID] = game
	s.playerGame[c.ID] = game.ID
	s.sendStateLocked(c, game)
}

func (s *Server) createRoom(c *Client, mode string, rows, cols, mines int, shape string) {
	mode = normalizeMode(mode)
	if mode != "coop" && mode != "versus" {
		s.sendError(c, "Для комнаты доступны только coop и versus")
		return
	}
	if shape == "" {
		shape = "square"
	}
	if !validShapeIDs[shape] {
		s.sendError(c, "Неизвестная форма карты")
		return
	}
	if !s.canUseShape(c, shape) {
		s.sendError(c, "Эта форма не куплена. Приобретите её или оформите Pro подписку (⭐ 259/мес)")
		return
	}
	if err := validateConfig(rows, cols, mines, s.maxFieldSize(c), shape); err != nil {
		s.sendError(c, err.Error())
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.leaveCurrentGameLocked(c.ID)

	code := s.generateRoomCodeLocked()

	game := newGame(mode, shape, rows, cols, mines, []string{c.ID}, map[string]string{c.ID: c.Name}, map[string]string{c.ID: c.ActiveSkin})
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
			current.mu.Lock()
			s.sendStateLocked(c, current)
			current.mu.Unlock()
			return
		}
		s.leaveCurrentGameLocked(c.ID)
	}

	game := room.Game

	// Compute capacity before acquiring game.mu (DB call under s.mu is acceptable here)
	var capacity int
	if game.Mode == "coop" {
		capacity = s.getCoopCapacity(room.OwnerID)
	} else {
		capacity = 8 // versus: fixed capacity
	}

	game.mu.Lock()

	if !contains(game.Players, c.ID) {
		if capacity > 0 && len(game.Players) >= capacity {
			game.mu.Unlock()
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
		if game.Skins == nil {
			game.Skins = map[string]string{}
		}
		game.Skins[c.ID] = c.ActiveSkin
		s.playerGame[c.ID] = game.ID
	} else {
		// Player rejoining — refresh their skin
		if game.Skins == nil {
			game.Skins = map[string]string{}
		}
		game.Skins[c.ID] = c.ActiveSkin
	}

	if len(game.Players) == 1 || game.OwnerID == "" || !contains(game.Players, game.OwnerID) {
		game.OwnerID = c.ID
		room.OwnerID = c.ID
	}

	room.EmptySince = nil
	game.LastAction = time.Now()

	stateMsgs := s.buildBroadcastMsgs(game)
	game.mu.Unlock()

	s.send(c, map[string]any{
		"type":    "room_joined",
		"code":    code,
		"message": "Вы вошли в комнату " + code,
	})
	s.sendBroadcastLocked(stateMsgs)
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

func (s *Server) restartRoom(c *Client, newRows, newCols, newMines int, newShape string) {
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

	// Read old game's immutable-after-start fields under game.mu.
	game.mu.Lock()
	names := make(map[string]string, len(game.Players))
	oldSkins := make(map[string]string, len(game.Players))
	for _, pid := range game.Players {
		names[pid] = game.Names[pid]
		if game.Skins != nil {
			oldSkins[pid] = game.Skins[pid]
		}
	}
	players := append([]string{}, game.Players...)
	mode, rows, cols, mines, shape := game.Mode, game.Rows, game.Cols, game.Mines, game.Shape
	roomCode, ownerID, oldID := game.RoomCode, game.OwnerID, game.ID
	game.mu.Unlock()

	// If the caller is the room owner and provides a new valid config, apply it.
	if c.ID == ownerID && newRows > 0 && newCols > 0 && newMines > 0 {
		if newShape != "" {
			if !validShapeIDs[newShape] {
				s.sendError(c, "Неизвестная форма карты")
				return
			}
			if !s.canUseShape(c, newShape) {
				s.sendError(c, "Эта форма не куплена. Приобретите её или оформите Pro подписку (⭐ 259/мес)")
				return
			}
			shape = newShape
		}
		if err := validateConfig(newRows, newCols, newMines, s.maxFieldSize(c), shape); err != nil {
			s.sendError(c, err.Error())
			return
		}
		rows, cols, mines = newRows, newCols, newMines
	}

	next := newGame(mode, shape, rows, cols, mines, players, names, oldSkins)
	next.RoomCode = roomCode
	next.OwnerID = ownerID

	delete(s.games, oldID)
	s.games[next.ID] = next
	room.Game = next
	room.EmptySince = nil

	for _, pid := range next.Players {
		s.playerGame[pid] = next.ID
	}

	// next is a fresh game; no concurrent access possible yet.
	s.pushGameLocked(next)
}

func (s *Server) revealCell(c *Client, idx int) {
	s.mu.RLock()
	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.mu.RUnlock()
		s.sendError(c, "Нет активной игры")
		return
	}
	game.mu.Lock()
	s.mu.RUnlock()

	if game.Over || idx < 0 || idx >= len(game.Board) {
		game.mu.Unlock()
		return
	}

	game.LastAction = time.Now()

	if !game.Generated {
		generateBoard(game, idx)
		game.Generated = true
	}

	cell := &game.Board[idx]
	if cell.Opened || cell.Flagged || cell.Inactive {
		game.mu.Unlock()
		return
	}

	matchID := game.ID

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
		s.persistLaterLocked(game)
		msgs := s.buildBroadcastMsgs(game)
		game.mu.Unlock()
		s.sendBroadcast(msgs)
		go s.recordMove(matchID, c.ID, "explode", 0)
		return
	}

	openedCount := floodOpen(game, idx, c.ID)
	if openedCount <= 0 {
		game.mu.Unlock()
		return
	}

	game.OpenedSafe += openedCount
	game.Scores[c.ID] += openedCount

	if game.OpenedSafe == game.TotalSafe {
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

	msgs := s.buildBroadcastMsgs(game)
	game.mu.Unlock()
	s.sendBroadcast(msgs)
	go s.recordMove(matchID, c.ID, "reveal", openedCount)
}

func (s *Server) revivePlayer(playerID string) error {
	s.mu.RLock()
	game := s.currentGameLocked(playerID)
	if game == nil {
		s.mu.RUnlock()
		return errors.New("нет активной игры")
	}
	game.mu.Lock()
	s.mu.RUnlock()

	if !game.Over || game.EndReason != "mine" {
		game.mu.Unlock()
		return errors.New("игра не завершилась взрывом")
	}
	if game.RevivedPlayers == nil {
		game.RevivedPlayers = make(map[string]bool)
	}
	if game.RevivedPlayers[playerID] {
		game.mu.Unlock()
		return errors.New("возрождение уже использовано")
	}
	hitMine := false
	for _, cell := range game.Board {
		if cell.Mine && cell.Opened && cell.OpenedBy == playerID {
			hitMine = true
			break
		}
	}
	if !hitMine {
		game.mu.Unlock()
		return errors.New("игрок не попал на мину")
	}

	game.Over = false
	game.EndReason = ""
	game.WinnerID = ""
	game.EndedAt = time.Time{}
	game.RevivedPlayers[playerID] = true
	game.LastAction = time.Now()

	msgs := s.buildBroadcastMsgs(game)
	game.mu.Unlock()
	s.sendBroadcast(msgs)
	return nil
}

func (s *Server) toggleFlag(c *Client, idx int) {
	s.mu.RLock()
	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.mu.RUnlock()
		return
	}
	game.mu.Lock()
	s.mu.RUnlock()

	if game.Over || idx < 0 || idx >= len(game.Board) {
		game.mu.Unlock()
		return
	}

	game.LastAction = time.Now()
	matchID := game.ID

	cell := &game.Board[idx]
	if cell.Opened || cell.Inactive {
		game.mu.Unlock()
		return
	}

	var action string
	if cell.Flagged {
		cell.Flagged = false
		game.FlaggedCount--
		action = "unflag"
	} else {
		if game.FlaggedCount >= game.Mines {
			game.mu.Unlock()
			s.sendError(c, "Лимит флагов достигнут")
			return
		}
		cell.Flagged = true
		game.FlaggedCount++
		action = "flag"
	}

	msgs := s.buildBroadcastMsgs(game)
	game.mu.Unlock()
	s.sendBroadcast(msgs)
	go s.recordMove(matchID, c.ID, action, 0)
}

func (s *Server) setHover(c *Client, idx int) {
	s.mu.RLock()
	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.mu.RUnlock()
		return
	}
	game.mu.Lock()
	s.mu.RUnlock()

	if game.Mode == "solo" {
		game.mu.Unlock()
		return
	}
	if game.Hovers == nil {
		game.Hovers = map[string]int{}
	}

	if idx < 0 || idx >= len(game.Board) {
		if _, ok := game.Hovers[c.ID]; ok {
			delete(game.Hovers, c.ID)
			msgs := s.buildHoverMsgs(game, c.ID, -1, false)
			game.mu.Unlock()
			s.sendBroadcast(msgs)
			return
		}
		game.mu.Unlock()
		return
	}

	if prev, ok := game.Hovers[c.ID]; ok && prev == idx {
		game.mu.Unlock()
		return
	}

	game.Hovers[c.ID] = idx
	msgs := s.buildHoverMsgs(game, c.ID, idx, true)
	game.mu.Unlock()
	s.sendBroadcast(msgs)
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

	game.mu.Lock()

	game.LastAction = time.Now()

	if game.Mode == "solo" {
		game.mu.Unlock()
		delete(s.playerGame, playerID)
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
			game.mu.Unlock()
			delete(s.playerGame, playerID)
			delete(s.games, game.ID)
			return
		}
		if game.OwnerID == playerID || !contains(game.Players, game.OwnerID) {
			game.OwnerID = game.Players[0]
		}
		// Build messages while game.mu is held, then unlock and broadcast.
		hoverMsgs := s.buildHoverMsgs(game, playerID, -1, false)
		stateMsgs := s.buildBroadcastMsgs(game)
		game.mu.Unlock()
		delete(s.playerGame, playerID)
		// s.mu write-lock is held by caller; send directly via s.clients.
		s.sendBroadcastLocked(hoverMsgs)
		s.sendBroadcastLocked(stateMsgs)
		return
	}

	if len(game.Players) == 0 {
		game.OwnerID = ""
		room.OwnerID = ""
		now := time.Now()
		room.EmptySince = &now
		game.mu.Unlock()
		delete(s.playerGame, playerID)
		return
	}

	room.EmptySince = nil
	if game.OwnerID == playerID || !contains(game.Players, game.OwnerID) {
		game.OwnerID = game.Players[0]
		room.OwnerID = game.OwnerID
	}
	hoverMsgs := s.buildHoverMsgs(game, playerID, -1, false)
	stateMsgs := s.buildBroadcastMsgs(game)
	game.mu.Unlock()
	delete(s.playerGame, playerID)
	s.sendBroadcastLocked(hoverMsgs)
	s.sendBroadcastLocked(stateMsgs)
}

func (s *Server) buildStateLocked(g *Game, playerID string) State {
	board := make([]ClientCell, 0, len(g.Board))
	for i, cell := range g.Board {
		cc := ClientCell{
			I: i,
			O: cell.Opened,
			F: cell.Flagged,
			D: cell.Inactive,
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
		skin := ""
		if g.Skins != nil {
			skin = g.Skins[pid]
		}
		players = append(players, PlayerBrief{
			ID:     pid,
			Name:   g.Names[pid],
			Score:  g.Scores[pid],
			SkinID: skin,
		})
	}
	sort.SliceStable(players, func(i, j int) bool {
		if players[i].Score == players[j].Score {
			return players[i].Name < players[j].Name
		}
		return players[i].Score > players[j].Score
	})

	flagsLeft := g.Mines - g.FlaggedCount
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

	canRevive := false
	if g.Over && g.EndReason == "mine" {
		alreadyRevived := g.RevivedPlayers != nil && g.RevivedPlayers[playerID]
		if !alreadyRevived {
			for _, cell := range g.Board {
				if cell.Mine && cell.Opened && cell.OpenedBy == playerID {
					canRevive = true
					break
				}
			}
		}
	}

	mySkin := ""
	if g.Skins != nil {
		mySkin = g.Skins[playerID]
	}

	return State{
		GameID:     g.ID,
		RoomCode:   g.RoomCode,
		InviteLink: s.buildInviteLink(g.RoomCode),
		ShareLink:  s.buildShareLink(g.RoomCode),
		Mode:       g.Mode,
		Shape:      g.Shape,
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
		EndedAt:    func() int64 {
			if g.Over && !g.EndedAt.IsZero() {
				return g.EndedAt.Unix()
			}
			return 0
		}(),
		You: PlayerBrief{
			ID:     playerID,
			Name:   g.Names[playerID],
			Score:  g.Scores[playerID],
			SkinID: mySkin,
		},
		Players:    players,
		Hovers:     hovers,
		Status:     statusText(g, playerID),
		Board:      board,
		EndReason:  g.EndReason,
		CanRevive:  canRevive,
		ActiveSkin: mySkin,
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

func validateConfig(rows, cols, mines, maxSize int, shape string) error {
	if rows < 5 || rows > maxSize {
		return fmt.Errorf("rows: допустимо от 5 до %d", maxSize)
	}
	if cols < 5 || cols > maxSize {
		return fmt.Errorf("cols: допустимо от 5 до %d", maxSize)
	}
	maxMines := rows*cols - 1
	if shape != "" && shape != "square" {
		active := countActiveCells(shape, rows, cols)
		if active < 2 {
			return fmt.Errorf("форма слишком мала для заданного размера поля")
		}
		maxMines = active - 1
	}
	if mines < 1 || mines > maxMines {
		return fmt.Errorf("mines: допустимо от 1 до %d", maxMines)
	}
	return nil
}

// getShapeMask returns a boolean slice of length rows*cols where true = active (playable) cell.
func getShapeMask(shape string, rows, cols int) []bool {
	total := rows * cols
	mask := make([]bool, total)
	switch shape {
	case "", "square":
		for i := range mask {
			mask[i] = true
		}
	case "circle":
		cr := float64(rows-1) / 2.0
		cc := float64(cols-1) / 2.0
		rr := math.Min(cr, cc)
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				dr := float64(row) - cr
				dc := float64(col) - cc
				if rr > 0 && dr*dr/(rr*rr)+dc*dc/(rr*rr) <= 1.0 {
					mask[row*cols+col] = true
				}
			}
		}
	case "diamond":
		cr := float64(rows-1) / 2.0
		cc := float64(cols-1) / 2.0
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				var dr, dc float64
				if cr > 0 {
					dr = math.Abs(float64(row)-cr) / cr
				}
				if cc > 0 {
					dc = math.Abs(float64(col)-cc) / cc
				}
				if dr+dc <= 1.0 {
					mask[row*cols+col] = true
				}
			}
		}
	case "cross":
		midRow := rows / 2
		midCol := cols / 2
		halfW := max(1, min(rows, cols)/6)
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				inRow := abs(row-midRow) <= halfW
				inCol := abs(col-midCol) <= halfW
				mask[row*cols+col] = inRow || inCol
			}
		}
	case "x_shape":
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				thickness := math.Max(float64(min(rows, cols))/4.0, 2.0)
				var d1, d2 float64
				if rows > 1 {
					ratio := float64(row) / float64(rows-1)
					d1 = math.Abs(float64(col) - ratio*float64(cols-1))
					d2 = math.Abs(float64(col) - (1.0-ratio)*float64(cols-1))
				}
				mask[row*cols+col] = d1 <= thickness || d2 <= thickness
			}
		}
	case "frame_x":
		// Border thickness scales with field size: at least 2 cells, ~1/8 of the shorter side.
		bt := max(2, min(rows, cols)/8)
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				isBorder := row < bt || row >= rows-bt || col < bt || col >= cols-bt
				var isX bool
				if rows > 1 {
					thickness := math.Max(float64(min(rows, cols))/8.0, 1.5)
					ratio := float64(row) / float64(rows-1)
					d1 := math.Abs(float64(col) - ratio*float64(cols-1))
					d2 := math.Abs(float64(col) - (1.0-ratio)*float64(cols-1))
					isX = d1 <= thickness || d2 <= thickness
				}
				mask[row*cols+col] = isBorder || isX
			}
		}
	}
	return mask
}

func countActiveCells(shape string, rows, cols int) int {
	mask := getShapeMask(shape, rows, cols)
	n := 0
	for _, active := range mask {
		if active {
			n++
		}
	}
	return n
}

var validShapeIDs = map[string]bool{
	"square":  true,
	"circle":  true,
	"diamond": true,
	"cross":   true,
	"x_shape": true,
	"frame_x": true,
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func (s *Server) canUseShape(c *Client, shapeID string) bool {
	if shapeID == "" || shapeID == "square" {
		return true
	}
	if c.ID == s.cfg.AdminTGID || c.IsPrivileged || c.HasSubscription {
		return true
	}
	return c.OwnedShapeSet[shapeID]
}

func newGame(mode, shape string, rows, cols, mines int, players []string, names map[string]string, skins map[string]string) *Game {
	if shape == "" {
		shape = "square"
	}
	scores := map[string]int{}
	playerNames := map[string]string{}
	gameSkins := map[string]string{}
	for _, pid := range players {
		scores[pid] = 0
		playerNames[pid] = names[pid]
		if skins != nil {
			if s, ok := skins[pid]; ok {
				gameSkins[pid] = s
			}
		}
	}

	board := make([]Cell, rows*cols)
	mask := getShapeMask(shape, rows, cols)
	activeCount := 0
	for i, active := range mask {
		if !active {
			board[i].Inactive = true
		} else {
			activeCount++
		}
	}
	totalSafe := activeCount - mines
	if totalSafe < 0 {
		totalSafe = 0
	}

	return &Game{
		ID:         uuid.NewString(),
		Mode:       mode,
		Shape:      shape,
		Rows:       rows,
		Cols:       cols,
		Mines:      mines,
		Board:      board,
		TotalSafe:  totalSafe,
		Players:    append([]string{}, players...),
		Names:      playerNames,
		Scores:     scores,
		Hovers:     map[string]int{},
		Skins:      gameSkins,
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
		if i != safeIdx && !g.Board[i].Inactive {
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
		if g.Board[i].Mine || g.Board[i].Inactive {
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
	if g.Board[start].Opened || g.Board[start].Flagged || g.Board[start].Mine || g.Board[start].Inactive {
		return 0
	}

	queue := []int{start}
	seen := map[int]bool{start: true}
	opened := 0

	for len(queue) > 0 {
		idx := queue[0]
		queue = queue[1:]

		cell := &g.Board[idx]
		if cell.Opened || cell.Flagged || cell.Mine || cell.Inactive {
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
			if nc.Opened || nc.Flagged || nc.Mine || nc.Inactive {
				continue
			}
			seen[nb] = true
			queue = append(queue, nb)
		}
	}

	return opened
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
