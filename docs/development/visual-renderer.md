# 实时特效：MIDIVisualizer 接入

用户于 2026-11-20 授权推进。前端继续采用 Synthesia 的页面、工具栏和设置层级；特效在既有“显示/外观”入口控制。

## 本批实现

- Rust 负责输入、播放时钟和音源。Snapshot 的 pressedKeys 保存当前按键力度及击键序号；松键、停止和 panic 清除，前端按新序号区分同音重弹。曲目自动播放使用当前 NoteTimeline 的音符力度与源身份。CC64 读取既有 pedal 状态。
- PianoEffects 只管理有界的瞬态视觉状态。MidiVisualizerGpu 在透明 WebGL2 canvas 中将光晕、光束、涟漪和星屑合为一次实例绘制；与现有瀑布/琴键 canvas 共用同一帧调度、几何和时钟，无新增动画时钟或原生窗口。
- 显示表面最多 4,000,000 像素，DPR 最多 2；每批最多 2,048 个图元，演出粒子最多 1,536，普通/回退最多 420。粒子运动仍由前端有界循环更新；现有瀑布和琴键继续 Canvas2D，本批未将全部视觉改成 GPU。
- 暂停、定位、循环回跳、切曲/模式、失焦和关闭特效清理旧视觉状态。减少动画时保留短暂光晕。WebGL2 不可用或上下文丢失时由同一状态切回 Canvas2D，恢复后重新建立 GPU 资源。退出销毁缓冲、着色器程序和监听器。
- 外观预览与演奏页使用同一光效实现。效果不参与等待判定、评分或音源控制。

## 上游与来源

参考 [kosua20/MIDIVisualizer](https://github.com/kosua20/MIDIVisualizer)，固定提交 `1c942137679bc1846fd278d1e57ff91c71e94b72`。`flashes.frag` 的内外半径 smoothstep 光晕、预乘透明度，以及 `particles.vert` 的 1−t² 衰减已改编至 midiVisualizerShaders.ts / PianoEffects。MIT 原许可保存在 third-party/MIDIVisualizer/LICENSE，NOTICE 已登记。上游 C++ 窗口、OpenGL 渲染器、贴图和音频行为均未接入产品。

直接 WebGL2 实例绘制复用现有画布表面，当前没有引入 PixiJS 或 Three.js。后续需要复杂二维场景或三维相机时再由同一只读视觉接口接入；当前任务不建立并行窗口或第二套播放内核。

## 后续范围

1. 实时效果完成条件：真实桌面中自由演奏与自动播放均能触发；力度、重弹、减少动画、关闭/返回和上下文恢复有效；按实际记录说明性能。
2. 离线视频导出：复用帧输入与虚拟时间；探测 WebCodecs 与目标编码配置，选择容器封装；不支持时由后台 FFmpeg 编码。导出音轨必须来自实际音源渲染并与视频共用采样时间，不能把静音画面作为完成。
3. 4K/60fps、三维透视、倒影和全瀑布 GPU 化尚未实现。不得承诺 120/144fps 或全平台编码支持。新显示能力继续放二级设置。

当前正式 Release 尚未更新；本批实际运行结果见 evidence/midivisualizer-2026-11-20.json。
