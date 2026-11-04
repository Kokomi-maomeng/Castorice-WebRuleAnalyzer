# v1.5 验收报告

2026-11-04。逐项处理与验证范围见 [v1.5 修复与发布验收报告](audits/v1.5-修复与发布验收报告.md)。上版记录保存在 [v1.4.1 验收报告](TEST-REPORT-v1.4.1.md)。

- 精简预览提示；分类输入跨轮询保留、按需下载和迟到预览保护，来源筛选与提示浮窗回归。
- 导出九种尺寸、字体放大、三格式完整下载、大分类、密集夹具及正常/减少动效。
- DPR=2、1280×800 / 720 内容区分别完整显示 7 / 5 条真实分类规则；分类选择逐帧最大列表位移为 0 像素，多分类输入高度不变。
- Windows 桌面关闭、采集中关闭、强制退出与恢复；Debian 非 root 服务、缓存保留、真实采集和导出。
- 前端测试、Go 测试/vet、依赖与源码/成品漏洞检查；发布前检查待上传文件、Git 历史和附件中的敏感资料。

本报告说明已检查的范围；另一台物理笔记本未实测，缩放使用等效浏览器模拟。网站登录、地区、风控和业务功能仍需结合目标站点核对。CI 结果见 [Actions](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/actions)，附件及哈希见 [v1.5 Release](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/tag/v1.5)。
