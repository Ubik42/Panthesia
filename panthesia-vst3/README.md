# VST3 设备适配

此 crate 保存 VST3 插件发现、设备连接、音频处理、编辑器和插件状态文件的实现。新版引擎与旧原生应用共同调用。

依赖方向为：应用 → `panthesia-vst3` → MIDI 类型和公共资料工具。音乐语义默认构建不加载此适配器，`panthesia-core` 不依赖 CPAL 或 VST3。

本次从 `panthesia-core/src/vst3_backend.rs` 移出已有实现，插件行为与状态文件位置保持兼容。
