# v1.0 技术设计与接口

## 数据流

```mermaid
flowchart LR
  UI[React / Material UI] --> API[本地 HTTP API]
  API --> Tasks[单任务管理器 / Context]
  Tasks --> Browser[独立 Chrome Profile / chromedp]
  Browser --> Guard[受控 HTTP / CONNECT 代理]
  Guard --> Site[校验并固定目标 IP]
  Browser --> CDP[CDP Network 事件]
  CDP --> Recorder[请求 / 域名 / 页面 / 日志]
  Recorder --> SQLite[SQLite 增量批量保存]
  Recorder --> SSE[SSE 更新通知]
  SSE --> UI
  Source[GitHub Adapter / 固定 Commit] --> Rules[来源独立的分类缓存]
  Rules --> Match[保守加权匹配]
  Recorder --> Match
  Rules --> Merge[类型化合并与覆盖分析]
  Recorder --> Merge
  Merge --> Export[Clash / classical / sing-box]
```

`model` 定义 ScanTask、NetworkRequest、DomainRecord、RuleEntry、RuleOrigin、RuleMatch、ExportJob。采集器不拼接客户端规则。只有 `exporter` 根据统一类型生成 YAML/JSON；前端不解析上游规则或计算合并。

## 采集与生命周期

- `manager.Start` 规范化/解析目标、校验参数、获取单任务槽，先保存任务再启动 Context 限时扫描。
- `engine` 检测浏览器，创建独立临时 Profile 和逐连接校验代理。默认 headless，辅助交互可见。
- 监听 requestWillBeSent、responseReceived、loadingFinished、loadingFailed、webSocketCreated、webSocketWillSendHandshakeRequest、webSocketHandshakeResponseReceived、webSocketClosed、webSocketFrameError，以及 SPA 路由/主框架导航事件。
- 同 CDP RequestID 的重定向各跳生成不同记录 ID。耗时使用同一单调时钟差值；未完成请求不推测成功或完整耗时。WebSocket 不保存帧正文。
- 事件回调只更新受互斥保护的内存记录。750ms 将脏请求、脏域名、新日志及小任务快照在一个 SQLite 事务批量写入；结束强制最终写入。
- 超时/取消/浏览器退出统一结束，停止浏览器 allocator、关闭代理连接、删除 Profile，再释放任务槽。数据库错误取消任务并在界面标明；进程被强制终止遗留的 active 任务在下一次启动修正为 failed。
- 主文档 HTTP 4xx/5xx 与导航异常标记失败，子资源失败保留记录并允许继续。大量请求不会每条写数据库或渲染全表。

## 地址和 API 保护

自动 DNS 默认使用系统解析，仅对全部属于已知双栈 Fake-IP 网段的答案，通过固定 1.1.1.1 的 Cloudflare HTTPS DNS Wireformat 重新查询 A/AAAA，再次执行原有公网校验。TLS 证书正常验证，拒绝 DNS HTTP 重定向、截断/不匹配消息及过大响应，缓存上限 60 秒。私网/公私混合答案不会借此放行，用户可选择仅系统 DNS。不会改变系统配置。

仅导航 HTTP(S)，拒绝 URL 凭据、非法端口和含混主机。HTTP CONNECT/普通 HTTP/WebSocket 每次建立 TCP 前校验所有 DNS 地址，并连接字面 IP，不进行第二次域名解析；任一私网答案即拒绝。重定向和子资源同样经过该代理。隐式 loopback bypass、QUIC、非代理 WebRTC UDP 关闭；不使用 `--no-sandbox` 或忽略证书错误。

普通运行无法从 GUI/API 放开私网。测试程序只为精确 loopback IP:port 或 `.test:port → loopback IP` 开启显式内存白名单；既不接受网段或通配符，也不保存为用户偏好。

本地服务只绑定回环地址；校验 Host 防止 DNS Rebinding 访问 API；拒绝不同 Origin/cross-site 请求；写操作需同源获取的每次服务随机 CSRF 令牌。开发源只能由 `--dev-origin` 显式指定。API 不作为已实现的远程认证服务宣传。

URL 查询参数值统一替换为 REDACTED，去掉凭据和片段，路径长令牌及已知 token/reset 等片段脱敏。数据模型没有请求头/正文/Cookie 字段。错误和日志经过同一 URL 脱敏器。UI 的“URL”因此是脱敏后的值，绝不声称与含认证参数的原文完全一致。

## 分类与评分

