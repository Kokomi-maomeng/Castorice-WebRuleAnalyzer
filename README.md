# Castorice-WebRuleAnalyzer

Web 分流规则分析器。输入网址，用独立 Chrome / Edge / Chromium 采集实际网络请求，查看域名与规则命中，导出 Clash/Mihomo、Rule Provider 或 sing-box 规则。

## 下载与运行

Windows 版使用便携 ZIP。**解压到可写目录后双击 `Castorice-WebRuleAnalyzer.exe`**，需要 Edge WebView2 Runtime 和 Chrome、Edge 或 Chromium。版本页提供各平台发行包、SHA-256 校验值和测试记录。 [GitHub Releases](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/latest)

软件数据存于 EXE 旁的 `data/`，导出文件存于 `exports/`。先关闭旧版再备份并迁移这两个目录。跨电脑迁移前请确认新电脑也具备系统组件和目录权限。 [用户运行说明](docs/用户运行说明.md) · [导出接入说明](docs/EXPORT-INTEGRATION.md)

## v2.0 的改动

- 扫描历史支持直接打开、快速检索、范围选择和单条删除。完成状态与时间在同一行，弹窗退出后打开选中的记录。
- 观察域名集中提供全选、排序方式、正倒序和选中计数。搜索从标题右侧展开，按住 Ctrl 可改变单条选择，按住 Shift 可选择连续范围。
- 导出面板集中提供抓取范围和输出格式、行号、分页及完整显示。条目可整行勾选，选中条目数和文件总行数与分页独立。
- 统一弹窗进出、下拉箭头和提示图标。界面主题在软件设置中选择，Windows 桌面支持跟随系统。标题栏提供缩放和恢复 100%。
- 发行附件提供 Windows x64、Linux x64、macOS Apple 芯片和 Intel，以及可直接构建镜像的 Docker x64 包。

[历次更新](CHANGELOG.md)

## 操作

1. 输入 URL 或域名，选择快速扫描、自动探索或辅助交互，点击“开始采集”。
2. 左侧显示本次实际观察的域名。点击一行可查看该主机的相关请求。也可通过复选框或 Ctrl、Shift 选择需导出的域名。
3. 在“规则命中”核对目标、第三方依赖与具体命中规则；可直接打开分类原文。
4. 开源规则库 → 规则库设置，开启需要的来源自动更新，或手动下载。首次下载需要网络与时间，下载完成后本地搜索可离线使用。
5. 选择域名，预览并导出。默认使用「抓取结果」和精确 DOMAIN。选择「抓取结果+开源规则库」后可添加并核对指定分类。

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

## macOS

Apple 芯片选择 macos-arm64，Intel 选择 macos-amd64。安装 Chrome、Edge 或 Chromium，解压后在终端进入目录并运行：

```sh
./start.sh
```

程序启动本机服务并在默认浏览器打开同一套应用界面。可按 Ctrl+C 停止服务。macOS 包采用交叉编译，实机验证状态见测试报告。

## Docker 网页版

使用 Docker x64 独立附件时，先解压并进入含 Dockerfile 与 compose.yaml 的目录。该附件内附已编译的 Linux 可执行文件、Compose 配置和沙箱策略。

```sh
docker compose up -d --build
# 浏览器访问 http://127.0.0.1:19110，用户名为 castorice
docker compose exec -T analyzer cat /data/access-password
```

Compose 默认发布到宿主机回环地址，持久卷保存数据和首次生成的密码。用 `CASTORICE_PORT` 同时调整宿主端口及所需的精确来源。旧部署通过 `docker compose -p 原项目名` 沿用旧卷。停止旧版并备份后，可用同一项目的新配置运行 `docker compose -p 原项目名 run --rm --no-deps --entrypoint chmod analyzer 700 /data`，再启动新容器。

如果宿主机的 `docker-default` AppArmor 策略拒绝 Chromium 创建用户命名空间，请加载随包提供的 `castorice-browser` 策略，并用 `compose.apparmor.yaml` 启动。 [AppArmor 配置步骤](deploy/README.md)

远程访问可用 SSH 转发，或在受控 HTTPS 反代后运行。指定 `--public-url` 会对页面、API 和事件流启用认证；可由权限受限的 `--access-password-file` 提供既有密码。AppArmor 可选配置、Caddy 示例及宿主机条件见部署说明。仓库 Dockerfile 从源码构建，Linux 包中的 Dockerfile 使用成品二进制。 [Linux 容器与反代说明](deploy/README.md)

## 开发与验证

需要 Go 1.26.11+、Node 24+；依赖版本锁定。

```powershell
./scripts/test.ps1 -Browser -LiveRules -LiveDNS
node scripts/verify-local.mjs chrome msedge firefox webkit
./scripts/build.ps1 -BrowserTests
./scripts/build-linux.ps1 -SkipFrontend -DockerPackage
./scripts/build-linux.ps1 -SkipFrontend -Platform darwin -Architecture arm64
./scripts/build-linux.ps1 -SkipFrontend -Platform darwin -Architecture amd64
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
