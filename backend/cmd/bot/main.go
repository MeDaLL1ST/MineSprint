package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"tg-minesweeper/backend/internal/app"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type webAppInfo struct {
	URL string `json:"url"`
}

type webAppButton struct {
	Text   string      `json:"text"`
	WebApp *webAppInfo `json:"web_app,omitempty"`
}

type webAppKeyboard struct {
	InlineKeyboard [][]webAppButton `json:"inline_keyboard"`
}

func main() {
	cfg := app.LoadConfig()

	if cfg.BotToken == "" {
		log.Fatal("BOT_TOKEN is required")
	}
	if cfg.PublicBaseURL == "" {
		log.Fatal("PUBLIC_BASE_URL is required")
	}

	bot, err := tgbotapi.NewBotAPI(cfg.BotToken)
	if err != nil {
		log.Fatalf("bot init error: %v", err)
	}

	_, _ = bot.Request(tgbotapi.NewSetMyCommands(
		tgbotapi.BotCommand{Command: "start", Description: "Открыть игру"},
		tgbotapi.BotCommand{Command: "app", Description: "Открыть игру"},
	))

	u := tgbotapi.NewUpdate(0)
	u.Timeout = 30

	updates := bot.GetUpdatesChan(u)

	log.Printf("bot started as @%s", bot.Self.UserName)

	for update := range updates {
		// Handle Stars pre-checkout: approve immediately
		if update.PreCheckoutQuery != nil {
			pq := update.PreCheckoutQuery
			if strings.HasPrefix(pq.InvoicePayload, "revive:") ||
				strings.HasPrefix(pq.InvoicePayload, "skin:") ||
				strings.HasPrefix(pq.InvoicePayload, "sub:") ||
				strings.HasPrefix(pq.InvoicePayload, "shape:") {
				_, _ = bot.Request(tgbotapi.PreCheckoutConfig{
					PreCheckoutQueryID: pq.ID,
					OK:                 true,
				})
			}
			continue
		}

		if update.Message == nil {
			continue
		}

		// Handle successful Stars payment
		if update.Message.SuccessfulPayment != nil {
			sp := update.Message.SuccessfulPayment
			playerID := fmt.Sprintf("%d", update.Message.From.ID)
			if strings.HasPrefix(sp.InvoicePayload, "revive:") {
				if err := notifyRevive(cfg, playerID); err != nil {
					log.Printf("revive notify error for player %s: %v", playerID, err)
				}
			} else if strings.HasPrefix(sp.InvoicePayload, "skin:") {
				skinID := strings.TrimPrefix(sp.InvoicePayload, "skin:")
				if err := notifySkinPurchase(cfg, playerID, skinID); err != nil {
					log.Printf("skin purchase notify error for player %s skin %s: %v", playerID, skinID, err)
				}
			} else if strings.HasPrefix(sp.InvoicePayload, "sub:") {
				if err := notifySubscribe(cfg, playerID); err != nil {
					log.Printf("subscription notify error for player %s: %v", playerID, err)
				}
			} else if strings.HasPrefix(sp.InvoicePayload, "shape:") {
				shapeID := strings.TrimPrefix(sp.InvoicePayload, "shape:")
				if err := notifyShapePurchase(cfg, playerID, shapeID); err != nil {
					log.Printf("shape purchase notify error for player %s shape %s: %v", playerID, shapeID, err)
				}
			}
			continue
		}

		if update.Message.IsCommand() {
			switch update.Message.Command() {
			case "start", "app":
				roomCode := parseRoomCode(update.Message.CommandArguments())
				sendOpenApp(bot, update.Message.Chat.ID, cfg.PublicBaseURL, roomCode)
				continue
			}
		}

		text := strings.TrimSpace(update.Message.Text)
		if text != "" {
			sendOpenApp(bot, update.Message.Chat.ID, cfg.PublicBaseURL, "")
		}
	}
}

func notifyShapePurchase(cfg app.Config, playerID, shapeID string) error {
	body, _ := json.Marshal(map[string]string{
		"secret":   cfg.InternalSecret,
		"playerId": playerID,
		"shapeId":  shapeID,
	})
	resp, err := http.Post(
		cfg.InternalServerURL+"/api/internal/purchase_shape",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}
	return nil
}

func notifySkinPurchase(cfg app.Config, playerID, skinID string) error {
	body, _ := json.Marshal(map[string]string{
		"secret":   cfg.InternalSecret,
		"playerId": playerID,
		"skinId":   skinID,
	})
	resp, err := http.Post(
		cfg.InternalServerURL+"/api/internal/purchase_skin",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}
	return nil
}

func notifySubscribe(cfg app.Config, playerID string) error {
	body, _ := json.Marshal(map[string]string{
		"secret":   cfg.InternalSecret,
		"playerId": playerID,
	})
	resp, err := http.Post(
		cfg.InternalServerURL+"/api/internal/subscribe",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}
	return nil
}

func notifyRevive(cfg app.Config, playerID string) error {
	body, _ := json.Marshal(map[string]string{
		"secret":   cfg.InternalSecret,
		"playerId": playerID,
	})
	resp, err := http.Post(
		cfg.InternalServerURL+"/api/internal/revive",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}
	return nil
}

func parseRoomCode(arg string) string {
	arg = strings.TrimSpace(arg)
	if arg == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(arg), "room_") {
		arg = arg[5:]
	}
	return strings.ToUpper(strings.TrimSpace(arg))
}

func buildAppURL(baseURL, roomCode string) string {
	if roomCode == "" {
		return baseURL
	}
	return baseURL + "/?room=" + url.QueryEscape(roomCode)
}

func sendOpenApp(bot *tgbotapi.BotAPI, chatID int64, baseURL, roomCode string) {
	appURL := buildAppURL(baseURL, roomCode)

	text := "Запусти игру кнопкой ниже."
	if roomCode != "" {
		text = "Запусти игру и зайди в комнату " + roomCode + "."
	}

	markup := webAppKeyboard{
		InlineKeyboard: [][]webAppButton{{
			{Text: "Открыть MineSweeper", WebApp: &webAppInfo{URL: appURL}},
		}},
	}

	msg := tgbotapi.NewMessage(chatID, text)
	msg.ReplyMarkup = markup

	_, _ = bot.Send(msg)
}