上游按来源、分类、固定 Commit 保存。blackmatrix 通过 Git trees 下钻到实际 Clash 子树再递归索引，拒绝 GitHub 截断结果；避免把全仓库脚本和规则混合。v2fly 的 tar 只读取常规 `data/文件名`，不解压路径、不执行内容。上游目录变化或下载错误不覆盖旧缓存。

`include` 递归查找，检测栈循环、深度与条数；包含 `@attr` 与 `@-attr` 时先过滤，再最终去重，避免重复域名的属性并集改变 include 语义。`&分类` affiliation 在解析所有文件时补到目标分类。regexp 等不支持项保留警告。

匹配先建立观察精确域名与各层标签后缀索引，再关联分类，避免“分类 × 域名 × 全部规则”的乘法遍历。关键词单独做子串匹配。每个分类/域名取最强规则特征，并除以共享分类数的平方根。广泛可注册后缀权重 0.35，关键词 0.12，已知共享域名乘 0.08。

基础分数为 `min(25, 特征权重和 × 12) + 覆盖率 × 15`；真实分类命中目标且身份/公开别名一致加 65；目标 Hostname 直接入口加 15；通用/超过 500 规则的分类乘 0.4，最高 100 分。高置信度需 >=80 且明确身份，中等 >=40；不同应用候选间距小于 12 分时撤销自动选择。同应用两来源可视为同一 family，Gemini 和 Google 分开。身份别名只是公开应用元数据，不生成任何额外规则。

关键词、上游覆盖范围和共享认证域名均不能证明某个域名是应用必需项。GUI 允许用户在观察/合并范围及逐条预览中决定导出内容。

## 数据库

SQLite WAL、busy_timeout、单连接事务；任务、请求、域名、事件、规则来源、分类与设置独立表。请求 `(task_id,id)` 主键，索引 `(task_id,host,time)` 与 `(task_id,time)`；事件 ID 按任务递增；历史按开始时间倒序。结构化 payload 是统一 Go model 的 JSON，查询条件使用专用索引列及参数绑定。

运行时只保留一个活动任务；已结束任务从 SQLite 分页读取。请求上限 20,000、日志内存窗口 2,000、覆盖账本 1,000；前端请求分页 50，域名/预览渐进加载。SSE 每 500ms 发送发生变化的任务快照，前端获取对应任务域名/请求页与增量日志；断线自动重连并补取完整状态，切换任务关闭旧连接且忽略迟到响应。

## HTTP API

返回 `{ "data": ... }` 或 `{ "error": { "code": "...", "message": "..." } }`。除 SSE 外均 JSON。未知键、过大请求、多余 JSON 数据被拒绝。写操作带 `X-Castorice-Token`。

| 方法/路径 | 作用 |
| --- | --- |
| GET /api/health | 名称、版本、健康 |
| GET /api/session | 当前服务写操作令牌 |
| GET /api/browsers | 已安装浏览器检测 |
| POST /api/scans | `{url, options?}` 创建任务 |
| GET /api/scans | 最近 100 条历史，覆盖当前运行状态 |
| GET /api/scans/{id} | 任务、参数、统计、页面、匹配 |
| POST /api/scans/{id}/stop | Context 取消并释放资源 |
| GET /api/scans/{id}/domains | 观察域名和关联请求 ID |
| GET /api/scans/{id}/requests | `host/method/type/status/limit/offset` 过滤分页 |
| GET /api/scans/{id}/events | SSE `update` 任务快照及心跳 |
| GET /api/scans/{id}/logs | `after` 增量结构化日志 |
| GET /api/rules/sources | 状态、许可证、Commit、更新时间 |
| GET /api/rules/categories | 真实分类索引，`q` 搜索 |
| POST /api/rules/sync | `{source}` 手动更新 |
| POST /api/rules/load | `{id}` 加载按需分类 |
| POST /api/rules/match | `{task_id}` 用本地缓存重新匹配 |
| DELETE /api/rules/cache | 清理可重新下载的规则缓存 |
| DELETE /api/browser/sessions | 空闲时清理本程序残留会话 |
| POST /api/export | ExportJob，返回内容、逐条来源、统计、来源说明 |
| GET / PUT /api/settings | 读取/校验/保存设置 |

## 后续平台

Go 核心、SQLite、规则逻辑不依赖 Windows；浏览器发现和打开 GUI 单独按 GOOS 适配。未来 Docker 必须由容器服务端浏览器扫描，并增加远程认证、持久化/沙箱及部署约束；页面不能抓取访问者设备全系统流量。Tauri 2 可将本机 Go 二进制作为 sidecar 并显示同源 GUI，但当前未交付或声称已验证 Tauri 安装包。
