# Product

## 当前长期目标（2026-11-19）

推进架构解耦与 Synthesia 官方公开功能补齐，保留中文日常练习、原谱、转调量化、Pianoteq 与美化特效。范围和状态以 [官方功能对照](docs/development/synthesia-feature-matrix.md)、[现代化路线图](docs/development/modernization-roadmap.md) 与 [当前计划](docs/development/current-plan.md) 为准。此前批次交付保留各自范围，整体改造正在进行。

## 当前范围（2026-11-18）

本轮已按 [可用性修订方案](docs/development/usability-reset.md) 集中实施三批，统一交付状态以 [日常练琴版清单](docs/development/daily-delivery.md) 为准。核心页面为文件夹树曲库、独立演奏与设备声音设置，声音结果以实际端点回录为证。

此前实用反馈记录：旧版未达到日常可用标准，按 [日常可用标准与界面重整](docs/development/usability-reset.md) 修订实际发声、单一关闭流程、独立曲库与目录树、声音设置、BPM 和双刻度时间线。旧包保留用于复现；本轮结果以上方日常练琴版清单为准。

当前目标和逐项状态见 [工程计划](docs/development/current-plan.md)，实现边界见 [架构决策](docs/development/architecture-decisions.md)。日常练习版先完成现有流程、数据归属和对应交付；研讨提出的作品/演奏关系、乐谱往返、精选入门库与视觉增强分批推进。

视觉采用练习与演出两套目标。下文安静、清楚的视觉原则适用于练习预设；演出预设可采用更强的发光、拖尾和粒子，同时提供减少动画设置。特效读取音乐状态，评分与播放由引擎负责。

## Register

product

## Users

Panthesia is for pianists who practise local repertoire with a MIDI keyboard.
Beginners need immediate note, hand and fingering guidance. Advancing players
need credible timing, consistency, pedal and dynamics feedback without the
interface competing for attention. The primary context is a focused practice
session at the piano, often with Pianoteq or another high-quality instrument.

## Product Purpose

Help a pianist turn a MIDI or paired score into reliable, musical playing. The
product should shorten the loop from choosing a passage, through deliberate
practice and precise feedback, to retaining repertoire. Success means the
learner can resume the right material quickly, understand what to improve and
complete long sessions without playback, MIDI or state failures.

## Brand Personality

Calm, precise and encouraging. Panthesia should feel like a dependable music
stand and practice coach: technically capable, musically respectful and quiet
enough to disappear while the player concentrates.

## Anti-references

- Arcade-style reward systems that optimize time in the app instead of playing
  quality.
- Dense DAW or notation-editor chrome around a simple practice task.
- Decorative effects, saturated inactive controls or motion that competes with
  the score and keyboard.
- Opaque judgements that cannot explain the measured weakness behind advice.
- Cloud, account or social-feed patterns in front of a local-first workflow.

## Design Principles

1. Keep the music and the next physical action visually dominant.
2. Earn trust through deterministic feedback, explicit state and safe recovery.
3. Reveal depth progressively; routine practice must stay fast and uncluttered.
4. Preserve musical expression and user data across every transformation.
5. Prefer familiar, consistent controls over novelty in the practice flow.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Do not rely on colour alone for
hand, correctness or practice-state meaning. Support keyboard-only operation,
scalable text, high-contrast and colour-blind-safe palettes, clear focus states,
reduced motion and usable layouts at the supported minimum window size.
