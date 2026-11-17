# v1.6 验收报告

2026-11-18

| 范围 | 验收内容 |
| --- | --- |
| 工作区 | 用带历史的数据库重新打开和刷新，网址与结果为空。历史按需打开，采集中仍可停止，清空操作保留历史和设置。 |
| 界面 | 检查扫描模式帮助、按模式显示参数、高级配置中的网络诊断、规则库术语帮助和多层弹窗的状态恢复。网页工具栏检查了 9 种尺寸，最小为 320×568。 |
| Windows 11 | 便携 EXE 的最大化、还原、真实采集、三种格式导出、正常关闭、采集中关闭、强制退出和重新启动。 |
| Debian 13 | VMware 内用隔离 Wayland 会话验证桌面窗口拖动、最大化/还原、边缘缩放、采集中关闭、真实采集和导出。Docker 使用回环端口映射完成真实采集和三种导出。 |
| 代码与安全 | 前端 31 项测试，Go 全包测试、真实 Chromium、两套上游规则、DNS、vet、源码及两个成品的 govulncheck。使用 Go 1.26.11，生产 npm 依赖审计通过。 |
| 分发 | 检查待提交文件、Git 历史及发行附件，附件中的文档限制为当前使用、开发及验收指南。 |

快速扫描保留总时长、导航超时、每页观察、静默等待。自动探索补充探索深度、页面数与页面间隔。辅助交互显示总时长、导航超时、页面数并始终打开采集窗口。DNS 和代理对三种模式有效。

规则库核对上游原文，提示中的 `include:分类名` 表示引用其他分类。扫描模式与规则库说明支持悬停、点击与键盘焦点。

开发工具依赖 picomatch 4.0.7 仍有尚未发布修复的 [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)。它只参与构建和测试，发行应用运行时不加载该模块。CI 单独审计生产依赖，开发审计记录此单项例外。

[GitHub Actions](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/actions) · [v1.6 下载和 SHA-256](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/tag/v1.6) · [v1.5 历史验收](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/blob/v1.5/docs/TEST-REPORT.md)
