package config

import (
	"os"
	"path/filepath"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exporter"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
)

func DataDir() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(executable), "data"), nil
}
func Validate(s model.Settings) error {
	if err := scanner.ValidateOptions(s.Scan); err != nil {
		return err
	}
	if s.Theme != "light" && s.Theme != "dark" && s.Theme != "system" {
		return &Error{"未知主题"}
	}
	if s.LogLevel != "DEBUG" && s.LogLevel != "INFO" && s.LogLevel != "WARN" && s.LogLevel != "ERROR" {
		return &Error{"未知日志级别"}
	}
	if s.ExportFormat != "clash" && s.ExportFormat != "provider" && s.ExportFormat != "singbox" {
		return &Error{"未知导出格式"}
	}
	return exporter.ValidatePolicy(s.Policy)
}

type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }
