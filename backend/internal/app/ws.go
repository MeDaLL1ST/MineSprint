package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
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

	starCredits := s.getStarCredits(context.Background(), client.ID)

	s.send(client, map[string]any{
		"type": "hello",
		"user": map[string]any{
			"id":       client.ID,
			"name":     client.Name,
			"username": client.Username,
		},
		"activeSkin":      client.ActiveSkin,
		"ownedSkins":      client.OwnedSkins,
		"ownedShapes":     client.OwnedShapes,
		"hasSubscription": client.HasSubscription,
		"isPrivileged":    client.IsPrivileged,
		"isAdmin":         client.ID == s.cfg.AdminTGID,
		"starCredits":     starCredits,
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
	// Load user data before acquiring server lock (DB calls outside critical section)
	ctx := context.Background()
	c.ActiveSkin = s.getUserActiveSkin(ctx, c.ID)
	c.OwnedSkins = s.getUserOwnedSkins(ctx, c.ID)
	c.OwnedSkinSet = makeStringSet(c.OwnedSkins)
	c.OwnedShapes = s.getUserOwnedShapes(ctx, c.ID)
	c.OwnedShapeSet = makeStringSet(c.OwnedShapes)
	c.HasSubscription = s.isUserSubscribed(ctx, c.ID)
	c.IsPrivileged = s.isUserPrivileged(ctx, c.ID)

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
		s.startSolo(c, act.Rows, act.Cols, act.Mines, act.Shape)
	case "create_room":
		s.createRoom(c, act.Mode, act.Rows, act.Cols, act.Mines, act.Shape)
	case "join_room":
		s.joinRoom(c, act.Code)
	case "leave_room":
		s.leaveRoom(c)
	case "restart_room":
		s.restartRoom(c, act.Rows, act.Cols, act.Mines, act.Shape)
	case "reveal":
		s.revealCell(c, act.Cell)
	case "toggle_flag":
		s.toggleFlag(c, act.Cell)
	case "hover":
		s.setHover(c, act.Cell)
	case "revive_request":
		s.handleReviveRequest(c)
	case "skin_purchase_request":
		s.handleSkinPurchaseRequest(c, act.SkinID)
	case "select_skin":
		s.handleSelectSkin(c, act.SkinID)
	case "subscribe_request":
		s.handleSubscribeRequest(c)
	case "shape_purchase_request":
		s.handleShapePurchaseRequest(c, act.ShapeID)
	case "bet_request":
		s.handleBetRequest(c, act.TargetID, act.Amount)
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

// playerStateSnap holds a pre-built State for one player, not yet JSON-encoded.
type playerStateSnap struct {
	pid   string
	state State
}

// buildStateSnaps builds per-player State objects from g.
// Caller must hold g.mu. JSON marshalling is deferred to marshalStateSnaps so
// the expensive encoding step happens outside the lock.
func (s *Server) buildStateSnaps(g *Game) []playerStateSnap {
	snaps := make([]playerStateSnap, 0, len(g.Players))
	for _, pid := range g.Players {
		snaps = append(snaps, playerStateSnap{pid: pid, state: s.buildStateLocked(g, pid)})
	}
	return snaps
}

// marshalStateSnaps encodes snapshots to JSON playerMsg values.
// Safe to call without any lock held.
func marshalStateSnaps(snaps []playerStateSnap) []playerMsg {
	msgs := make([]playerMsg, 0, len(snaps))
	for _, snap := range snaps {
		data, err := json.Marshal(map[string]any{
			"type":    "state",
			"payload": snap.state,
		})
		if err != nil {
			continue
		}
		msgs = append(msgs, playerMsg{pid: snap.pid, msg: data})
	}
	return msgs
}

// buildBroadcastMsgs builds per-player state messages from g.
// Caller must hold g.mu (or exclusive s.mu so no hot-path can mutate g).
// Prefer buildStateSnaps+marshalStateSnaps to keep JSON work outside the lock.
func (s *Server) buildBroadcastMsgs(g *Game) []playerMsg {
	return marshalStateSnaps(s.buildStateSnaps(g))
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

func (s *Server) handleReviveRequest(c *Client) {
	s.mu.RLock()
	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.mu.RUnlock()
		s.sendError(c, "Нет активной игры")
		return
	}
	gameID := game.ID
	s.mu.RUnlock()

	url, err := s.createInvoiceLink(gameID, c.ID)
	if err != nil {
		s.sendError(c, fmt.Sprintf("Не удалось создать платёж: %v", err))
		return
	}

	s.send(c, map[string]any{
		"type": "invoice_link",
		"url":  url,
	})
}

// adminGrantShape grants one or all premium shapes to a user without charging them.
// shapeID may be "all" to grant every premium shape.
func (s *Server) adminGrantShape(userID, shapeID string) error {
	ctx := context.Background()
	if shapeID == "all" {
		for id := range validShapeIDs {
			if id == "square" {
				continue // square is always free
			}
			if _, err := s.db.Exec(ctx,
				`insert into user_shapes (user_id, shape_id) values ($1, $2) on conflict do nothing`,
				userID, id,
			); err != nil {
				return err
			}
		}
	} else {
		if !validShapeIDs[shapeID] || shapeID == "square" {
			return fmt.Errorf("неизвестная форма: %s", shapeID)
		}
		if _, err := s.db.Exec(ctx,
			`insert into user_shapes (user_id, shape_id) values ($1, $2) on conflict do nothing`,
			userID, shapeID,
		); err != nil {
			return err
		}
	}

	s.mu.RLock()
	c := s.clients[userID]
	s.mu.RUnlock()
	if c != nil {
		c.OwnedShapes = s.getUserOwnedShapes(ctx, userID)
		c.OwnedShapeSet = makeStringSet(c.OwnedShapes)
		s.send(c, map[string]any{
			"type":        "shape_purchased",
			"shapeId":     shapeID,
			"ownedShapes": c.OwnedShapes,
		})
	}
	return nil
}

// adminGrantSkin grants one or all skins to a user without charging them.
// skinID may be "all" to grant every skin in the catalog.
func (s *Server) adminGrantSkin(userID, skinID string) error {
	ctx := context.Background()
	if skinID == "all" {
		for id := range validSkinIDs {
			if _, err := s.db.Exec(ctx,
				`insert into user_skins (user_id, skin_id) values ($1, $2) on conflict do nothing`,
				userID, id,
			); err != nil {
				return err
			}
		}
	} else {
		if !validSkinIDs[skinID] {
			return fmt.Errorf("неизвестный скин: %s", skinID)
		}
		if _, err := s.db.Exec(ctx,
			`insert into user_skins (user_id, skin_id) values ($1, $2) on conflict do nothing`,
			userID, skinID,
		); err != nil {
			return err
		}
	}

	// Notify connected client immediately so they see the new skin
	s.mu.RLock()
	c := s.clients[userID]
	s.mu.RUnlock()
	if c != nil {
		c.OwnedSkins = s.getUserOwnedSkins(ctx, userID)
		c.OwnedSkinSet = makeStringSet(c.OwnedSkins)
		s.send(c, map[string]any{
			"type":       "skin_purchased",
			"activeSkin": c.ActiveSkin,
			"ownedSkins": c.OwnedSkins,
		})
	}
	return nil
}

// purchaseSkinForPlayer grants a skin to a connected player and pushes the update.
func (s *Server) purchaseSkinForPlayer(playerID, skinID string) error {
	ctx := context.Background()
	if err := s.purchaseSkinDB(ctx, playerID, skinID); err != nil {
		return err
	}

	s.mu.RLock()
	c := s.clients[playerID]
	s.mu.RUnlock()

	if c == nil {
		return nil // Player offline — skin saved in DB, they'll see it on next login
	}

	c.OwnedSkins = s.getUserOwnedSkins(ctx, playerID)
	c.OwnedSkinSet = makeStringSet(c.OwnedSkins)
	c.ActiveSkin = skinID

	// Update in current game
	s.mu.RLock()
	gameID, ok := s.playerGame[playerID]
	var game *Game
	if ok {
		game = s.games[gameID]
	}
	s.mu.RUnlock()

	if game != nil {
		game.mu.Lock()
		if game.Skins == nil {
			game.Skins = map[string]string{}
		}
		game.Skins[playerID] = skinID
		snaps := s.buildStateSnaps(game)
		game.mu.Unlock()
		s.sendBroadcast(marshalStateSnaps(snaps))
	} else {
		s.send(c, map[string]any{
			"type":       "skin_purchased",
			"skinId":     skinID,
			"activeSkin": skinID,
			"ownedSkins": c.OwnedSkins,
		})
	}
	return nil
}

var telegramClient = &http.Client{Timeout: 10 * time.Second}

func makeStringSet(slice []string) map[string]bool {
	set := make(map[string]bool, len(slice))
	for _, s := range slice {
		set[s] = true
	}
	return set
}

var shapeNames = map[string]string{
	"circle":  "Круг",
	"diamond": "Ромб",
	"cross":   "Крест",
	"x_shape": "Икс",
	"frame_x": "Рамка с иксом",
}

func (s *Server) handleShapePurchaseRequest(c *Client, shapeID string) {
	if shapeID == "" || shapeID == "square" || shapeID == "circle" {
		s.sendError(c, "Эта форма бесплатна")
		return
	}
	if !validShapeIDs[shapeID] {
		s.sendError(c, "Неизвестная форма карты")
		return
	}
	// Subscription/privilege already unlocks all shapes
	if c.HasSubscription || c.IsPrivileged || c.ID == s.cfg.AdminTGID {
		s.sendError(c, "Форма уже доступна с вашей подпиской")
		return
	}
	if c.OwnedShapeSet[shapeID] {
		s.sendError(c, "Форма уже куплена")
		return
	}

	url, err := s.createShapeInvoiceLink(shapeID, c.ID)
	if err != nil {
		s.sendError(c, fmt.Sprintf("Не удалось создать платёж: %v", err))
		return
	}

	s.send(c, map[string]any{
		"type":    "invoice_link",
		"url":     url,
		"shapeId": shapeID,
	})
}

func (s *Server) createShapeInvoiceLink(shapeID, playerID string) (string, error) {
	title := shapeNames[shapeID]
	if title == "" {
		title = shapeID
	}

	payload := "shape:" + shapeID

	reqBody, err := json.Marshal(map[string]any{
		"title":          "Форма «" + title + "»",
		"description":    "Форма поля «" + title + "» навсегда",
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []map[string]any{{"label": "Форма поля", "amount": 39}},
		"provider_token": "",
	})
	if err != nil {
		return "", err
	}

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/createInvoiceLink"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool   `json:"ok"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !result.OK {
		return "", fmt.Errorf("telegram API error")
	}
	return result.Result, nil
}

func (s *Server) purchaseShapeForPlayer(playerID, shapeID string) error {
	ctx := context.Background()
	if err := s.purchaseShapeDB(ctx, playerID, shapeID); err != nil {
		return err
	}

	s.mu.RLock()
	c := s.clients[playerID]
	s.mu.RUnlock()

	if c == nil {
		return nil
	}

	c.OwnedShapes = s.getUserOwnedShapes(ctx, playerID)
	c.OwnedShapeSet = makeStringSet(c.OwnedShapes)
	s.send(c, map[string]any{
		"type":        "shape_purchased",
		"shapeId":     shapeID,
		"ownedShapes": c.OwnedShapes,
	})
	return nil
}

var validSkinIDs = map[string]bool{
	"matrix": true,
	"sunset": true,
	"ocean":  true,
	"neon":   true,
	"arctic": true,
}

func (s *Server) handleSkinPurchaseRequest(c *Client, skinID string) {
	if !validSkinIDs[skinID] {
		s.sendError(c, "Неизвестный скин")
		return
	}

	if c.OwnedSkinSet[skinID] {
		s.sendError(c, "Скин уже куплен")
		return
	}

	url, err := s.createSkinInvoiceLink(skinID, c.ID)
	if err != nil {
		s.sendError(c, fmt.Sprintf("Не удалось создать платёж: %v", err))
		return
	}

	s.send(c, map[string]any{
		"type":   "invoice_link",
		"url":    url,
		"skinId": skinID,
	})
}

func (s *Server) handleSelectSkin(c *Client, skinID string) {
	if skinID == "" {
		skinID = "default"
	}

	// Validate ownership (default always free; admin bypasses ownership check)
	if skinID != "default" && c.ID != s.cfg.AdminTGID {
		if !c.OwnedSkinSet[skinID] {
			s.sendError(c, "Скин не куплен")
			return
		}
	}

	c.ActiveSkin = skinID
	_ = s.setActiveSkinDB(context.Background(), c.ID, skinID)

	// Update skin in current game and broadcast
	s.mu.RLock()
	gameID, ok := s.playerGame[c.ID]
	var game *Game
	if ok {
		game = s.games[gameID]
	}
	s.mu.RUnlock()

	if game != nil {
		game.mu.Lock()
		if game.Skins == nil {
			game.Skins = map[string]string{}
		}
		game.Skins[c.ID] = skinID
		snaps := s.buildStateSnaps(game)
		game.mu.Unlock()
		s.sendBroadcast(marshalStateSnaps(snaps))
	} else {
		// No active game — just confirm back to the client
		s.send(c, map[string]any{
			"type":       "skin_selected",
			"activeSkin": skinID,
			"ownedSkins": c.OwnedSkins,
		})
	}
}

func (s *Server) handleSubscribeRequest(c *Client) {
	if c.HasSubscription {
		s.sendError(c, "У вас уже есть активная подписка")
		return
	}

	url, err := s.createSubscriptionInvoiceLink(c.ID)
	if err != nil {
		s.sendError(c, fmt.Sprintf("Не удалось создать платёж: %v", err))
		return
	}

	s.send(c, map[string]any{
		"type":    "invoice_link",
		"url":     url,
		"subPending": true,
	})
}

func (s *Server) createSubscriptionInvoiceLink(playerID string) (string, error) {
	payload := "sub:" + playerID

	reqBody, err := json.Marshal(map[string]any{
		"title":          "Pro подписка",
		"description":    "До 10 игроков в Co-op комнатах на 30 дней",
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []map[string]any{{"label": "Pro подписка (30 дней)", "amount": 129}},
		"provider_token": "",
	})
	if err != nil {
		return "", err
	}

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/createInvoiceLink"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool   `json:"ok"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !result.OK {
		return "", fmt.Errorf("telegram API error")
	}
	return result.Result, nil
}

