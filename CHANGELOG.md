# 更新记录

## v1.1 — 2026-10-21

- Windows 原生 WebView2 桌面窗口，双击 EXE 启动，无控制台窗口，不启动外部 GUI 浏览器；保留显式 `--server` 开发入口。
- EXE 旁 `data/` 保存 SQLite、规则缓存、设置、历史、日志、WebView2 数据及临时浏览器会话；`exports/` 保存导出文件，中文文件名与同名自动编号。
- 桌面保存接口经过 Host/Origin/CSRF 校验，限制文件类型、大小和目标目录；实际写入成功后才提示成功。
- Windows Job Object 监督整个应用进程树；窗口关闭取消扫描、关闭服务和数据库，异常终止监督进程时系统回收所属子进程。
- 单目录单实例锁、可写目录检查、启动时恢复清理、退出报告、图标、版本资源及 DPI 清单。
- 新增便携目录、原生导出权限、服务关闭和前端保存失败测试，增加真实 EXE 生命周期验收脚本。

实际发布验证与限制见 `docs/TEST-REPORT.md`。

## v1.0 — 2026-10-21

- Go + chromedp 受控浏览器网络事件采集，独立临时 Profile，实时 SSE 和任务恢复。
- 快速扫描、同源安全链接探索、当前标签页辅助交互；深度、页面、时长及请求上限。
- 请求、重定向、状态、失败、耗时和 WebSocket 握手元信息；域名 IDN/PSL 规范化与 IP 区分。
- SQLite 批量持久化扫描历史、请求、域名、事件、设置和独立规则源索引。
- blackmatrix7 分类索引及按需下载、v2fly 源码快照解析，递归 include/属性过滤/affiliation、循环保护、缓存回退、Commit 和许可证保存。
- 保守且可解释的应用匹配，通用域名与大分类降权、低置信度不自动选择。
- 仅观察 / 分类合并两种导出范围；逐条来源预览、取消条目、类型保留、覆盖分析。
- Clash/Mihomo YAML、classical Rule Provider、sing-box Source Rule Set v3；复制、下载与来源说明。
- React + TypeScript + Material UI 中文界面，明暗主题、历史、规则库管理、请求分页、过滤与详情。
- 网络地址保护代理、DNS 连接固定、私网及元数据拦截、默认回环 API、Origin/Host/CSRF 校验与脱敏。
- 单元、前端交互、真实 Chrome 本地测试站、生命周期和真实规则源验证；Windows x64 单程序内嵌前端构建。

已知范围和测试证据见 README、docs/ARCHITECTURE.md、docs/TEST-REPORT.md。
