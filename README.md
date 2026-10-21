# Castorice-WebRuleAnalyzer v1.0

**Web分流规则分析器**。输入网站 URL，通过独立 Chrome / Edge / Chromium 会话观察 HTTP(S)、XHR/Fetch、WebSocket 请求，提取真实出现的域名，按需结合公开分类规则，生成 Clash/Mihomo 或 sing-box 规则文件。

这是可运行的本地 Go 服务与 React Web GUI。Windows x64 运行包内嵌全部前端资源；普通用户无需安装开发工具。首次运行不包含虚构规则、演示历史或预置扫描结果。

## 快速运行（Windows 10/11 x64）

1. 安装 Google Chrome、Microsoft Edge 或 Chromium 中任意一种。
2. 解压 `dist/Castorice-WebRuleAnalyzer-v1.0-windows-amd64.zip`。
3. 双击 `Castorice-WebRuleAnalyzer.exe`，浏览器自动打开 `http://127.0.0.1:19110`。
4. 输入 `example.com` 或完整 HTTP(S) URL，点击“开始分析”。没有协议时补全 HTTPS。
5. 在左侧选择观察到的域名，点击“预览与导出规则”。默认精确 `DOMAIN`，默认策略组 `dibao` 可修改。
6. 按 Ctrl+C 退出控制台服务。关闭 GUI 标签页不会关闭服务。

默认数据目录：Windows `%APPDATA%\Castorice-WebRuleAnalyzer`；其他系统使用 Go `os.UserConfigDir()` 的对应应用目录。SQLite 文件为 `castorice.db`，浏览器会话在 `sessions/` 下创建并在任务结束后删除。可以指定 `--data-dir` 使用便携数据目录。

```powershell
.\Castorice-WebRuleAnalyzer.exe --listen 127.0.0.1:19112 --data-dir .\data
.\Castorice-WebRuleAnalyzer.exe --no-open
.\Castorice-WebRuleAnalyzer.exe --version
```

默认及当前版本只允许回环监听。服务启动即限制单任务，不连接或读取用户日常浏览器 Profile。

## 主要功能

- 快速扫描：加载单页、滚动、观察异步请求；静默等待和每页观察上限均有界，不等待长连接永久静默。
- 自动探索：发现 DOM 中同源普通链接，队列去重，限制深度与页面数；跳过查询参数、普通锚点、下载及已知危险操作路径。支持 `#/route`、`#!/route` 导航及 SPA 路由事件记录。
- 辅助交互：打开独立可见浏览器，在**受控当前标签页**手动登录/操作，采集持续到停止或时间上限。软件不填写账号密码、不自动提交表单。
- 实时域名、请求分页及筛选、响应/失败/耗时、重定向各跳独立记录、WebSocket 握手、过程日志、已访问/跳过/未访问页面。
- IDN/Punycode、末尾点及大小写规范化，Public Suffix List 主域名分析，区分域名与 IPv4/IPv6。IP 主机保留观察记录，但不伪装为 DOMAIN 导出。
- SQLite 批量写入历史、请求、域名、事件、规则索引与设置；刷新 GUI 恢复任务；服务异常中断的旧任务会标记失败。
- 两套真实规则源、独立分类与版本、手动更新、缓存回退、解析警告、可解释匹配及人工选择。
- 观察 / 合并两种范围、逐条来源预览和取消条目、精确去重及后缀覆盖分析、剪贴板和文件下载。
- Material UI 中文界面、明暗/系统主题、设置持久化、历史重开与重新导出。

**左侧始终只显示实际观察记录；规则库补充永远在导出预览展示。** 默认保留观察到的第三方域名，不把广告/CDN/认证分类等同于业务必要性。

## 规则库