func (s *Server) createSkinInvoiceLink(skinID, playerID string) (string, error) {
	skinNames := map[string]string{
		"matrix": "Матрица",
		"sunset": "Закат",
	}
	title := skinNames[skinID]
	if title == "" {
		title = skinID
	}

	payload := "skin:" + skinID

	reqBody, err := json.Marshal(map[string]any{
		"title":          "Скин «" + title + "»",
		"description":    "Дизайн поля «" + title + "» навсегда",
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []map[string]any{{"label": "Скин", "amount": 19}},
		"provider_token": "",
	})
	if err != nil {
		return "", err
	}

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/createInvoiceLink"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool   `json:"ok"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !result.OK {
		return "", fmt.Errorf("telegram API error")
	}
	return result.Result, nil
}

func (s *Server) createInvoiceLink(gameID, playerID string) (string, error) {
	payload := "revive:" + gameID + ":" + playerID

	reqBody, err := json.Marshal(map[string]any{
		"title":          "Возрождение",
		"description":    "Потрать 2 звезды, чтобы пережить взрыв мины",
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []map[string]any{{"label": "Возрождение", "amount": 2}},
		"provider_token": "",
	})
	if err != nil {
		return "", err
	}

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/createInvoiceLink"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool   `json:"ok"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !result.OK {
		return "", fmt.Errorf("telegram API error")
	}
	return result.Result, nil
}

