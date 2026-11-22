package desktop

import (
	"encoding/json"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
)

const (
	windowWidth, windowHeight       = 1280, 800
	minWindowWidth, minWindowHeight = 600, 420
	closeTransition                 = 180 * time.Millisecond
	windowClosingEvent              = "window.dispatchEvent(new Event('castorice-window-closing'));"
)

func windowBridge(origin string, paths portable.Paths, command string) string {
	base, _ := json.Marshal(origin)
	metadata, _ := json.Marshal(map[string]string{"dataDir": paths.Data, "exportDir": paths.Exports, "version": model.Version})
	return `if (window === window.top && location.origin === ` + string(base) + `) {
		Object.defineProperty(window, 'castoriceDesktop', {value: Object.freeze(` + string(metadata) + `)});
		let maximized = false;
		window.addEventListener('castorice-window-state', event => { maximized = event.detail; });
		window.addEventListener('castorice-window-closing', () => {
			document.documentElement.classList.add('desktop-closing');
		}, {once: true});
		Object.defineProperty(window, 'castoriceWindow', {value: Object.freeze({
			get maximized() { return maximized; },
			command: action => { ` + command + ` }
		})});
	}`
}
