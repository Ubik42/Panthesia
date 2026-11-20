# Panthesia 工程入口

更新：2026-11-20。有效方向：原创实现；前端逐屏、逐操作复刻 Synthesia；扩展能力由后台服务承担。

| 文档 | 唯一职责 |
| --- | --- |
| [Goal 执行提示词](current-goal.md) | 长期开发协议、两小时方向检查、停止条件 |
| [当前计划](current-plan.md) | 批次顺序、任务编号、完成条件与状态 |
| [工程调查](engineering-audit.md) | 真实源码、依赖、来源及文档问题 |
| [架构决策](architecture-decisions.md) | 模块职责、实时边界与迁移方式 |
| [界面与交互规范](interaction-model.md) | 官方截图、完整页面清单、已授权差异 |
| [音乐领域协议](music-domain.md) | tick 时间、稳定 NoteId、旧索引映射与归档协议 |
| [歌曲数据规范](song-core.md) | 身份、文件位置、左右手、版本、谱面和迁移 |
| [原创替换清单](source-independence.md) | Neothesia 应用实现退出、通用依赖与资源来源 |
| [当前交接](modernization-handoff.md) | 最近可运行包、实际证据、下批入口 |
| [Goal 检查点](goal-state.json) | 当前批次、上次方向检查、下次到期时间 |

`current-plan.md` 决定当前任务顺序。旧路线文件只作为跳转入口。交付记录、技术研讨与旧日志按原日期保存，不自动成为新任务。重置前控制文档存于 [历史目录](archive/2026-11-20/README.md)，文件清单及原内容哈希见 evidence/document-reset-manifest.json。

评分、表现目标、速度晋级和达标日课属于 `feature/assessment-lab`。旧资料按导入兼容读取；主线普通练习不产生评分任务。新增默认界面元素必须对应 Synthesia 参考页面或用户明确授权的差异。

当前可运行包仍为 `outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，源码 a67ea54。本轮计划重置与工程清理不代表原创替换或数据迁移已经完成。