func (s *Server) handleBetRequest(c *Client, targetID string, amount int) {
	if amount < 1 || amount > 100 {
		s.sendError(c, "Ставка: от 1 до 100 звёзд")
		return
	}

	s.mu.RLock()
	game := s.currentGameLocked(c.ID)
	if game == nil {
		s.mu.RUnlock()
		s.sendError(c, "Нет активной игры")
		return
	}
	gameID := game.ID
	s.mu.RUnlock()

	game.mu.Lock()
	if game.Mode != "versus" {
		game.mu.Unlock()
		s.sendError(c, "Ставки доступны только в режиме versus")
		return
	}
	if game.Generated {
		game.mu.Unlock()
		s.sendError(c, "Игра уже началась — ставки закрыты")
		return
	}
	if !contains(game.Players, targetID) {
		game.mu.Unlock()
		s.sendError(c, "Такого игрока нет в комнате")
		return
	}
	if targetID == c.ID {
		game.mu.Unlock()
		s.sendError(c, "Нельзя ставить на себя")
		return
	}
	for _, b := range game.Bets {
		if b.BettorID == c.ID {
			game.mu.Unlock()
			s.sendError(c, "Ставка уже сделана")
			return
		}
	}
	game.mu.Unlock()

	url, err := s.createBetInvoiceLink(gameID, c.ID, targetID, amount)
	if err != nil {
		s.sendError(c, fmt.Sprintf("Не удалось создать платёж: %v", err))
		return
	}

	s.send(c, map[string]any{
		"type":       "invoice_link",
		"url":        url,
		"betPending": true,
		"targetId":   targetID,
		"amount":     amount,
	})
}

