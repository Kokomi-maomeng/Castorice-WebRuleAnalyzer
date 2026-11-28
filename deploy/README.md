# Linux 容器安全配置

默认 Compose 使用独立非 root 账户、丢弃容器 capabilities、启用 no-new-privileges，并保留 Docker 的 AppArmor 默认行为。Seccomp 保留 Moby 默认规则，只增加 Chromium 用户命名空间及其内部文件系统隔离所需的调用。Linux 内核仍检查命名空间范围及有效权限。

Docker 附件内含与 Linux x64 包一致的核心程序。网页沿用 Windows 的扫描选项、缩放、规则库侧栏和导出界面。默认没有图形会话，自行交互置灰，悬停或点击可查看服务端图形会话要求。快速和深度模式可用。

在限制非特权用户命名空间的 AppArmor 宿主机上，可加载同目录的 `castorice-browser.apparmor`。此文件保留 Docker 容器策略的挂载、进程和内核路径保护，并只为这套容器许可创建用户命名空间。仓库根目录和已解压的 Linux 包使用同样的命令。

如果应用可以打开，但启动 Chromium 时出现 `Permission denied`，并且内核审计日志显示 `docker-default` 下的 `userns_create` 被拒绝，请使用下列配置。

```sh
sudo apparmor_parser -r deploy/castorice-browser.apparmor
docker compose -f compose.yaml -f compose.apparmor.yaml up -d --build
```

如 Chromium 仍因宿主机策略无法启用沙箱，请检查 AppArmor 和内核用户命名空间支持。采集服务必须能出站访问需要分析的网站和选用的解析服务。对组织管辖的地址范围，在网络出口和服务的 `--deny-cidr` 同时启用限制。

裸机服务可参考 [systemd 单元](castorice.service.example)，在专用普通用户下运行。配置的二进制位置和用户以实际安装为准，用户的主目录可设为系统服务创建的状态目录。

如果通过 Caddy 访问，在服务启动参数中增加 `--public-url https://analyzer.example.net`，保持 Go 监听回环，在 [Caddy 示例](Caddyfile.example) 中通过环境变量 `CASTORICE_HOST` 设置相同的名称并启用 HTTPS。Caddy 转发原始 Host 和 Authorization，按事件流格式转发 SSE。应用使用独立的服务访问密码。部署环境应禁止绕过反向代理访问服务。

Seccomp JSON 及可选 AppArmor 文件改编自 [Moby Profiles 固定提交](https://github.com/moby/profiles/tree/f862455628f78f84c937e967e4a03902fb1dee11)，版权属于 Moby 作者，采用随附的 [Apache-2.0 许可证](LICENSE-moby-profiles)。
