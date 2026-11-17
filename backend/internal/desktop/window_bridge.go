package desktop

import (
	"encoding/json"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
)

func windowBridge(origin string, paths portable.Paths, command string) string {
	base, _ := json.Marshal(origin)
	metadata, _ := json.Marshal(map[string]string{"dataDir": paths.Data, "exportDir": paths.Exports, "version": model.Version})
	return `if (window === window.top && location.origin === ` + string(base) + `) {
		Object.defineProperty(window, 'castoriceDesktop', {value: Object.freeze(` + string(metadata) + `)});
		let maximized = false;
		window.addEventListener('castorice-window-state', event => { maximized = event.detail; });
		Object.defineProperty(window, 'castoriceWindow', {value: Object.freeze({
			get maximized() { return maximized; },
			command: action => { ` + command + ` }
		})});
	}`
}
