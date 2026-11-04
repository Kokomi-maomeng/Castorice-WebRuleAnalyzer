# v1.4 验收报告

2026-10-29。17 项修复、逐项证据和边界见 [修复与发布验收报告](audits/v1.4-修复与发布验收报告.md)。v1.3 历史验收保存在 [TEST-REPORT-v1.3.md](TEST-REPORT-v1.3.md)。

- Go 1.26.10 / x/net v0.62.0；全包测试、vet、真实浏览器/两源/DNS 验证；20 项前端测试、生产构建、版本与格式检查。
- 源码和最终 Windows 成品 govulncheck、npm audit、源码/历史/发行包隐私检查。
- Windows 原生窗口正常关闭、采集中关闭、强制退出恢复、实际公网采集和三格式文件保存。
- Chrome/Edge 明暗主题与窄屏、20 个附加布局场景；八种导出尺寸、字体放大、完整复制下载、分页、减少动效。
- 两源 679/1542 分类；真实大分类合并预览 8,732 条。密集 5,000 条场景是单独标记的测试夹具。
- Debian 13 非 root 持久服务部署、完整规则下载、重启缓存、实际采集和导出；Xvfb 可见交互测试。独立 Docker 非 root 运行和持久卷验证。

Windows 10、缺失 Runtime 的全新安装、macOS/Safari/Firefox、全部代理客户端接入仍不在本轮完整实测范围。容器安全例外和目标服务器容量限制见完整报告。

最终 Release 附件及 SHA256 见 [v1.4](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/tag/v1.4)。