| 来源 | 获取与缓存策略 | v1.0 支持 |
| --- | --- | --- |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | GitHub 当前 Commit + 实际 Clash 子树索引；首批 12 个常用应用，其余分类按需下载；固定 Commit 原始文件 | classical YAML / 列表中的 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD |
| [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) | 当前 Commit 的受限 tar.gz 源码快照，只读取 `data/` 常规文件；解析结果存 SQLite | full、domain、裸域名、keyword、递归 include、属性与负属性过滤、`&target` affiliation |

请在界面的“规则库”点击初始化或更新。**扫描本身不会下载整个仓库**，匹配只使用已加载缓存。blackmatrix7 新应用若尚未加载，请搜索分类并点击加载，再重新匹配。没有对应分类或来源不可达时，仍可正常扫描、导出仅观察结果。

所有规则保留原始类型、分类、文件、来源、Commit 和许可证。regexp、IP/策略条件、复合规则等不在本版转换范围，保留警告而不误转成域名。include 限制深度 24、检测循环；文件 2 MiB、压缩快照 20 MiB、解压读取 64 MiB、分类规则 100,000 条上限。

应用匹配使用目标身份/别名、目标入口、域名集合覆盖和跨分类共享频率；字体、认证域名、广泛后缀与大型分类降权。Google 等通用分类不会作为 Gemini 专属分类自动选择。低置信度或不同应用候选评分接近时不自动选定。**分数是算法评分，不是统计识别准确率**。即使有高置信度推荐，导出默认仍为仅观察结果。

本项目自身代码采用 MIT。外部规则不随成品预装；blackmatrix7 为 GPL-2.0 并有上游使用声明，v2fly 为 MIT。初始化时核验、保存上游 LICENSE 原文，可在界面查看。合并导出附带来源信息，并可单独下载 `.sources.txt`。外部规则再分发须遵守各自许可证，详见 [第三方说明](docs/THIRD-PARTY-NOTICES.md)。

## 导出格式