func (s *Server) createBetInvoiceLink(gameID, bettorID, targetID string, amount int) (string, error) {
	payload := fmt.Sprintf("bet:%s:%s:%s:%d", gameID, bettorID, targetID, amount)

	reqBody, err := json.Marshal(map[string]any{
		"title":          "Ставка на взрыв",
		"description":    fmt.Sprintf("Ставка %d ⭐ — угадай, кто взорвётся в MineSprint Versus", amount),
		"payload":        payload,
		"currency":       "XTR",
		"prices":         []map[string]any{{"label": "Ставка", "amount": amount}},
		"provider_token": "",
	})
	if err != nil {
		return "", err
	}

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/createInvoiceLink"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var betResult struct {
		OK     bool   `json:"ok"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&betResult); err != nil {
		return "", err
	}
	if !betResult.OK {
		return "", fmt.Errorf("telegram API error")
	}
	return betResult.Result, nil
}

// resolveBets is called in a goroutine after a game ends.
//
// Board cleared (refundAll=true): everyone gets their stake refunded.
//
// Mine hit (exploderID set):
//   - Correct predictors (bet on exploderID): stake refunded + 80% of losers'
//     total distributed as star_credits proportional to each winner's stake.
//   - Wrong predictors: lose their stars (admin keeps them as broker profit).
//   - Admin earns: 20% of losers' total (never refunded to anyone).
func (s *Server) resolveBets(bets []GameBet, exploderID string, refundAll bool) {
	if len(bets) == 0 {
		return
	}

	if refundAll {
		for _, b := range bets {
			s.refundTelegramPayment(b.ChargeID, b.BettorID)
		}
		return
	}

	var winners []GameBet
	losersTotal := 0
	for _, b := range bets {
		if b.TargetID == exploderID {
			winners = append(winners, b)
		} else {
			losersTotal += b.Amount
		}
	}

	// Refund every winner's stake
	for _, b := range winners {
		s.refundTelegramPayment(b.ChargeID, b.BettorID)
	}

	// Distribute 80% of losers' pool to winners as star_credits (proportional to stake)
	if len(winners) > 0 && losersTotal > 0 {
		pool := losersTotal * 80 / 100
		if pool < 1 {
			pool = 1
		}
		winnersTotal := 0
		for _, b := range winners {
			winnersTotal += b.Amount
		}
		for _, b := range winners {
			if winnersTotal == 0 {
				break
			}
			share := pool * b.Amount / winnersTotal
			if share < 1 {
				share = 1
			}
			s.addStarCredits(b.BettorID, share)
			s.notifyCreditsUpdate(b.BettorID, share)
		}
	}
}

func (s *Server) notifyCreditsUpdate(userID string, earned int) {
	s.mu.RLock()
	c := s.clients[userID]
	s.mu.RUnlock()
	if c == nil {
		return
	}
	balance := s.getStarCredits(context.Background(), userID)
	s.send(c, map[string]any{
		"type":        "credits_updated",
		"starCredits": balance,
		"earned":      earned,
	})
}

func (s *Server) refundTelegramPayment(chargeID, userID string) {
	uid, err := strconv.ParseInt(userID, 10, 64)
	if err != nil {
		log.Printf("refundTelegramPayment: bad userID %q: %v", userID, err)
		return
	}

	body, _ := json.Marshal(map[string]any{
		"user_id":                    uid,
		"telegram_payment_charge_id": chargeID,
	})

	apiURL := "https://api.telegram.org/bot" + s.cfg.BotToken + "/refundStarPayment"
	resp, err := telegramClient.Post(apiURL, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("refundTelegramPayment error: %v", err)
		return
	}
	defer resp.Body.Close()

	var result struct {
		OK bool `json:"ok"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	if result.OK {
		s.markBetRefunded(chargeID)
	} else {
		log.Printf("refundStarPayment failed chargeID=%s userID=%s", chargeID, userID)
	}
}
