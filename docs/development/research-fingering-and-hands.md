# 技术调研：钢琴指法生成与演奏手部动画（2026-11-24）

起因：指法与虚拟双手的效果仍不够自然，用户认为这类工作“可参考的资料很少”，要求查清研究现状与成熟的商业做法，形成可执行的改进路线。调研由两路网络检索完成（论文、开源仓库、产品页面），每条结论附来源。与 [research-2026-11.md](research-2026-11.md) 第 8–10 节互补：那里记的是已读过代码的三个仓库。

## 一、总体判断

- **指法生成**：领域确实小，而且近几年进展很少。标准数据集 PIG 只有 150 首，人与人之间的一致率只有 71.4%，最好的系统停在 65–67%，2019 年以后各方法只差 1–2 个百分点。与 Panthesia 同类的“Parncutt 规则 + 精确二阶 Viterbi”学过权重后达到 65.4%，与最好的 HMM 持平。下一步最划算的是建立本地评测并学习现有代价的权重，而不是换神经网络。商业产品（Simply Piano、Flowkey 等）没有公开指法算法，合理推测是编配人员人工标注。
- **演奏手部动画**：没有一款公开技术细节的“实时、由 MIDI 生成手指动画”的成熟商业产品。影视与游戏里效果好的作品，都是动作捕捉加动画师手调；研究界近两年改用扩散模型或物理仿真，依赖 MANO 手模型与非商业数据集，不能进入 Panthesia。真正可直接复用的程序化方案是 Zhu 等人 2013 年的完整流程，加上几条生物力学规律。

## 二、指法生成

### 2.1 方法与成绩

PIG 测试集 30 首，精度为一般匹配率 M_gen；人与人一致率 71.4%。

