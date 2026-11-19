# Panthesia 独立项目运行包 · 2026-11-19

## 交付

- 独立仓库：<https://github.com/Ubik42/Panthesia>，GitHub API 返回 `fork=false`、`parent=null`，默认分支 `main`。
- 源码目录：`D:\Music\_tools\Panthesia`。
- 程序：`outputs/releases/Panthesia-20261119-independent/Panthesia.exe`，移动时保留整个运行包。
- 程序版本：0.1.0，Windows x64 Release。
- 程序源码提交：`af146d888ac246ff1be9e1cb2b54fd35adff83e0`。
- 构建编号：`0a03822249ee44458b864270d0580900`。
- 源码内容标识：`C8E2F224BF7E621A9CF1B384EF0D9E88F3C7A70EBF4C23B15E7484C407F3256B`。

## 本批完成

产品配置、窗口与网页标题、应用标识、模块与命令名称、图标、README、启动和发布脚本统一为 Panthesia。新 Git 使用独立根提交；原工作区与历史保留。旧启动入口转至 Panthesia，Music 工具索引和转谱链说明同步更新。

既有资料、显式目录设置、旧环境变量和文件格式继续兼容。代码来源和第三方许可由 NOTICE 与 LICENSE 记录。

## 交付检查

- 前端生产构建、桌面 Release 构建通过。
- 实际浏览器界面已查看：名称与图标正常，隔离曲库与谱面预览正常。
- 运行包 29 个文件通过完整性核对。
- 打包程序实际启动并通过前端、IPC、谱面 WASM、PDF、音频初始化和静音播放检查。
- 保存练习、重启恢复、再次重启恢复计划进度和个人指法检查通过。
- 检查使用独立资料目录与 WebView 缓存，并确认从运行包加载音色。
- 记录：`work/portable-brand-check/result.json`。本机检查通过；未作为另一台干净机器的验证结论。

## 继续开发

完整功能进度仍以功能矩阵和路线图为准。资料来源 / 个人覆盖模型及后台操作已保存；恢复默认值的前端、扩展模板及开场资料仍待完成。
