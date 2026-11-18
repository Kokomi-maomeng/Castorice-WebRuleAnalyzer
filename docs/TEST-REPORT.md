# v1.7 本地验证记录

2026-11-18。当前候选版供 Windows x64 本地试用。包内 BUILD-INFO.json 记录构建输入和 EXE 校验值。

| 范围 | 完成的验证 |
| --- | --- |
| Windows 11 原生窗口 | 从中文和空格路径启动，实扫保留示例站，导出 Clash/Mihomo、Rule Provider 与 sing-box。正常关闭、采集中关闭、强制退出和启动恢复通过。扫描停止后核对临时 Profile、所属进程和监听端口。 |
| 网页浏览器 | Chrome、Edge、Playwright Firefox 和 Playwright WebKit 通过真实隔离站扫描、弱网终态补取、精确主机筛选、脱敏历史重扫保护及三种文件下载。320×256 等效视口使用键盘和鼠标滚轮到达导出按钮。 |
| 辅助采集 | 使用独立 Chromium 窗口记录 SPA 路由、标题与 HTTP 503 导航，达到页面数上限后结束采集。 |
| Debian 13 | 普通用户运行 Linux amd64 无头服务及隔离 X11 桌面，实扫保留示例站并生成三种规则。验证原生保存、服务关闭、gzip 资源传输及数据目录权限。 |
| HTTPS 反代 | 使用临时 Caddy 和独立 TLS CA，本地验证匿名访问页面/API/SSE 返回 401，有权访问并获得扫描终态事件。 |
| 容器配置 | 中文和空格目录下的默认及 AppArmor Compose 配置检查通过，Debian 完成 AppArmor 语法编译。容器完整启动和容器内 Chromium 沙箱状态待运行环境复核。 |
| 代码与依赖 | 前端、Go 全包、Go vet、真实浏览器、上游规则和 DNS 检查通过。生产 npm 审计无公告命中。 |

本地便携 EXE 未签名，另一台电脑需要 WebView2 Runtime 和已安装的 Chromium 系浏览器。实际 iOS/Safari、Android、Windows 10、企业安全策略与不同物理网络环境仍需复验。CSS 视口模拟提供了布局覆盖。

开发依赖 picomatch 4.0.7 仍有上游未修复的公告。它只由构建与测试工具处理仓库内的匹配表达式，便携成品的运行依赖不包含该 Node 模块。 [GitHub 安全公告](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) · [v1.6 历史验收](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/blob/v1.6/docs/TEST-REPORT.md)
