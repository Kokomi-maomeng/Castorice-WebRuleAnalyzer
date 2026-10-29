# 将导出规则接入客户端

导出结果是规则片段或规则集。先在客户端备份配置，再合并对应内容；本应用不写入客户端配置。规则顺序会影响匹配，应放在已有兜底规则之前。

## Clash / Mihomo

策略名必须与已有的策略组一致。例如客户端已存在 `dibao`，把导出文件的 `rules` 条目合并到现有 `rules` 段。选择“仅列表”时只复制列表项，不要创建第二个同名 `rules` 键。应用不会创建代理节点或策略组。

## Rule Provider

将导出 YAML 保存为客户端能访问的 `./rules/castorice.yaml`，在现有配置中合并：

```yaml
rule-providers:
  castorice:
    type: file
    path: ./rules/castorice.yaml
    behavior: classical
    format: yaml
rules:
  - RULE-SET,castorice,dibao
```

`dibao` 要替换为实际已有的策略组；同名顶层键需合并。参阅 [Mihomo 规则集合文档](https://wiki.metacubex.one/config/rule-providers/)。

## sing-box

将导出 JSON 保存为 `./rules/castorice.json`。把以下内容合并到现有 `route` 中，`proxy` 替换为已有 outbound tag：

```json
{
  "route": {
    "rule_set": [
      {"type": "local", "tag": "castorice", "format": "source", "path": "./rules/castorice.json"}
    ],
    "rules": [
      {"rule_set": ["castorice"], "action": "route", "outbound": "proxy"}
    ]
  }
}
```

这是合并示例；启动客户端前用其配置检查命令验证。参阅 [sing-box Rule Set 文档](https://sing-box.sagernet.org/configuration/rule-set/)。实际客户端版本和已有配置可能有额外约束。

导出后的规则不会随本应用缓存自动更新。要获取新版本，重新预览并导出；合并外部规则时一并保留来源说明和许可证。
