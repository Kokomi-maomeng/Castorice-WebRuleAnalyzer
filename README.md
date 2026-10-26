# Castorice-WebRuleAnalyzer v1.2

Web 分流规则分析器。输入网址，用独立 Chrome / Edge / Chromium 采集实际网络请求，查看域名与规则命中，导出 Clash/Mihomo、Rule Provider 或 sing-box 规则。

## 下载与运行

从 [GitHub Releases](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/latest) 下载 Windows 便携 ZIP，**解压后双击 `Castorice-WebRuleAnalyzer.exe`**。无需 Go、Node 或安装器。Windows 10/11 x64 需要 Edge WebView2 Runtime 和 Chrome/Edge；本次在 Windows 11 上完成实测。发行包不带个人数据或外部规则缓存。

软件数据存于 EXE 旁的 `data/`，导出文件存于 `exports/`。解压到可写目录，移动整个目录即可携带数据。关闭主窗口会取消扫描并关闭本次创建的子进程。请先退出旧版再替换 EXE，保留自己的 `data/` 与 `exports/`；先备份数据目录。不能在 ZIP 内直接运行。

## v1.2 的改动

- **窗口工作区**：压缩顶部输入栏；域名列表与分析区域各自滚动；规则命中并入分析选项卡。窄窗口自动切换面板，低高度窗口收起部分选项。高级参数独立弹窗。
- **完整规则原文**：规则库采用分类列表与原文编辑区，可全选、复制、临时编辑、恢复原文、下载。Facebook YAML 的 IP/ASN 等未转换条目原样保留。编辑不会修改已缓存规则或匹配行为。
- **本地规则搜索**：搜索分类名或原文件中的域名，分类名称优先排列；点击查看原文。blackmatrix7 更新时下载全部分类，不再只预加载 12 类。
- **自动更新开关**：在规则库设置中按来源开启，立即下载、运行期间每日检查；失败至多每小时重试，保留旧缓存。关闭软件后没有后台计划任务。可手动检查新版本或立即更新。
- **实际规则命中**：分开显示目标主机、第三方请求和关键词命中；每项列出命中的具体规则。第三方 Google/认证/字体依赖不再显示成目标应用推荐。移除界面上的算法分数。
- **Linux 与容器**：Linux 启动本地网页界面；Docker 提供完整网页服务。无图形会话时使用快速扫描/自动探索，辅助可见交互会明确禁用。

`gemini.com` 与 `gemini.google.com` 是不同网站。规则库中的 Google Gemini 分类需实际命中其对应域名，名称相似不会生成规则或自动识别。

## 操作

1. 输入 URL 或域名，选择快速扫描、自动探索或辅助交互，开始分析。
2. 左侧只显示本次真实观察域名；点击域名查看相关请求。
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

解压 Linux amd64 包，在有 Chromium/Chrome 的系统中运行：

```sh
chmod +x castorice start.sh
./start.sh
# 或启动服务而不打开网页
./castorice --server --no-open --listen 127.0.0.1:19110 --data-dir ./data
```

Debian 可自行通过官方软件源安装 Chromium。图形会话下支持可见辅助交互；SSH/无桌面服务只提供无头采集。Linux 使用系统浏览器显示界面，Windows 使用原生 WebView2 窗口。

## Docker 网页版

```sh
docker compose up -d --build
# 浏览器访问 http://127.0.0.1:19110
```

Compose 默认仅绑定宿主回环地址，使用持久卷保存数据。Chromium 以非 root 用户运行，并保留自身沙箱；Compose 中允许其创建用户命名空间，Debian AppArmor 环境也需要相应容器选项。不要把本地工具直接开放为匿名公网服务。

如修改映射端口/域名，需要通过 `--public-url` 配置**精确来源**，保持 Host/Origin 校验。可用 SSH 转发访问远程主机的回环端口；不要修改系统代理、DNS 或防火墙来迁就测试。没有图形会话的容器不提供可见浏览器辅助模式。

Linux 发布目录也附带 `Dockerfile`，可在该目录 `docker build -t castorice:1.2 .`，使用已编译的同版二进制构建运行镜像。仓库根 Dockerfile 可从源码完整构建。

Ubuntu 23.10+ 等限制无特权用户命名空间的宿主机，还需加载仅供本容器使用的 AppArmor 配置，然后指定它启动：

```sh
sudo apparmor_parser -r deploy/castorice-browser.apparmor
CASTORICE_APPARMOR_PROFILE=castorice-browser docker compose up -d --build
```

这不会关闭宿主机全局保护，也不使用 `--no-sandbox`。镜像显式安装 `chromium-sandbox`。配置依据见 [Chromium 官方说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)。

## 开发与验证

需要 Go 1.26+、Node 24+；依赖版本锁定。

```powershell
./scripts/test.ps1 -Browser -LiveRules -LiveDNS
./scripts/build.ps1 -BrowserTests
./scripts/build-linux.ps1
# 启动独立测试服务后验证真实页面、规则原文及响应布局
$env:CASTORICE_TEST_URL='http://127.0.0.1:19120'
node scripts/verify-ui.mjs
python scripts/audit-release.py --zip ./dist/Castorice-WebRuleAnalyzer-v1.2-windows-amd64.zip
```

`verify-ui.mjs` 使用系统 Chrome，先在测试服务下载规则库；普通 Go 测试不自动下载规则或运行浏览器。浏览器/上游实测通过显式开关启用。测试站只使用精确、临时注入的 `.test` 白名单，生产扫描始终阻止私网/回环/元数据目标。

[测试报告](docs/TEST-REPORT.md) · [发布流程模板](docs/RELEASE-WORKFLOW.md) · [架构与安全边界](docs/ARCHITECTURE.md)

## 边界

- 这是受控标签页的 CDP 网络事件采集，不是系统 PCAP；失败请求也会记录。新标签页、独立 Worker、登录后功能和未操作流程的覆盖有限。扫描通过不证明整个应用完整覆盖。
- 不保存请求头、Cookie、认证信息或正文；URL 查询值脱敏。任意业务路径仍可能敏感，请妥善保管自己的历史与导出文件。
- 默认禁用 QUIC，保护代理支持 HTTP(S)/WebSocket；没有声称采集原生 HTTP/3。
- 系统 DNS 含已知 Fake-IP 且其余均为公网地址时，自动模式使用固定 Cloudflare HTTPS DNS 重新验证公网地址；真实私网及其与公网混合的答案继续拒绝。不修改系统网络配置。
- Windows 包没有代码签名。未在全新无 WebView2 的 Windows 10/11 安装上实测；第三方登录、支付等流程未执行。
- 历史保存当时的匹配，重新匹配使用当前缓存。缓存清理后需重新下载；外部仓库、网络及规则本身不由本项目保证。

本项目采用 MIT。
