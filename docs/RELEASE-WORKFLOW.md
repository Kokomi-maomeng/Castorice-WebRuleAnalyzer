# 发布流程模板

适用于后续 Windows 便携版、Linux 和 Docker 网页版发布。每次重新验证当前代码与环境；旧报告只用于选择流程，不等于本次验收。

## 1. 定范围与基线

- 读取用户本轮要求、仓库约束和先前报告；检查 Git 工作区、当前版本、构建工具、浏览器和目标环境。
- 保留用户未提交内容。使用 `codex/` 分支；不触碰与本任务无关的服务。
- 本机 Docker 与 eNSP 冲突时，只在用户指定虚拟机运行 Docker；不启用本机虚拟化或改动代理/DNS。
- 虚拟机空间不足时，优先将测试目录放在足够大的 tmpfs。不要为测试清理用户数据或重启其他服务。

## 2. 实现与针对性回归

- 先复现用户问题：真实上游原文、实际请求、匹配依据、真实窗口布局。
- 区分输入网址身份和共享第三方依赖；用精确/后缀边界、关键词、歧义与空缓存等案例回归。
- 更新规则时核对最新 Commit 和许可证。整源成功再替换；断网、取消、损坏、重启均需保留可用旧缓存。
- UI 不增加无用统计或成段解释；高级选项用弹窗，密集列表在卡片内滚动。手机/缩放/短窗口要保留主要操作。

## 3. 构建顺序

前端构建会清理/重写 Go Embed 资源，**不能和 Go 测试、vet、编译并行执行**。

```powershell
./scripts/test.ps1 -Browser -LiveRules -LiveDNS
./scripts/build.ps1 -BrowserTests
./scripts/build-linux.ps1 -SkipFrontend
```

检查所有外部程序的退出码。不要把编译成功、健康接口或旧测试截图写成实际功能已经通过。

## 4. 三端实测

- Windows：使用发布 EXE 的测试副本，测试中文/空格路径、实际浏览器扫描、三种导出、设置/历史/规则持久化和重复实例。
- 主窗口正常关闭、扫描中关闭、强制退出后恢复：检查所属进程归零、监听关闭、临时 Profile 清理，用户浏览器保持独立。
- 自动关闭测试可用 `verify-desktop.ps1 -AutoClose`；显式测试环境才启用 WebView2 调试与本窗口 WM_CLOSE 钩子，普通启动没有这些测试接口。
- Linux：在用户指定 Debian 的真实 GUI 会话测试采集、取消、超时、私网重定向与清理；SSH 无 GUI 测试不能代替可见交互。
- Docker：非 root Chromium、自身沙箱、持久卷、精确 Host/Origin、真实公网扫描与导出。记录实际网络模式；默认 Compose 端口映射另外验证。
- 空缓存、实际完整缓存、真实扫描结果之外，再单独使用明确标注的密集/缺失数据测试夹具检查布局；不要将夹具当真实采集证据。

```powershell
# 独立服务已启动且已初始化规则库
node scripts/verify-ui.mjs
python scripts/smoke.py --base-url http://127.0.0.1:19110
./scripts/verify-desktop.ps1 -PackageDirectory ./dist/Castorice-WebRuleAnalyzer-v1.2-windows-amd64 -Scenario normal -AutoClose
./scripts/verify-desktop.ps1 -PackageDirectory ./dist/Castorice-WebRuleAnalyzer-v1.2-windows-amd64 -Scenario active-close -AutoClose
./scripts/verify-desktop.ps1 -PackageDirectory ./dist/Castorice-WebRuleAnalyzer-v1.2-windows-amd64 -Scenario force-crash
```

替换示例版本号。测试数据只放 `.runtime/` 或外部临时目录；不在正式发布目录启动 EXE，避免个人历史进入 ZIP。

## 5. 隐私与包检查

- 扫描当前待上传文件和全部待推送 Git 历史。检查凭据、密钥、账号目录、真实访问资料、日志、数据库、浏览器 Profile、截图、压缩包。
- `audit-release.py` 只输出文件身份与规则名，不输出命中的秘密值；它是有限的辅助检查，仍须人工审阅 diff 和附件内容。
- ZIP 中只包含 EXE、公开文档、许可证与校验值；不包含 `data/`、`exports/`、`.git/`、`.runtime/`、真实账号资料或规则快照。
- 从干净 ZIP 再次解压启动，核对最终 EXE/ZIP SHA256。签名、系统组件依赖、未测平台应明确写入报告。

```powershell
python scripts/audit-release.py --zip ./dist/Castorice-WebRuleAnalyzer-v1.2-windows-amd64.zip
```

## 6. 发布与下载复验

1. 更新版本、变更记录、用户说明、架构、安全边界和测试报告。
2. 使用公开贡献者 Git 身份提交；检查推送目标和可见性，不能夹带其他项目资料。
3. 推送分支后等待 CI；需要修复则重新验证，不能以绿色健康接口替代失败检查。
4. 发布对应标签的 GitHub Release，并上传 Windows 便携 ZIP 和 SHA256。后续版本继续沿用此形式。
5. 从 GitHub 下载附件，比较 SHA256，再次解压启动真实成品。确认 Release 标签与附件对应相同源码版本。
6. 保存脱敏报告。关闭本次临时服务与测试浏览器；验证虚拟机原有服务未被改动。不要停止用户日常浏览器、代理或无关容器。
