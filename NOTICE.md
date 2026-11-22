# 来源与许可归属

Panthesia 是 Ubik42 独立维护的钢琴练习、乐谱与音乐工作台。产品、仓库与发布由本项目维护。

本项目的部分初始代码来源于 PolyMeilex 及其贡献者维护的 [Neothesia](https://github.com/PolyMeilex/Neothesia)。这些代码原有的版权与 GPLv3 许可继续保留。完整许可证见 [LICENSE](LICENSE)。新仓库的独立身份不改变既有代码的许可归属。

第三方库、音源、曲目和模型分别保留各自的许可。内置练习、曲库来源清单、SoundFont 与渲染器的说明随对应资源保存。外部 DuET 模型采用独立的 CC BY-NC 4.0 许可，模型不随本软件运行包分发。

实时光效中的光晕与粒子衰减公式改编自 Simon Rodriguez 的 [MIDIVisualizer](https://github.com/kosua20/MIDIVisualizer)，MIT 许可。固定参考提交为 `1c942137679bc1846fd278d1e57ff91c71e94b72`；原许可见 [third-party/MIDIVisualizer/LICENSE](third-party/MIDIVisualizer/LICENSE)。WebGL ES 图层、实例批次和产品接入由 Panthesia 实现；未捆绑上游程序及贴图。

虚拟双手的俯视卡通画面与程序动画参考 [V9011N/pygame-piano-animator](https://github.com/V9011N/pygame-piano-animator)，固定参考提交 `ae8ae035c76ef9591926892cdbf603371be73499`。该仓库当前未声明项目许可证；产品中的 Canvas 皮肤、动作计划和逆运动学由 Panthesia 独立编写，未复制其源码、权重或资源。

伴奏音轨变速保持音高使用 Geraint Luff / Signalsmith Audio 的 [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) 1.1.1 及其 dsp 库，MIT 许可。源码原样放在 [panthesia-audio/vendor/signalsmith-stretch](panthesia-audio/vendor/signalsmith-stretch)，许可文本随附；Panthesia 只增加了一层 C 接口（`panthesia-audio/src/stretch.cpp`）。音频解码使用 [Symphonia](https://github.com/pdeljanov/Symphonia)（MPL-2.0），作为 Cargo 依赖使用，未修改。
