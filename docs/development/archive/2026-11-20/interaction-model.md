> 历史快照：2026-11-20 计划重置前。当前执行入口见 [当前计划](../../current-plan.md)。

# 管理与演奏的界面规则

更新：2026-11-20。适用主线；本轮处理用户指出的界面冗余，不扩大功能清单。

## 使用流程

按用户追加的明确要求，逐屏照 Synthesia 官方截图安排布局。选曲页使用通栏目录 / 歌曲列表，上方为路径与搜索，右上继续，底部排序；目录通过同一列表进入，并通过路径栏返回。双击歌曲或继续进入独立歌曲设置页。右键歌曲可打开、查看歌曲与演奏版本、在资源管理器中显示文件。查看窗口按需打开，选曲页不常驻详情侧栏。

歌曲设置页采用官方截图的左右两区：左侧观看 / 连续播放及声部入口，右侧左手 / 右手 / 双手跟随练习。演奏页按官方截图将控制条放在最顶端，时间线紧贴其下，瀑布与谱面占据主体，琴键贴底。播放、暂停、上一 / 下一小节、BPM 与工具图标集中在顶部。音源、版本、转调量化、声部、节拍、书签和详细外观通过设置打开。练习设置使用临时抽屉，关闭后不占用舞台宽度，也不因旧布局偏好自动常驻。

## 本轮完成

- 删除“全部歌曲”“入门练习”两个分类及常驻左侧导航；目录条目与歌曲共用通栏列表，路径栏逐级返回。
- 删除开头八秒试听、示意谱图、音源状态卡和文件位置展开面板；选择歌曲不再自动请求 songPreview 或启动试听。
- 文件操作统一在歌曲右键菜单；支持 Shift+F10、方向键和 Escape。
- 按需查看演奏版本，直接打开演奏中的完整谱面入口；不再将开头示意图当作谱面阅读。
- 演奏版本、转调量化、书签、保存段落与队列移入练习设置。齿轮管理谱面 / 瀑布显示，缩放、节拍器、循环、练习方式、音量通过顶部图标访问。底部播放条、独立标题条、视图标签行和设备状态栏从演奏页移除。
- 练习设置改为临时覆盖抽屉，设置开启时舞台宽度不变；详细工具由菜单打开。
- 桌面操作错误、前端未捕获异常、会话错误、启动失败和 Rust panic 写入同一 logs 文件夹。runtime.jsonl 达到约 4 MB 后轮换为 runtime.previous.jsonl；单条详情限长，相同前端错误在 30 秒内只记录一次。
- 常规会话问题显示一条紧凑提示，技术详情进入诊断入口，帮助菜单可以直接打开日志目录。启动无法建立窗口时保留单次原生失败提示，并指向同一日志目录。

正常配置日志路径：`%APPDATA%\com.ubik.neothesia\logs`（既有资料目录）或 `%APPDATA%\com.ubik.panthesia\logs`（新资料目录）；独立数据目录使用其下的 logs。

## 尚未完成，禁止写为已交付

1. Look at the Sky 移动后仍有五条旧索引。文件移动后的目录发现、内容身份关联和旧位置归并需要单独完成；本轮没有改写真实索引或用户 MIDI。
2. 歌曲、演奏版本、左右手标注的长期归属仍分散在内容身份设置和 MIDI 旁附属文件中。需要继续收束数据层。
3. 复杂长曲的完整谱面存在容量限制；本轮删除的示意谱图不能作为已解决谱面阅读的证据。
4. 低层设备库自身的标准错误输出和操作系统级崩溃不等同于已由应用诊断捕获；本轮覆盖上述明确的应用入口。

## 参考与边界

[Synthesia 演奏界面](https://www.synthesiagame.com/support/guide/firstSong) 将定位、暂停、BPM 与键盘缩放集中为演奏控制；[谱面显示](https://www.synthesiagame.com/support/guide/displaySheetMusic) 通过工具栏齿轮管理谱面与瀑布选项。采用分离选曲、设置和演奏的组织方式；评分及训练晋级继续留在独立实验分支。

## 有限验收

`work/ui-simplification/runtime/evidence.json`：选择三首歌不发起开头预览请求；右键查看可打开与关闭；练习设置关闭时无侧栏，打开时舞台宽度不变；演奏中可切换等待 / 连续播放，连续播放位置推进且音源有输出；重复界面异常只记录一次；800 像素窗口没有横向溢出。

实际截图：同目录的 library-final.png、context-final.png、practice-final.png、settings-final.png 与 narrow-final.png。所有操作使用独立资料与软件自带练习，未以用户 MIDI 进行回放验收。


## 追加指令：逐屏参照截图

本轮先前的两栏曲库方案已由用户否决，以实际截图布局为准：

| 页面 | 官方截图 | 实现位置 |
| --- | --- | --- |
| 选曲 | https://cdn.synthesia.app/images/guides/ef9771ef-fd34-4821-adaf-f70aa98b7b3d.png | SongBrowser：上方返回 / 当前歌曲 / 继续；路径 / 搜索；通栏列表；底部排序 |
| 歌曲设置 | https://cdn.synthesia.app/images/guides/097bd004-afd6-404c-90de-63a58bb2aa3e.png | SongSetupScreen：左侧观看与声部设置，右侧左 / 右 / 双手 |
| 演奏 | https://cdn.synthesia.app/images/guides/8b413a3f-4e96-4994-b70c-b8b778c513bc.png | PracticeTransport → PracticeTimeline → PracticeStage；键盘贴底 |
| 显示设置 | https://cdn.synthesia.app/images/guides/6c4d930b-be08-4170-8700-f77b25411ed2.png | 顶部齿轮弹出显示选项 |

已下载并实际查看原始截图，保存在 work/ui-simplification/references。使用 Panthesia 名称与现有资产，继续遵守用户明确的例外：删除上述分类、评分及八秒试听；速度直接按 BPM 显示。产品菜单按需打开，不常驻占据演奏区。整体演奏设置与声部编辑内部仍使用已有控件，本轮未复刻官方每个子窗口。


截图布局实际验收：`work/ui-simplification/runtime/synthesia-evidence.json`。1360×950 窗口中，控制条 y=0–58，时间线 y=58–100，舞台 y=100–950；组合视图的谱面位于瀑布上方。BPM 按钮由 100 调到 105，练习方式可实时切换，连续播放有位置推进和音频输出，返回歌曲设置会暂停播放。800 像素宽窗口的页面和顶部控制条均无横向溢出，未捕获前端异常为零。

对应成品截图：同目录的 synth-library-final.png、synth-setup-final.png、synth-playing-final.png、synth-score-final.png 与 synth-narrow-final.png。正式运行包登记在 `work/ui-simplification/package-evidence.json`。

正式包：`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`。Release 构建提交 a67ea54，29 文件内容一致，独立启动通过；界面、IPC、音频、制谱与 PDF 就绪。目录逐级进入及路径返回也已用独立自有练习文件检查，通过。上述界面和启动结果不能替代尚未完成的数据迁移结论。
