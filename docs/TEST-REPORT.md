# v2.0 测试报告

发行包来自同一套前端和 Go 服务。Windows 使用 WebView2，Linux 桌面使用 GTK/WebKitGTK，Docker 和 macOS 通过系统浏览器打开界面。Windows、Linux、macOS 和 Docker 附件的 BUILD-INFO.json 记录源码树、编译目标及二进制 SHA-256。

## 工作区与应用验证

| 平台或模块 | 验证 |
| --- | --- |
| Windows 11 x64 | 实际 WebView2 窗口读取深色应用设置，验证标题栏缩放、键盘缩放、默认重置、历史重新打开、文件保存、三种格式导出和重新启动。检查正常关闭、采集中关闭、强制退出时的进程及端口。 |
| Chrome、Edge、Firefox、WebKit | 使用隔离测试站和本地服务验证实际采集、精确主机请求、弱网补取、历史检索与分页、组合键、嵌套弹窗退场、主题与缩放以及三种格式下载。包含 320×256 视口。 |
| 导出与密集预览 | 从空缓存下载两套规则库，验证真实分类合并、约 8,600 条规则的大分类、完整预览和三格式下载。九种视口检查工具栏；200% 设备缩放检查预览密度、分类搜索稳定性，并用 5,000 行样本复核行号、字号和选中计数。 |
| Debian 13 x64 | 使用 Linux 发行包在 VMware 虚拟机运行独立服务和 X11 GTK/WebKitGTK 桌面应用。正常采集公网保留示例站点，得到 1 个域名、2 条请求，验证三种导出及服务正常退出。桌面验证了缩放、域名检索与排序、历史检索与打开、文件预览、本地保存及正常关闭。 |
| Docker x64 | 在 Debian 虚拟机部署独立 Compose 项目。验证回环监听、访问认证、普通用户、Chromium 独立 PID 命名空间、seccomp、历史持久化与三种导出。该虚拟机的默认 AppArmor 拒绝 Chromium 创建用户命名空间，使用随包提供的 AppArmor 配置后通过。Chrome 实际访问容器并验证历史、域名检索和完整文件预览。 |
| macOS | 从同一源码交叉编译 Apple 芯片和 Intel 附件。无 macOS 实机，本版未在 macOS 上运行。 |
| 代码检查 | 前端 42 项测试通过。Go 全包测试、真实 Chromium、上游规则源、DNS 验证和 Go vet 通过。 |

历史测试见 [v1.7 测试报告](https://github.com/Kokomi-maomeng/Castorice-WebRuleAnalyzer/blob/v1.7/docs/TEST-REPORT.md)。
