# Castorice-WebRuleAnalyzer

Web 分流规则分析器。输入网址，用独立 Chrome / Edge / Chromium 采集实际网络请求，查看域名与规则命中，导出 Clash/Mihomo、Rule Provider 或 sing-box 规则。

## 下载与运行

Windows 版使用便携 ZIP。**解压到可写目录后双击 `Castorice-WebRuleAnalyzer.exe`**，需要 Edge WebView2 Runtime 和 Chrome、Edge 或 Chromium。版本页提供安装包、SHA-256 校验值和测试记录。 [GitHub Releases](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/latest)

软件数据存于 EXE 旁的 `data/`，导出文件存于 `exports/`。先关闭旧版再备份并迁移这两个目录。跨电脑迁移前请确认新电脑也具备系统组件和目录权限。 [用户运行说明](docs/用户运行说明.md) · [导出接入说明](docs/EXPORT-INTEGRATION.md)

## v1.7 的改动

- 服务使用独立数据锁，反向代理和容器访问需要单用户认证。Linux 以普通用户运行 Chromium 沙箱。
- 弱网会补取终态结果。点击域名行可按主机精确筛选请求，勾选和复制使用等大的独立按钮。脱敏历史重扫需填写域名。
- 辅助交互记录同文档路由和导航结果。超短窗口可滚动到域名与导出，日志警告文字提高对比度。
- 支持历史规则版本提示、原文入口和缓存更新回滚。合并复制先校验版本，受浏览器限制时可手动选取全文。
- 导出范围直接二选一。需要补充规则库时，可在分类框旁下载并查看进度；文件名称移到保存操作旁。

## v1.6 的改动

- 每次打开进入空白工作区。历史记录可从“扫描历史”打开。
- Windows 和 Linux 桌面共用紧凑窗口栏，网页端使用相同的应用工具栏。
- 开始或停止采集右侧可清空工作区。网络诊断移入高级配置，扫描参数随模式显示。
- 扫描模式、受控浏览器和规则库术语提供按需说明。通过软件设置打开规则库时，返回后保留未保存的设置。

## v1.5 的改动

- 精简预览与导出面板，抓取风险和 DOMAIN-SUFFIX 说明改为支持悬停、点击和键盘的提示图标。
- 分类输入后才显示搜索结果；修复轮询清空输入、选择分类跳动和多分类挤占输入空间的问题。
- 条目按本次抓取、被覆盖、规则库补充筛选；仅抓取模式隐藏规则库补充选项。
- 优化高缩放、短窗口的列表空间，统一输入框、复选框和工具栏间距；预览重算时保留列表，禁止导出过期结果。

验收与缩放模拟范围见 [v1.5 报告](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/blob/v1.5/docs/audits/v1.5-%E4%BF%AE%E5%A4%8D%E4%B8%8E%E5%8F%91%E5%B8%83%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.md)。

## v1.4.1 的改动

- 区分地址、DNS、地址安全、代理、TLS、HTTP 与超时错误；保留诊断详情、最终页面及主文档响应。
- 增加网络诊断、独立安全 DNS、Cloudflare/Google 服务选择与本机 HTTP/SOCKS5 代理；每次目标连接仍校验并固定公网 IP。
- 新输入未启动时明确标注上一任务结果，补充失败/未完成请求及页面覆盖统计，超时与停止使用不同于成功的状态样式。
- 历史支持搜索、分页、单条/多选删除及清空全部已结束记录，活动任务保留。
- 补齐面板、列表、状态过渡和弹窗退出动画，并继续遵循系统减少动态效果偏好。

网络异常时，从“高级配置”打开“网络诊断”。HTTPS DNS 对照由用户选用，界面注明目标名称会交给哪家服务。浏览器采集可使用无认证的本机回环 HTTP/SOCKS5 代理。

## v1.4 的改动

- 修复审计发现的 17 项问题：历史查看时保留停止入口；规范域名跳转继续探索；规则更新保留编辑草稿，并使合并预览和下载重新校验。
- 修复中文长文件名、桌面启动错误、清缓存后的自动更新偏好，以及请求上限、分类数量和 JSON 校验边界。
- 更新 Go 安全工具链和依赖，限制规则解析工作量；提升预览对比度，清理遗留代码，统一版本来源。
- 同时提供 Windows ZIP 与 Linux amd64 tar.gz；补充[导出接入说明](docs/EXPORT-INTEGRATION.md)。

## 操作

1. 输入 URL 或域名，选择快速扫描、自动探索或辅助交互，点击“开始采集”。
2. 左侧显示本次实际观察的域名。点击一行可查看该主机的相关请求。
3. 在“规则命中”核对目标、第三方依赖与具体命中规则；可直接打开分类原文。
4. 开源规则库 → 规则库设置，开启需要的来源自动更新，或手动下载。首次下载需要网络与时间，下载完成后本地搜索可离线使用。
5. 选择域名，预览并导出。默认仅观察结果与精确 DOMAIN；合并外部分类需要核对与选择，不自动加入所有第三方应用规则。

规则原文中保留全部条目；自动匹配和转换支持 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD。IP、进程、逻辑、正则等保留在原文中，不伪装成域名。v2fly 原文保留 include，域名匹配使用经过有界递归解析的规则。

