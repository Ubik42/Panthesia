# Synthesia 元数据导入

更新：2026-11-19。对应功能 C12 / C14；当前为可操作的首批实现，剩余差距见下文。

## 使用入口

在曲库管理勾选 1～64 首 MIDI，打开“曲库工具 → 导入 Synthesia 资料”。选择 `.synthesia` 文件后预览，核对匹配、变更数量和未应用项，再应用。导入后重新打开曲目，使用更新的指法与分手。

默认补入空缺资料，保留已有个人文本、指法和手别。标签合并去重；勾选替换时，来源中非空文本和提供的逐音标注可替换已有值。来源没有提供的字段继续保留。来源 0～100 评级按比例映射为本地 0～5 星，原值保留。

每个文件最多 2 MB，一批 MIDI 总大小最多 128 MB。预览不保存文件。曲目内容、附加资料、分组或选项在预览后变化时，需要重新预览。

## 格式依据

- [官方 XML 文件格式](https://github.com/Synthesia-LLC/metadata-editor/wiki/File-Format)：XML v1、歌曲身份、描述字段、分组。
- [官方指法语法](https://github.com/Synthesia-LLC/metadata-editor/wiki/Finger-Hints)：按原 MIDI NoteOn 顺序编号、track / measure 跳转、跳过与同音换指。
- [官方分手语法](https://github.com/Synthesia-LLC/metadata-editor/wiki/Hand-Parts)：L / R / B / X、重复次数、全轨与跳转；旧 HandParts 使用未公开 ConfigHash。

来源音乐文件的 MD5（base64）用于匹配 `.synthesia`，本地资料身份继续使用 BLAKE3。两个标识各自保留，不互相替代。当前匹配输入为 MIDI 原始字节；原 MusicXML 的身份匹配尚未接入。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `midi-file/src/track.rs` | 为每个完整音符保留正力度 NoteOn 的原始序号；运行时结束顺序索引保持原行为 |
| `panthesia-core/src/synthesia_metadata.rs` | 有界 XML 解析、MD5 身份、原始属性与分组、指法 / 分手语法及音符映射；不访问文件系统 |
| `panthesia-engine/src/synthesia_import.rs` | 预览、来源与当前版本核对、保留个人修改、准备 sidecar / 历史 / 分组 / 来源保存结果 |
| 原有 `library_edits` / `asset_storage` | 后台准备、取消检查、依赖核对、统一事务提交与恢复 |
| `features/library/SynthesiaImportDialog.tsx` | 选文件、选项、预览、应用及保存后刷新；请求绑定当前引擎身份 |

解析结果中的换指使用有序步骤，每一步分别保存手别和手指，允许跨手。当前本地指法先应用起始步骤，其余步骤随原始来源和导入记录保留。未关闭的音符、超出轨道或小节的指令明确报错，不通过近似时间猜测身份。

## 保存与恢复

原始来源按内容保存到 `metadata-sources/<BLAKE3>.synthesia`，包含未知属性和未应用内容。`metadata-imports/<请求标识>.json` 记录来源、匹配目标、应用选项、解析标注与结果。

sidecar、资料变更历史、曲库分组、原始来源与结果记录使用同一已有事务提交。预览后的 MIDI 和附加文件均作为提交依赖核对。相同预览请求在响应不明后重试时读取已保存结果，避免重复覆盖个人编辑。

目前练习备份和本地曲目包继续保存其已支持的有效资料，尚未捆绑原始 `.synthesia` 与完整换指链。跨电脑迁移需要同时保留来源文件。后续来源资料模型需要将此部分纳入可移植包；当前不能据此声明 C13 完成。

## 明确差距

1. L / R / B / X 已贯通独立逐音播放规则，导入限制已解除。播放、目标评分、显示、历史、曲目包与备份的规则见 [逐音播放](note-playback-routing.md)。自动发现及来源分层仍待完成。
2. 同音换指链完整保留，尚未自动生成有时间定位的演奏动作。源格式本身没有指定换指时刻。
3. 旧 HandParts 私有 hash、书签和背景图片保留原文，尚未转换为本地行为。
4. 尚未实现扫描目录自动发现 `.synthesia`、原 MusicXML 身份匹配、元数据导出，以及来源更新 / 个人覆盖的独立层。
5. 本批重新打开曲目后应用标注；当前已加载演奏会话的在线替换仍待接入。

## 本批验证

证据位于忽略目录 `work/synthesia-import-20261119/`：

- `core-tests.log`：两组解析检查。覆盖标准 MD5 样例、反向 NoteOff 顺序、跨手换指、有序轨道 / 小节映射、嵌套组、未知属性保留和无效输入。
- `engine-tests.log`：两组事务检查。覆盖保留个人资料、原文件不变、来源保存、分组、重复请求、过期预览拒绝，以及当时尚未接入的路由规则拦截。后续独立逐音路由批次已改为验证 B / X 生效。
- `ui-result.json`：真实隔离服务与浏览器完成文件选择 → 预览 → 应用 → 重新打开；有效字段、分组与起始指法可读取，未出现页面错误。
- `preview-1440.png` / `preview-1024.png`：最终中文界面已检查，窄窗无横向溢出。
- 引擎服务、桌面接口和前端构建记录分别为 `service-build.log`、`desktop-check.log`、`web-build.log`。

本批使用独立数据根中的内置练习，未使用正式用户设置和演奏历史。整体现代化任务继续进行。