| 方法 | 年份 | 思路 | PIG 精度 | 代码 / 许可 | 来源 |
|---|---|---|---|---|---|
| Nakamura 1–3 阶 HMM、Chord HMM | 2019/2020 | 统计学习 + Viterbi | 61.7 / 64.3 / 64.5；Chord 61.2 | 源码包，第三方称仅非商业 | [论文](https://ar5iv.labs.arxiv.org/html/1904.10237) |
| Balliauw / Herremans | 2015/2017 | 生物力学规则 + 禁忌搜索、VNS（面向复调） | 14 首子集 56.7 | 未开源 | [Springer](https://link.springer.com/chapter/10.1007%2F978-3-319-20603-5_15) |
| Zhao 等 BiLSTM | 2022 | 以音高差为单位 + 先验规则；提出不合理指法率 IFR | 比 3 阶 HMM 高 4.06 个百分点 | 未见代码 | [EURASIP](https://asmp-eurasipjournals.springeropen.com/articles/10.1186/s13636-022-00237-8) |
| Ramoneda ArLSTM / ArGNN + ThumbSet | 2022 | 自回归网络 + 束搜索，2523 首部分标注预训练 | 65.3（M_high 72.6，M_soft 86.8） | 代码 MIT；ThumbSet 需申请、非营利 | [GitHub](https://github.com/PRamoneda/Automatic-Piano-Fingering) |
| Gao 等 MBRL | 2023 | 基于模型的强化学习 | 低于统计方法，IFR 有改善 | 未见代码 | [MDPI](https://mdpi.com/2076-3417/13/20/11321) |
| At Your Fingertips（Moryossef） | 2023 | 从 90 个视频自动提取 15 万音符指法预训练 | **66.8**（最高） | 无代码 | [arXiv](https://arxiv.org/abs/2303.03745) |
| Chirality | 2026 | Parncutt 规则 + 精确 Viterbi，在 PIG 上学权重 | 65.4（均匀权重 64.9；同规则用 Dijkstra/VNS 约 59–60） | AGPL-3.0 | [GitHub](https://github.com/vibetuned/chirality) |
| Penner & Hindle | 2026 | 8 种统计模型联合推断手别与指法（转录音符） | 手别 90.8；联合 56.6 | Zenodo 复现包 | [arXiv](https://arxiv.org/html/2609.28787v1) |
| RoboPianist / RP1M | 2023–25 | 机器手强化学习；RP1M 用最优传输逐时刻分配手指 | 不评测人类指法 | Apache-2.0 / CC BY | [RP1M](https://arxiv.org/html/2408.11048v2) |
| PiAnnotate | 2026 | 为 FürElise 补专家指法：几何规则自动标注 + 人工校对 | 规则与人工一致 91.8% | 工具 MIT，标签未发布 | [arXiv](https://arxiv.org/html/2605.23982v1) |
| PianoVAM、SKY-Piano | 2025–26 | 大规模视频 / 动捕，半自动指法伪标签 | — | 指法数据未发布或分模态授权 | [PianoVAM](https://arxiv.org/abs/2509.08800) |

商业与插件：Synthesia 的指法提示为人工输入；MuseScore 有社区插件（Piano Fingering Studio、Smart Piano Fingering，后者只适合简单片段）；Dorico 未见自动指法；Simply Piano、Flowkey、Skoove、Piano Marvel 无公开资料。未找到用大语言模型做指法并在 PIG 上评测的论文。

### 2.2 为什么资料显得少

1. 数据少且许可严：PIG 150 首、仅限非营利学术；ThumbSet 需申请；FürElise 为 NC；PianoVAM 指法未发布。
2. 上限低：人与人只有 71.4%，最好系统 65–67%，余量约 5 个百分点。
3. 评测难：一个音常有多个合理指法，需要 M_gen / M_high / M_soft / M_rec 多种匹配率，加上位置变化率、IFR；各论文切分不一致。
4. 复调与手别：标注按乐谱分手；从转录音符出发要先分手，联合精度降到约 57%。
5. 新数据流向机器人与动作生成，这些工作不评测或不追求人类指法。

### 2.3 Panthesia 的改进路线

1. **在 PIG 上学习现有代价的权重**（优先）：用路径差学习（结构化感知机）让人类指法成为 Viterbi 最优；现有的成对、三元、和弦候选代价直接作为特征；按论文在 Rust 中自行实现，不复制 AGPL 代码。注意 Chirality 学出的结果是“拇指穿越放大约 4 倍、弱指惩罚接近关闭”——前者与本轮的穿指重罚一致；后者与用户“偏好前三指”的要求相反，学习时需要把这条偏好作为固定约束，而不是交给数据决定。
2. **本地评测**：实现四种匹配率、位置变化率与 IFR；先复现 HMM 的 64.4 作对齐；PIG 30 首测试曲作基线，另选几首流行曲人工标注作私有测试集。
3. **许可边界**：PIG 只许非营利学术使用，GPL 不能附加非商业限制，所以 PIG 只在本地 `work/` 下训练与评测；发布的默认权重根据学习结论人工设定，或向 Nakamura 申请许可。ThumbSet、FürElise 同理。
4. **部分约束重解**：用户改动某个指法后把它固定，前后重跑 Viterbi（Ramoneda 处理部分标注的思路），代价很低。
5. **和弦与跳进**：用匈牙利算法按手的当前位置求“手指 → 琴键”最小几何代价，用来剪枝和排序和弦候选，再交给 Viterbi。
6. **手别**：转录 MIDI 的误差可能主要来自分手；以 Penner & Hindle 的 90.8% 作基线单独评测分手。
7. **暂缓神经网络**：只高 1–2 个百分点，且依赖受限数据与推理运行时；等宽松许可的大规模指法数据公开后再评估。

## 三、演奏手部动画

### 3.1 商业与生产做法

| 名称 | 类型 | 做法 | 对我们的意义 | 来源 |
|---|---|---|---|---|
| 影视动画（Het Nieuwe Kader） | 制作 | MANUS 手套 + OptiTrack 光学动捕，少量修正 | 成熟做法就是动捕 | [OptiTrack](https://optitrack.com/news/animate-realistic-piano-performance-with-optitrack--manus) |
| The Last of Us Part II（吉他） | 游戏 | 演员动捕 + 动画师手调指位 | 同上 | [PlayStation Blog](https://blog.playstation.com/?p=357243) |
| PianoVision（Meta Quest） | 商业应用 | 手部追踪 + MIDI 键盘，提供指法提示 | 不做虚拟手示范 | [UploadVR](https://uploadvr.com/pianovision-impressions-quest-2/) |
| Synthesia 及“带手视频” | 商业应用 | 只有下落音符；带手的视频是另拍真手再合成 | 无程序化手 | [Instructables](https://www.instructables.com/How-to-Make-Beautiful-Synthesia-Piano-Videos) |
| Piano Motion Studio（Blender） | 商业插件 | 自称本地推理生成；文档承认演示用的是源动画 | 宣传与实际不符 | [Superhive](https://superhivemarket.com/products/piano-motion-studio-for-blender) |
| Pianimator、MIDI Piano Motion Tools | 商业插件 | 只驱动琴键、琴槌、踏板 | 不含手 | [Pianimator](https://superhivemarket.com/products/pianimator/docs) |
| Flowkey、Simply Piano、Pianist VR、Pianity | 商业应用 | 未找到虚拟手的技术资料（Flowkey 为真人手视频） | — | — |

### 3.2 研究工作

| 名称 | 年份 | 方法 | 可借鉴 | 许可 / 可用性 | 来源 |
|---|---|---|---|---|---|
| Zhu, Ramakrishnan, Hamann, Neff | 2013 | 和弦指法格状图 + Dijkstra；手腕按指尖加权放置；IK/FK 混合；整曲 SQP 平滑手腕；非弹奏手指按后续和弦预就位；手指联动 Dep(i) | 最完整的程序化流程，可直接实现 | 论文 | [PDF](https://www.cs.ucdavis.edu/~neff/papers/cav1477.pdf) |
| FürElise | 2024 | 15 位钢琴家 10 小时动捕（MANO）→ 扩散 + 检索 + 物理策略 | 动作统计、用 MIDI 修正 IK 的思路 | 数据 CC BY-NC，基于 MANO；代码未发布 | [arXiv](https://arxiv.org/abs/2410.05791) |
| PianoMotion10M | 2025 | 116 小时俯视视频；音频 → 手位 → 手势 | 离线对照 | 代码 Apache-2.0，数据 CC BY-NC | [项目页](https://agnjason.github.io/PianoMotion-page) |
| S2C | 2025 | 左右手双流扩散 + 协同注意力 | 双手协同 | HF 有代码 | [arXiv](https://arxiv.org/abs/2504.09885) |
| Tipiano | 2026 | 指尖先验 → 轨迹细化 → 手腕估计 → STGCN 姿态；专家指出剩余差距在“预备动作” | 分层顺序：指尖由指法决定，自由度在手腕与中间关节 | 未见代码 | [arXiv](https://arxiv.org/abs/2604.09692) |
| RoboPianist / RP1M | 2023–24 | 机器手强化学习；RP1M 把指法作为最优传输求解 | 和弦指法求解思路 | Apache-2.0 | [GitHub](https://github.com/google-research/robopianist) |
| Handrix | 2003 | 多指同时伸向目标 + 动捕得到的联动 | 非弹奏手指联动 | 论文 | [项目页](https://www.dgp.toronto.edu/~gelkoura/handrix/paper.html) |
| Rijpkema & Girard | 1991 | DIP ≈ 2/3 PIP 耦合 | 已在用 | 论文 | [PDF](https://www.ece.uvic.ca/~bctill/papers/mocap/Rijpkema_Girard_1991.pdf) |

### 3.3 生物力学数据

- Goebl & Palmer 2013（每秒 7–16 音）：关节活动幅度 MCP ≈ 34°、DIP ≈ 30°、PIP ≈ 24°，手腕屈伸 ≈ 13°、旋转 ≈ 9°；平均手腕略伸展（≈ −11°）；指尖运动主要来自 MCP；速度越快，抬指越高。[PLoS ONE](https://pmc.ncbi.nlm.nih.gov/articles/PMC3536780/)
- Furuya：熟练者更多用手腕与前臂减轻手指负担；弹奏手指对邻指的带动很小。[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3107480)
- 手部协同：前两个主成分解释超过 80% 的姿态方差。[Santello 2002](https://www.ece.uvic.ca/~bctill/papers/mocap/Santello_2002.pdf)

### 3.4 Panthesia 可直接采用的做法

1. **按层级求解，指尖优先**：指尖由指法与键位决定；手腕按指尖加权放置（拇指、小指权重大），偏航按各指方向加权（中指最大）；张开越大手腕越低越靠前；最后做手指 IK。现在的加权 Procrustes 改为带这些先验的公式。
2. **放松基础姿态加增量**：MCP 20–35°、PIP 25–45°、DIP = 2/3 PIP、手腕伸展约 10° 为基准，IK 只求偏移并惩罚偏移量；拇指单独限制，禁止反折（本轮已做第一步）。
3. **下键主要靠 MCP 与手腕**：PIP、DIP 保持弯曲，接触点在指腹，避免指节竖直与上翘。
4. **时序**：和弦之间手腕走弧线，在中点最高，抬高量与时值、音量成正比，与距离成反比；非弹奏手指按后续 1–4 个音提前就位；下落用最小急动度曲线或临界阻尼弹簧；抬指高度随速度增加；预备时长按音间隔比例推导。
5. **手指联动**：非弹奏手指高度 = 最大高度 × Dep(i)，取相邻手指的较大值。
6. **防碰撞**：相邻指节做胶囊体距离检测；需要跨越时先平移再转动手腕，不只靠手指避让。

### 3.5 许可约束

- **MANO**：仅限非商业科研，禁止训练网络、禁止再分发；FürElise、PianoMotion10M 等依赖它的网格或参数都不能进入 Panthesia，只能引用论文中的统计结论。
- **LibHand** 手模型为 CC BY 3.0，可作备选。
- **WebXR generic-hand**：GitHub 许可接口返回 NOASSERTION，需人工核对仓库 LICENSE（此前记录为 W3C Software and Document License）。
- **pygame-piano-animator（Hand-thesia）**：未声明许可，只能参考思路。

## 四、执行顺序建议

1. 手部动画：按 3.4 的 1–3 条重写手腕放置与手指求解（指尖优先、放松基础姿态加增量、MCP 主导），这是“手型不自然”的根本解决；随后做 3.4 的时序与联动。
2. 指法：搭本地评测（2.3 第 2 条），在 `work/` 下用 PIG 学权重（第 1 条），再决定默认权重；同时补“改一个音后重解”。
3. 两者共用一套逐帧度量（交叉、反折、上翘、俯视变短、指尖速度），每次改动前后对比，写入进度记录。

## 五、补充参考：Gemini 关于 AI 接入的建议（2026-11-24 用户提供，未逐条核实）

- PianoMotion10M 及衍生（S2C、PianoFlow）：代码 Apache-2.0，数据 CC BY-NC，输出绑定 MANO（禁止商用、禁止再分发）；原版为音频驱动、扩散多步去噪，实时性差；据称 2026 年的 PianoFlow 用 Flow Matching 提速约 9 倍、可流式实时。共同问题：不以指法为硬约束，指尖会偏半个键，必须再加一层 IK 把指尖吸到目标键上。
- FürElise：数据已放出（MANO），生成与物理控制代码未发布，复现成本高，只适合借鉴“先生成参考轨迹再跟踪”的思路。
- RoboPianist：Apache-2.0，MuJoCo + Shadow Hand，无 MANO 问题；但一首曲子训练一个专家策略，新曲子不能即时演奏，多任务策略在新曲上明显变差。
- PianoMime（CoRL 2024）：通用策略，据称新曲按键 F1 约 0.57，作为“按指法 MIDI 精确演奏”不可用。
- 建议路线：**程序化 IK 为主、数据先验做润色**。IK 每帧把指法对应的手指钉到琴键上，保证不错键；先做手腕 / 手掌轨迹规划（按前后半秒的键分布求舒适重心与旋前旋后，三次样条过渡），未击键手指保持“握鸡蛋”的放松弧度；如需更有“钢琴家气质”，可把学习模型只用作手腕起伏、手掌倾角的风格残差，手指按键仍由指法 + IK 决定。手模用无版权风险的网格。

## 六、Panthesia 的技术路线（2026-11-24 确定）

结论：**程序化为主，数据先验只做润色，不接入生成式模型**。理由：按指法精确落键是练琴软件的底线，现有学习模型都做不到；可用的数据与手模多受 MANO / NC 许可限制；程序化流程（Zhu 2013）已有完整、可解释的做法。

分阶段：

1. **指法**：手指偏好 1=2 > 3 > 4 > 5（已做）；和弦按放松跨度与均匀分布评估（已做）；建立本地评测（四种匹配率 + 不合理指法率）；在 `work/` 下用 PIG 学权重，偏好与穿指重罚作为固定约束；改动单个指法后局部重解。
2. **手的解算（分层，指尖优先）**：指尖由指法决定 → 手腕按指尖加权放置（拇指、小指权重大）与转动（中指权重大）→ 手指相对“放松基础姿态”求小增量，按键主要靠 MCP 与手腕 → 拇指单独限制。
3. **时序**：未击键手指按后续 1–4 个音提前就位并悬在键上；和弦之间手腕走弧线（中点最高，抬高量随移动速度）；下落用临界阻尼或最小急动度；抬指随速度增加。
4. **润色（可选，后期）**：若程序化结果仍缺“气质”，再评估把学习模型只用于手腕起伏与手掌倾角的残差，不影响落键。
5. **度量**：每次改动用同一套逐帧度量（交叉、拇指反折、手指上翘、俯视变短、指尖速度、落键覆盖）前后对比。

## 七、手的生理数据（2026-11-24 补充，用于关节约束）

数值均为文献值，已在 `virtualHandPose.ts` 中注明出处；三个钢琴动作数据集（FürElise、PianoMotion10M、PianoVAM）均为 CC BY-NC（PianoMotion10M 另加 ND），不进入发布；可用的宽松许可资源为 MyoHand（Apache-2.0，关节限位）与 KIN-MUS UJI（CC BY 4.0，日常活动的手套关节角，可做姿态先验）。

- 拇指主动活动度（Barakat 2013，n=100）：CMC 掌侧外展 61 ± 4°、桡侧外展 63 ± 4°；MCP 屈 60 ± 6°、伸 8 ± 4°；IP 屈 88 ± 2°、伸 12 ± 9°（个体差异最大）。CMC 的轴向旋转与屈伸、外展耦合（Crisco 2015），不是独立自由度。
- 手指：MCP 主动伸 22–26°；PIP 屈 90–105°、DIP 屈 65–90°；DIP 对 PIP 的联动斜率示指 0.77、中指与环指 0.75、小指 0.57（Mentzel 2011，Roda-Sales 2022 汇总）。
- 自然姿态（Ingram 2008，日常佩戴数据手套）：拇指 CMC 32 ± 11°、MCP 4 ± 8°、IP 5 ± 12°；手指 MCP 19–34°、PIP 34–40°、DIP 12–20°；约一半时间各关节转速低于 10°/s。
- 弹琴：MCP 对指尖竖直运动贡献最大，击键时 PIP/DIP 略向反方向（Goebl & Palmer 2013，Tominaga 2016）；拇指击键主要靠 CMC 旋转与 MCP，IP 较稳定，前一手指不同时 CMC 内外旋方向不同（Winges & Furuya 2014）；职业钢琴家相邻手指的连带运动很小（Furuya 2011）。
- 手指独立性（Häger-Ross & Schieber 2000）：拇指与示指最独立，环指最差，环指运动时小指约 30% 同向。

落地：拇指关节空间 IK 的限位与舒适姿态（MCP 伸 ≤ 6°、IP 伸 ≤ 4°、CMC 张开 22–80°、下倾 0–45°；静息 MCP 8°、IP 10°；IP 舒适范围最窄、CMC 最宽）；手指 DIP 联动按上列斜率。相邻手指的连带运动已按上列独立性数据的一半实现。KIN-MUS UJI（Zenodo 3337890，单个 `KIN_MUS_UJI.mat`，86.7 MB，CC BY 4.0，22 人 26 项日常活动，18 个手套关节角）是日常活动而非弹琴，作为弹琴姿态先验的价值有限，下载与否待定。