1. **Clash / Mihomo YAML**：`rules:` 列表，每条含策略组；可以仅输出列表以粘贴到已有配置。
2. **Mihomo Rule Provider**：`payload:`，classical 类型，每条不附策略组。客户端需自行声明 provider 并用 RULE-SET 指定策略。
3. **sing-box Source Rule Set**：JSON version 3，目标 sing-box 1.11+，保留 `domain`、`domain_suffix`、`domain_keyword`。可由 `sing-box rule-set compile` 编译；不是完整客户端配置。[官方格式](https://sing-box.sagernet.org/configuration/rule-set/source-format/)

后缀规则只在用户显式选择或上游原本如此时使用。合并不把观察域名自动泛化为主域名。已选上层 DOMAIN-SUFFIX 会覆盖相应 DOMAIN/更窄后缀，预览保留被覆盖行与来源，导出不重复；取消上层规则会恢复未排除的子规则。关键词不会被用来删除精确观察规则，并会显示误匹配风险。

合并统计分别计算观察域名数、外部实际保留的规则条数、重复/被覆盖条数、最终规则数。跨类型与覆盖关系下不能把所有数字都当作域名计数或直接套用简单加减。

## 开发环境与构建

本次验证环境为 Windows x64、Go 1.26.2、Node.js 24.13.0 / npm 11.6.2。建议 Go 1.26+ 与 Node 24 LTS+。使用纯 Go SQLite，正式编译 `CGO_ENABLED=0`；无需 Rust、C 编译器或完整 Chromium 下载。

```powershell
# 源码根目录：安装锁定依赖、前端测试/构建、Go 测试/vet、内嵌前端、编译和打包
.\scripts\build.ps1

# 同时运行真实浏览器集成测试
.\scripts\build.ps1 -BrowserTests

# 前端 Vite 热更新与独立后端，开发数据保存在 .runtime/dev
.\scripts\dev.ps1
# 热更新 GUI http://127.0.0.1:5173；后端 http://127.0.0.1:19110
```

如果本机 PowerShell 策略不允许运行脚本，可在源码目录逐条执行等价命令：

```powershell
cd frontend
npm ci
npm run build
cd ..\backend
go test ./...
go run ./cmd/castorice
# 单独编译：前端构建后
$env:CGO_ENABLED='0'
go build -trimpath -ldflags='-s -w' -o ..\dist\Castorice-WebRuleAnalyzer.exe ./cmd/castorice
```

前端生产构建直接输出 `backend/internal/webui/dist/`，Go Embed 在编译时内嵌。直接运行 `go run` 前应先构建前端；未构建会显示明确提示，不展示假界面。`config.example.json` 为设置 API 的示例结构，正常用户在 GUI 设置即可；程序不会自动读取该示例文件。

## 测试

```powershell
.\scripts\test.ps1                    # Go 单元/API/存储测试 + vet + 前端测试和构建
.\scripts\test.ps1 -Browser           # 增加本机真实 Chrome/Edge 测试，不依赖外网网站
.\scripts\test.ps1 -LiveRules         # 增加真实 GitHub 源、许可证、解析及离线缓存回退验证
.\scripts\test.ps1 -Browser -LiveRules -LiveDNS

# 已启动的正式程序：公网扫描、历史与三种导出验收（需要外网）
.\scripts\smoke.ps1
```

直接命令：在 `backend` 执行 `go test ./...`；浏览器测试显式设置 `CASTORICE_BROWSER_TEST=1`，真实规则源测试设置 `CASTORICE_RULES_LIVE=1`。在 `frontend` 执行 `npm test`。默认跳过真实浏览器和在线规则测试，并会明确标记 skip。`-race` 需要本机 Go race 所需 C 工具链，见 [测试报告](docs/TEST-REPORT.md)。

浏览器测试通过内存注入的精确 `.test:port → loopback` 白名单访问独立 `httptest` 网站，不改变正常策略、hosts、DNS 或系统代理。静态字体为原创测试字体；正常测试不需要 Python。另有 `scripts/local-test.ps1` 可手工验收测试站。测试启动参数 `--test-map-loopback` / `--test-allow-loopback` 只在显式使用时生效，不保存到用户设置；**日常运行不要使用这些测试参数**。

测试覆盖 URL/IDN/IP/PSL、安全代理/DNS Rebinding、源格式/include 属性语义与循环、Gemini/Google 和歧义、合并/覆盖/排除、三格式可解析性、SQLite 历史、API Host/Origin/CSRF、SSE 隔离、前端预览与断线、真实浏览器采集和资源清理。实际执行结果见 [测试报告](docs/TEST-REPORT.md)。

## 架构与目录

```text
frontend/                    React + TypeScript + Material UI + Vite
  src/components/            采集、域名、请求、规则库、导出、设置、历史
  src/hooks/                 SSE、状态恢复、请求分页
  src/services/              统一 API / 下载 / 剪贴板
backend/
  cmd/castorice/             本地服务入口与自动打开 GUI
  cmd/testsite/              仅开发/测试站入口
  internal/api/              HTTP API、SSE、Host/Origin/CSRF
  internal/browser/          跨平台浏览器路径检测
  internal/scanner/          chromedp、CDP 记录器、任务生命周期
  internal/crawler/          安全链接发现策略
  internal/domain/           URL、IDNA、PSL
  internal/security/         地址校验、受控代理、统一脱敏
  internal/rules/            来源适配、下载、缓存与格式解析
  internal/matcher/          索引匹配与保守推荐
  internal/exporter/         类型化合并、覆盖、YAML/JSON
  internal/storage/          纯 Go SQLite、增量批量写入
  internal/model/            统一业务数据模型
  internal/config/           默认值、校验、系统数据目录
  internal/webui/            Go Embed 静态界面
  internal/testsite/         真实浏览器测试资源
scripts/                     构建、开发、测试
docs/                        架构、安全边界、许可证、验收记录
dist/                        本地产物（不进 Git）
```

API 与数据流、安全设计及匹配评分说明见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。后端可独立构建，核心没有 Windows 专有 API；Linux/macOS 编译验证和 Windows 实测范围在报告中逐项注明。未把 Tauri 作为唯一入口。

## 重要限制与常见问题

- **这不是 PCAP / 系统透明抓包。** 只记录受控当前标签页中 CDP 可见的请求，包括失败/被拦截的尝试。新标签页、独立 Worker、Service Worker 的部分请求，以及未执行交互的功能可能不完整。辅助交互请优先在当前标签页操作。
- **HTTP/3/QUIC 默认禁用。** 地址保护代理支持 HTTP/HTTPS CONNECT 与 WebSocket，并允许隧道内 HTTP/2；未实现受保护的 QUIC 出站。因此不会声称已经验证原生 HTTP/3 抓取。`protocol` 仅保存浏览器实际报告值。
- **远端 IP 可能是保护代理。** 保留浏览器报告值，不把本地代理 IP 推测成真实服务器 IP。没有响应或未完成的耗时保持空。
- **查询值全部脱敏。** 不记录请求头、认证信息或正文；请求 URL 不保存片段，页面账本仅保留经过同样脱敏的 SPA 路由片段，明显长令牌路径片段也会脱敏。但任意 URL 路径可能含业务敏感信息，历史数据仍应妥善保管。
- **规则匹配需要缓存。** 未初始化/未加载的 blackmatrix 分类不会参与匹配；可手工加载后重新匹配。历史保存当时匹配的来源/Commit；再次合并使用当前缓存版本并在预览标明，不保证重现已被更新覆盖的旧外部快照。
- **扫描有界。** 默认 180 秒、深度 2、最多 20 页，单任务最多 20,000 请求，页面覆盖账本最多 1,000 条，内存日志显示最近 2,000 条。静默可能提前结束单页观察；持续轮询会在上限结束。
- **探索保持保守。** 不自动点击控件、不提交表单、跳过查询导航与已知操作路径。无法证明任意站点的所有 GET 都无副作用，针对敏感业务建议快速或手动辅助采集。
- **本机安全保护范围。** 默认拦截回环、私网、链路本地、常见元数据/保留地址，拒绝混合 DNS 答案，逐 TCP 连接固定已验证 IP，禁用 QUIC/非代理 WebRTC UDP；仍依赖未被篡改的 Chrome 代理实现和浏览器沙箱，不是恶意网站的操作系统级隔离环境。
- **网络环境**：保护代理直接连接经过校验的目标 IP，不自动继承系统 HTTP/SOCKS 代理。系统已有 TUN/VPN 仍可能影响连接。自动 DNS 模式仅在系统答案全部属于已知 Fake-IP 网段（198.18.0.0/15、fdfe:dcba:9876::/64）时，经固定 1.1.1.1 端点的标准 HTTPS DNS 重新解析，并再次校验全部地址；设置中可选择仅系统 DNS。此时被查询域名会发送给 Cloudflare，缓存最多 60 秒。不修改系统代理、DNS 或网络设置。自定义其他 Fake-IP 网段或需要额外上游代理链的环境目前可能不可达。
- **构建与桌面封装**：Windows x64 控制台启动器 + 自动打开 Web GUI 已提供；未制作代码签名、安装器和 Tauri 原生窗口。Win10/Linux/macOS 的实际运行与第三方登录/上传/视频流业务流程，不能等同于本机 Chrome 测试通过。
- **端口/实时断开**：查看控制台错误，换一个回环端口；SSE 会自动重连，GUI 每 3 秒补取断线任务状态。服务异常退出后的任务会标记中断，可再次创建扫描。

后续优先补充多标签页/Worker 采集、可选安全上游代理、旧规则快照重现、Tauri 2 + Go sidecar、平台实机验证与签名分发。Android、Docker 远程多用户服务、系统流量采集未实现；架构保留独立服务入口与平台适配位置。
