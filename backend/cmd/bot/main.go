package main

import (
	"log"
	"strings"

	"tg-minesweeper/backend/internal/app"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

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
		if update.Message == nil {
			continue
		}

		if update.Message.IsCommand() {
			switch update.Message.Command() {
			case "start", "app":
				sendOpenApp(bot, update.Message.Chat.ID, cfg.PublicBaseURL)
				continue
			}
		}

		text := strings.TrimSpace(update.Message.Text)
		if text != "" {
			sendOpenApp(bot, update.Message.Chat.ID, cfg.PublicBaseURL)
		}
	}
}

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

func sendOpenApp(bot *tgbotapi.BotAPI, chatID int64, appURL string) {
	markup := webAppKeyboard{
		InlineKeyboard: [][]webAppButton{{
			{Text: "Открыть MineSweeper", WebApp: &webAppInfo{URL: appURL}},
		}},
	}

	msg := tgbotapi.NewMessage(chatID, "Запусти игру кнопкой ниже.")
	msg.ReplyMarkup = markup

	_, _ = bot.Send(msg)
}