## 规则来源

| 来源 | 缓存方式 | 许可证 |
| --- | --- | --- |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | 固定 Commit 的 Clash 分类 YAML，全部下载；未变更文件复用，成功后整体切换 | GPL-2.0，另见上游声明 |
| [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) | 固定 Commit 源码快照、分类原文、解析后的 include | MIT |

下载时校验上游许可证。原文件、Commit、许可证可在界面查看；再分发外部规则需遵守其许可证。成品与源码不预装外部规则快照。详见 [第三方说明](docs/THIRD-PARTY-NOTICES.md)。更新下载失败不会覆盖已有缓存。

## Linux

从版本页选择 Linux amd64 包并解压。桌面需要 Python 3、PyGObject、GTK 3、WebKitGTK 4.1、中文字体和采集用的 Chromium。Debian 13 的组件可通过系统包管理器安装。

```sh
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 chromium fonts-noto-cjk
chmod +x castorice start.sh
./start.sh
# 或启动服务而不打开网页
./castorice --server --no-open --listen 127.0.0.1:19110 --data-dir ./data
```

在图形会话下，以普通用户运行 `./start.sh` 或 `./castorice --desktop` 可打开原生窗口。服务模式使用 Chromium 无头采集。系统服务应采用专用普通用户并启用 Chromium 沙箱。Linux 既有数据目录在备份后设为该用户所有、权限 `0700`。打开数据库时会检查 SQLite 文件权限，保留既有历史和设置。当前包为 amd64，其他发行版须核对图形组件及沙箱。 [Linux 服务与反向代理说明](deploy/README.md)

## Docker 网页版

```sh
docker compose up -d --build
# 浏览器访问 http://127.0.0.1:19110，用户名为 castorice
docker compose exec -T analyzer cat /data/access-password
```

Compose 默认发布到宿主机回环地址，持久卷保存数据和首次生成的密码。用 `CASTORICE_PORT` 同时调整宿主端口及所需的精确来源。旧部署通过 `docker compose -p 原项目名` 沿用旧卷。停止旧版并备份后，可用同一项目的新配置运行 `docker compose -p 原项目名 run --rm --no-deps --entrypoint chmod analyzer 700 /data`，再启动新容器。

远程访问可用 SSH 转发，或在受控 HTTPS 反代后运行。指定 `--public-url` 会对页面、API 和事件流启用认证；可由权限受限的 `--access-password-file` 提供既有密码。AppArmor 可选配置、Caddy 示例及宿主机条件见部署说明。仓库 Dockerfile 从源码构建，Linux 包中的 Dockerfile 使用成品二进制。 [Linux 容器与反代说明](deploy/README.md)

## 开发与验证

需要 Go 1.26.11+、Node 24+；依赖版本锁定。

```powershell
./scripts/test.ps1 -Browser -LiveRules -LiveDNS
node scripts/verify-local.mjs chrome msedge firefox webkit
./scripts/build.ps1 -BrowserTests
$tag = 'v' + ((Get-Content VERSION -Raw).Trim() -replace '\.0$','')
python scripts/audit-release.py --zip "./dist/Castorice-WebRuleAnalyzer-$tag-windows-amd64.zip"
```

`VERSION` 是版本号唯一来源；前端构建前自动同步 UI、Go 与 Windows 资源，CI 检查漂移。`npm run format` / `format:check` 维护源码格式。Linux 可原生构建：

```sh
cd frontend && npm ci && npm run build
cd ../backend && CGO_ENABLED=0 go build -trimpath -o castorice ./cmd/castorice
```

`verify-local.mjs` 使用已构建的前端、安装好的 Playwright 浏览器和采集浏览器，自动启动隔离测试站、临时服务和数据库，并将 JSON 报告写入 `.runtime/`。上游检查通过显式开关启用。服务限制私网地址、IANA 特殊用途范围和云平台内部地址，管理员可用 `--deny-cidr` 增加组织范围。

[测试报告](docs/TEST-REPORT.md) · [发布流程模板](docs/RELEASE-WORKFLOW.md) · [架构与安全边界](docs/ARCHITECTURE.md)

## 边界

- 这是受控标签页的 CDP 网络事件采集，不是系统 PCAP；失败请求也会记录。新标签页、独立 Worker、登录后功能和未操作流程的覆盖有限。扫描通过不证明整个应用完整覆盖。
- 不保存请求头、Cookie、认证信息或正文；URL 查询值脱敏。任意业务路径仍可能敏感，请妥善保管自己的历史与导出文件。
- 默认禁用 QUIC，保护代理支持 HTTP(S)/WebSocket；没有声称采集原生 HTTP/3。
- 系统 DNS 含已知 Fake-IP 且其余均为公网地址时，自动模式使用固定 Cloudflare HTTPS DNS 重新验证公网地址；真实私网及其与公网混合的答案继续拒绝。不修改系统网络配置。
- Windows 包没有代码签名。未在全新无 WebView2 的 Windows 10/11 安装上实测；第三方登录、支付等流程未执行。
- 历史保存当时的匹配，重新匹配使用当前缓存。清缓存保留自动更新开关，已开启的来源会重新下载；外部仓库、网络及规则本身不由本项目保证。

本项目采用 MIT。
