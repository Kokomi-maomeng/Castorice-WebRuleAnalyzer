# v1.4.1 验收报告

2026-11-04。逐项修复、代码及运行证据见 [修复与发布验收报告](audits/v1.4.1-修复与发布验收报告.md)。上版记录保存在 [v1.4 验收报告](TEST-REPORT-v1.4.md)。

- 地址、DNS、回环/混合地址、代理、TLS、HTTP、导航/整体超时与部分页面失败分别处理。
- 独立 HTTPS DNS、本机 HTTP/SOCKS5 连接、真实网站采集和诊断对照；所有实际目标继续校验公网地址。
- 历史搜索、分页、单条/多选/全部已结束记录删除，活动任务拒删、事务级联与设置保留。
- 主界面和导出八种尺寸、字体放大、三格式完整下载、大分类、密集夹具及正常/减少动效。
- Windows 桌面关闭、采集中关闭、强制退出与恢复；Debian 非 root 服务、缓存保留、真实采集和导出。
- 前端测试、Go 测试/vet、依赖与源码/成品漏洞检查；发布前检查待上传文件、Git 历史和附件中的敏感资料。

本报告说明已检查的范围；网站登录、地区、风控和业务功能仍需结合目标站点核对。完整跨平台与客户端接入边界见完整报告。CI 结果见 [Actions](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/actions)，附件及哈希见 [v1.4.1 Release](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/releases/tag/v1.4.1)。
