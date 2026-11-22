# 长期目标

把 Panthesia 做成"打开一首歌就能练"的钢琴练习程序：曲库由 Keel 管理并按文件类型打开 Panthesia；歌曲数据写在文件旁的 `.panthesia` 清单中；演奏舞台、分层歌曲模型、谱面、和声分析、伴奏、虚拟双手已完成；当前阶段重新设计歌曲页与演奏舞台的排版，并让 Keel 插件与歌曲页显示同一份资料。技术栈 Rust + Tauri + React。

计划与阶段：[docs/development/current-plan.md](docs/development/current-plan.md) 第 4 节。进度记录：[docs/development/progress.md](docs/development/progress.md)。

## 执行

按 `CLAUDE.md`"长期自主执行"一节连续开发：每轮先读 `current-plan.md` 第 4 节与 `progress.md` 最新一条的"下一入口"，按第 4 节顺序推进，每批完成后检查、提交、写进度记录，然后直接开始下一批。

## 用户已授权（2026-11-21）

- R2 的真实资料迁移：条件与范围见 `CLAUDE.md`，执行时不再询问。

## 停下来询问用户的情况

以 `CLAUDE.md`"长期自主执行"第 6 条为准：授权范围以外删除或改写用户数据、计划外的产品范围变化、推送 / 发布 / 付费服务、同一问题连续三次方案失败。
