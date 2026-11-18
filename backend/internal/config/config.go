package config

import (
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exporter"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
)

func Validate(s model.Settings) error {
	if err := scanner.ValidateOptions(s.Scan); err != nil {
		return err
	}
	if err := ValidateTheme(s.Theme); err != nil {
		return err
	}
	if s.LogLevel != "DEBUG" && s.LogLevel != "INFO" && s.LogLevel != "WARN" && s.LogLevel != "ERROR" {
		return &Error{"未知日志级别"}
	}
	if s.ExportFormat != "clash" && s.ExportFormat != "provider" && s.ExportFormat != "singbox" {
		return &Error{"未知导出格式"}
	}
	return exporter.ValidatePolicy(s.Policy)
}

func ValidateTheme(theme string) error {
	if theme != "light" && theme != "dark" && theme != "system" {
		return &Error{"未知主题"}
	}
	return nil
}

type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }
