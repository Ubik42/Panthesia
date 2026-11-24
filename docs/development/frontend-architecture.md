# 前端架构

版本：2026-11-23。界面规范见 [interface-design.md](interface-design.md)；本文规定代码怎样组织。参考前端技能的桌面软件约定（`frontend/references/electron-desktop.md`，按 Tauri 改写）。曲库管理（文件夹、标签、浏览）由 Keel 承担，Panthesia 不重复实现。

## 1. 目标

Panthesia 是一个打开一首歌就能练的桌面程序，界面只有四类：主界面（最近打开与搜索，含歌曲详情）、演奏舞台、自由演奏、设置。状态的真实来源是 Rust 引擎；前端负责显示、导航和用户偏好。架构据此分四层，依赖只能向下：

| 层 | 目录 | 职责 | 可以依赖 |
| --- | --- | --- | --- |
| 应用 | `src/app` | 入口、全局键盘、页面切换、对话框挂载 | 全部 |
| 页面 | `src/screens/<页面>` | 一个页面的布局与组合：`home`、`song`（详情与二级页）、`settings`、`freeplay` | features、stores、ui、engine |
| 领域 | `src/features/<领域>` | 领域逻辑与领域组件：乐谱、指法、练习、设备、导出 | stores、ui、engine |
| 状态 | `src/stores` | zustand 状态：路由、对话框、会话；偏好仍由 `interfaceSettingsStore` 持久化 | engine |
| 基础 | `src/ui`、`src/lib`、`src/engine` | 设计系统组件与 token；与界面无关的工具（快捷键、输入归属、诊断、草稿持久化、关闭准备）；引擎客户端与生成的协议类型 | 基础层内部 |

`src/ui/legacy` 存放待重写的旧共用组件（工具条菜单、主从布局、分页、草稿恢复）。它们的样式留在 components 层，使 features 中的旧覆写继续生效；重写为第 2 节的组件后删除。导航编排（打开曲目、页面跳转、练习工具入口）依赖引擎会话，属于应用层，放在 `src/app`。

规则：

- 页面之间不互相导入；跨页面的跳转只改路由状态。
- 组件从 store 读取自己需要的字段（选择器），不从一个总的 Context 解构几十个字段。
- 样式只用 `tokens.css` 的语义 token；每个 `ui` 组件一个 TSX 一个 CSS；页面样式与页面放在一起。不写硬编码颜色、`!important`、`cursor: pointer`。
- 桌面约定：界面框架文字不可选中（内容区可选）、细滚动条、页面切换不加动画、程序滚动不用 smooth、加载 200 ms 内不显示指示、空状态一个图标加一行说明、Esc 总有作用、输入框关闭拼写检查、Enter 提交前判断输入法组字。

## 2. 组件层（`src/ui`）

| 组件 | 用途 |
| --- | --- |
| `Button`、`IconButton` | 按钮；变体 `primary`、`ghost`；图标按钮有悬停底色 |
| `Segmented` | 2–5 个互斥选项 |
| `Field`（行） | 名称在左、控件在右；`.ui-form` 让普通表单标记得到同样外观 |
| `Dialog` | 唯一的模态对话框 |
| `Sheet` | 从右侧滑出的非全屏面板（歌曲详情） |
| `Panel` | 舞台工具条的弹出面板 |
| `PageHeader` | 次级页面的页头 |
| `Badge`、`Chip` | 资料标记、标签 |
| `Empty` | 空状态 |

不引入 Tailwind 与 shadcn：现有设计系统是 CSS 变量 + 级联层，引入第二套样式体系会让两种写法长期并存。组件 API 参照 shadcn 的组合方式（`Dialog` 必须有标题、选项组用 `Segmented`、状态用 `Badge`）。

## 3. 主界面

- 顶栏：品牌、搜索框（在曲目文件夹索引中搜歌名、艺术家、文件夹）、打开文件、自由演奏、设置。没有侧栏大按钮。
- 内容：最近打开的曲目卡片，默认两列（窄窗口一列）；搜索时换成搜索结果。卡片：标题、艺术家或文件夹、资料标记、时长与调、上次打开时间。
- 选中卡片：打开曲目，右侧滑出歌曲详情（取代独立的歌曲页，没有“更多”）：练习方式与开始、钢琴卷帘与事实、资料、图层、二级入口。关闭详情回到主界面。
- 曲目文件夹的位置与重新扫描属于全局设置，在设置页。

## 4. 现状对比（2026-11-23）

| 项 | 现状 | 目标 | 处理 |
| --- | --- | --- | --- |
| 应用状态 | `useAppModel` 返回约 120 个字段，放在一个 Context | 按领域的 zustand store；页面不读应用 Context | 路由、对话框已迁；页面改为 props 与 store；会话仍在 `useAppModel`（应用层组合根） |
| 路由 | `useWorkspaceNavigation` + `useProductScreens` | 一个路由 store | 已完成（`stores/route.ts`） |
| 主界面 | 左栏三个大按钮 + 按行列出最近打开 | 顶栏 + 双列卡片（第 3 节） | 重写 |
| 歌曲页 | 独立页面，有“更多”菜单 | 主界面上的详情面板，无“更多” | 改为 Sheet |
| 组件 | 只有 CSS 类（`ui-button` 等）与少量组件 | 第 2 节的组件 | 补齐并替换页面中的类 |
| 旧样式 | `style.css`、`dailyTheme.css`、`synthesiaLayout.css` 等仍在 | 全部删除 | 随各页面改写删除；旧对话框外壳统一由 `legacyDialog.css` 过渡 |
| 桌面约定 | 部分（系统字体、深色） | 第 1 节全部 | 全局样式补齐 |
