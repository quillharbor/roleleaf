# RoleLeaf ZIP 解析规则

本文适用于 Chrome、macOS 和 Android 的 RoleLeaf 导出包。批量导出会生成多份 ZIP，每份对应一个角色。文件名、下载目录和保存时间都不参与角色匹配。

## 1. 读取并校验 ZIP

1. 从 ZIP 根目录读取唯一的 `manifest.json`，用 UTF-8 解析 JSON，确认 `schema` 为 `bot_package_v1`。未知 schema 交由对应的旧版或其他格式解析器处理。
2. 按 `manifest.files` 校验每个条目。每项包含 `path`、`bytes` 和 `sha256`。按解压后的原始字节计算长度和 SHA-256，小写十六进制比较摘要。目录条目不参与文件校验。清单自身列在 `index_excludes`，目前值为 `["manifest.json"]`。
3. 拒绝重复文件、路径冲突、绝对路径、反斜杠、空路径段、`.` 或 `..`、符号链接、未登记文件和摘要不匹配的文件。逐条限制解压大小。当前导出器最多写入 10,000 个条目，总文件内容最多 128 MiB。
4. 校验通过后，读取 `manifest.report` 指向的报告，当前为 `provenance/report.json`。角色和消息数据以 JSON 为准。`README.html` 和 `transcript.txt` 供人工查看。

`files` 中的摘要可用于发现文件损坏或与清单不一致。整个 ZIP 没有签名，`is_creator` 只表示导出模式。

## 2. 识别导出模式和文件

从 0.5.6 起，`is_creator` 必须是布尔值。

| 路径或字段 | 普通聊天包 `false` | 创作者包 `true` |
| --- | --- | --- |
| `character/character.json` | 只有 `name`。`manifest.name` 同样可用于显示 | 角色资料。以各字段的 `value`、`status` 和 `source` 判断内容和来源 |
| `character/card.json`、`character/card.png` | 无 | JSON 为 Character Card V2，PNG 卡片在成功生成时提供 |
| `conversations/<序号>-<安全化会话ID>/messages.json` | 当前会话。以 JSON 内的 `id` 为会话 ID | 无 |
| 同目录下的 `transcript.txt` | 可读版聊天记录 | 无 |
| `assets/` | 已下载的聊天图片 | 已下载的角色素材 |
| `provenance/source.json` | 无 | 创作编辑器返回的角色字段 |
| `provenance/report.json` | 角色区为 `name_only`，同时记录会话与图片覆盖情况 | 聊天区为 `not_requested`，同时记录角色字段与图片覆盖情况 |

按 `report.images.assets` 关联图片。只有 `status: "saved"` 的项目应从包内的 `path` 读取。同一图片可能被多个条目引用。失败或缺失项保留报告状态，导入时无需重新请求原始 URL。

## 3. 保留聊天内容和覆盖状态

- `messages.json` 使用 `bot_messages_v1`。保留 `messages` 的原始顺序、`id`、`role`、`content_type` 和 `timestamp`。用 `content` 读取已选中的正文。`null` 表示已选回复文本未知，不能用第一个候选代替。
- 保留 `candidates` 中已取得的回复候选。`selected_candidate_id` 存在时，对应候选的 `candidate_id`。原始候选覆盖尚未验证，空数组也不能证明源站从未生成过其他回复。
- `completeness.complete_current_mainline` 描述当前会话主线。结合报告的 `stopped`、`warnings` 和各区状态显示缺项。`manifest.complete: false` 的部分包仍可读取。`manifest.complete: true` 只覆盖该包声明的范围。
- 创作者资料中的 `metadata_only` 表示只拿到引用或摘要。空值、缺失和仅有引用应分别处理。

## 4. 用 `match_id` 匹配角色

从 0.5.11 起，直接读取 ZIP 根目录 `manifest.json` 的顶层 `match_id`。它与布尔字段 `is_creator` 同级，格式为 64 位小写十六进制字符串（`^[0-9a-f]{64}$`）。第三方可以直接按这个值做匹配或去重，无需解密。

Chrome、macOS 和 Android 使用同一算法。只要源平台和原始 Bot ID 一致，重复导出、角色改名、普通聊天与创作者模式都会得到相同的值。

`match_id` 是 `JSON.stringify(["roleleaf-character-id-v1", platform, botId])` 经 UTF-8 编码后计算的 SHA-256 摘要。平台取值为 `tipsy` 或 `character_ai`，Bot ID 按源站字符串保留大小写和前导零，且不会作为角色身份字段写入新包。它只用于匹配，已知候选原始 ID 的一方可以计算摘要并比较。

## 5. 兼容旧包和解析失败

- 0.5.6 至 0.5.10 的旧包可包含 `manifest.character_id` 加密对象。若导入方以前已经解密并保存了摘要，可直接和新包的 `match_id` 比较。手中只有旧密文、又无需支持解密时，可从源平台重新导出取得 `match_id`。
- 更早的包若有明文 `manifest.bot_id`，可结合 `manifest.platform` 按第 4 节计算相同的摘要。缺少 `is_creator` 时，以 `scope.actual === "creator_character"` 识别创作者导出。
- 新包的 `match_id` 缺失或格式无效时，仍可在 ZIP 校验通过后预览内容，停用基于角色 ID 的自动合并。
