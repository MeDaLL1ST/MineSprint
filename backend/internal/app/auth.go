package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

func validateInitData(botToken, initData string) (string, string, string, error) {
	values, err := url.ParseQuery(initData)
	if err != nil {
		return "", "", "", err
	}

	hash := values.Get("hash")
	if hash == "" {
		return "", "", "", fmt.Errorf("missing hash")
	}
	values.Del("hash")

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+values.Get(k))
	}
	dataCheckString := strings.Join(parts, "\n")

	h := hmac.New(sha256.New, []byte("WebAppData"))
	h.Write([]byte(botToken))
	secret := h.Sum(nil)

	sign := hmac.New(sha256.New, secret)
	sign.Write([]byte(dataCheckString))
	expected := hex.EncodeToString(sign.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return "", "", "", fmt.Errorf("invalid hash")
	}

	var user struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	}

	if err := json.Unmarshal([]byte(values.Get("user")), &user); err != nil {
		return "", "", "", err
	}

	name := strings.TrimSpace(strings.TrimSpace(user.FirstName + " " + user.LastName))
	if name == "" {
		name = strings.TrimSpace(user.Username)
	}
	if name == "" {
		name = "Player " + strconv.FormatInt(user.ID, 10)
	}

	return strconv.FormatInt(user.ID, 10), name, strings.TrimSpace(user.Username), nil
}
