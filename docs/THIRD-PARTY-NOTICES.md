# 第三方组件与规则来源

Castorice-WebRuleAnalyzer 自身代码为 MIT。以下为本次锁定依赖的主要许可证与出处；完整精确版本见 `backend/go.mod`、`backend/go.sum`、`frontend/package-lock.json`。不对上游原始规则改署名，不把本项目 MIT 宣称为外部规则的许可证。

| 组件 | 许可证 | 上游 |
| --- | --- | --- |
| Go / 标准库 | BSD-3-Clause | https://go.dev/LICENSE |
| chromedp / cdproto / sysutil | MIT | https://github.com/chromedp/chromedp |
| modernc.org/sqlite / libc | BSD-3-Clause（底层 SQLite 公有领域） | https://pkg.go.dev/modernc.org/sqlite |
| golang.org/x/net / x/text / x/sys | BSD-3-Clause | https://go.googlesource.com/net |
| go.yaml.in/yaml/v3 | MIT / Apache-2.0 | https://github.com/yaml/go-yaml |
| gorilla/websocket（仅测试站） | BSD-2-Clause | https://github.com/gorilla/websocket |
| React / ReactDOM | MIT | https://github.com/facebook/react |
| Material UI / Icons | MIT | https://github.com/mui/material-ui |
| Emotion | MIT | https://github.com/emotion-js/emotion |
| Vite / Vitest | MIT | https://github.com/vitejs/vite |
| TypeScript（构建） | Apache-2.0 | https://github.com/microsoft/TypeScript |

正式运行包由构建脚本附带 `THIRD-PARTY-LICENSES.txt`：收集实际 Go 模块与 npm 生产依赖的上游许可证原文。字体仅使用系统字体，不包含用户的字体文件；测试站的微型矩形字体是本项目原创测试数据、MIT 授权，正常产物不包含测试站。

## 下载的外部规则

运行包不预装上游规则数据。用户初始化后，软件以固定 Commit 下载、解析并缓存原始规则和对应 LICENSE 内容；不执行脚本或配置动作。

- **blackmatrix7/ios_rule_script**：[仓库](https://github.com/blackmatrix7/ios_rule_script)、[LICENSE](https://github.com/blackmatrix7/ios_rule_script/blob/master/LICENSE)、[上游声明](https://github.com/blackmatrix7/ios_rule_script#readme)。GNU GPL version 2；README 另有使用/转载声明。实际缓存保留下载时的 Commit 和许可证原文，使用/再分发前应阅读上游条款。
- **v2fly/domain-list-community**：[仓库](https://github.com/v2fly/domain-list-community)、[MIT LICENSE](https://github.com/v2fly/domain-list-community/blob/master/LICENSE)、[数据语义](https://github.com/v2fly/domain-list-community#structure-of-data)。下载时保留固定 Commit 的 LICENSE；导出仍保留原始来源文件和归属。

上游 LICENSE 与内容结构变化时同步会停止，不覆盖已验证缓存。合并预览列出每条规则的来源。YAML 注释附来源/版本，JSON 维持目标客户端严格格式，额外来源说明通过 `.sources.txt` 单独下载。来源说明不是上游完整许可证的替代；用户可从规则库面板查看本地保存的 LICENSE 原文，或访问固定 Commit 的许可证链接。
