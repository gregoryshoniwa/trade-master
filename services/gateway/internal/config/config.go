package config

import (
	"log/slog"
	"os"
	"strings"
)

type Config struct {
	DerivWSURL    string
	DerivAppID    string
	DerivAPIToken string
	DefaultSymbol string
	Port          string
	LogLevelStr   string

	NATSURL string

	QuestDBILPHost string
	QuestDBILPPort string
}

func Load() Config {
	return Config{
		DerivWSURL:    getenv("DERIV_WS_URL", "wss://ws.derivws.com/websockets/v3"),
		DerivAppID:    getenv("DERIV_APP_ID", "1089"),
		DerivAPIToken: getenv("DERIV_API_TOKEN", ""),
		DefaultSymbol: getenv("DERIV_DEFAULT_SYMBOL", "R_75"),
		Port:          getenv("GATEWAY_PORT", "8080"),
		LogLevelStr:   getenv("GATEWAY_LOG_LEVEL", "info"),

		NATSURL: getenv("NATS_URL", "nats://nats:4222"),

		QuestDBILPHost: getenv("QUESTDB_ILP_HOST", "questdb"),
		QuestDBILPPort: getenv("QUESTDB_ILP_PORT", "9009"),
	}
}

func (c Config) LogLevel() slog.Level {
	switch strings.ToLower(c.LogLevelStr) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
