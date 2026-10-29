// Package exportname defines the portable filename contract used by previews and saves.
package exportname

import (
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Leave room for a source attribution suffix and the exclusive-save counter on
// filesystems whose component limit is measured in bytes rather than characters.
const MaxNameBytes = 240
const maxStemBytes = 200

func reserved(name string) bool {
	stem := strings.ToUpper(strings.Split(name, ".")[0])
	return stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
		len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9'
}

func Valid(name string) bool {
	if name == "" || !utf8.ValidString(name) || len(name) > MaxNameBytes || strings.TrimSpace(name) != name ||
		strings.HasSuffix(name, ".") || strings.ContainsAny(name, `/\:*?"<>|`) || reserved(name) {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func Filename(raw, ext string) string {
	raw = strings.TrimSpace(filepath.Base(strings.ReplaceAll(raw, `\`, "/")))
	raw = strings.TrimSuffix(raw, filepath.Ext(raw))
	raw = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, raw)
	raw = strings.Trim(raw, " .")
	if raw == "" {
		raw = "castorice-rules"
	}
	if reserved(raw) {
		raw = "rules-" + raw
	}
	var stem strings.Builder
	for _, r := range raw {
		if stem.Len()+utf8.RuneLen(r) > maxStemBytes {
			break
		}
		stem.WriteRune(r)
	}
	return strings.TrimRight(stem.String(), " .") + ext
}
