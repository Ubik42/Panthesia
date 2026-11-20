import {
  Archive,
  Activity,
  LifeBuoy,
  BookOpen,
  FileMusic,
  FolderOpen,
  Hand,
  History,
  KeyboardMusic,
  Layers,
  Library,
  ListMusic,
  Music2,
  PanelLeft,
  PanelRight,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { Shortcuts, ShortcutAction } from "../shortcuts";

export type CommandRequirement =
  "engine" | "idle" | "navigation" | "loaded" | "song" | "editable" | "score";
export type CommandGroup = "工作区" | "练习与编排" | "曲目与乐谱" | "应用设置";
interface CommandDefinition {
  id: string;
  label: string;
  description: string;
  group: CommandGroup;
  icon: LucideIcon;
  keywords: string;
  needs: readonly CommandRequirement[];
  shortcut?: ShortcutAction;
  featured?: boolean;
}
const definitions = [
  { id: "sessionRecovery", label: "恢复与问题", description: "查看连接、保存、录音、曲库与设备问题，继续处理原工作", group: "应用设置", icon: LifeBuoy, keywords: "失败 错误 恢复 连接 重试 没声音 键盘 保存 recovery errors retry huifu", needs: [] },
  {
    id: "workProgress",
    label: "查看工作进度",
    description: "继续导入、备份、谱面制作与导出工作",
    group: "应用设置",
    icon: Activity,
    keywords: "后台 任务 进度 恢复 继续 失败 导出 导入 work progress tasks jindu",
    needs: [],
  },
  {
    id: "library",
    label: "打开曲库",
    description: "搜索、整理曲目与乐谱资料",
    group: "工作区",
    icon: Library,
    keywords: "歌曲 文件夹 分类 收藏 midi library quku",
    needs: ["engine", "idle", "navigation"],
    shortcut: "libraryManager",
    featured: true,
  },
  {
    id: "practice",
    label: "返回当前练习",
    description: "回到键盘、谱面与演奏控制",
    group: "工作区",
    icon: Music2,
    keywords: "练琴 播放 piano practice lianxi",
    needs: ["engine", "idle", "navigation"],
    featured: true,
  },
  {
    id: "review",
    label: "打开练习回顾",
    description: "查看成绩、评语、回放与复习建议",
    group: "工作区",
    icon: History,
    keywords: "历史 记录 统计 评分 review history huigu",
    needs: ["engine", "idle", "navigation"],
    shortcut: "history",
    featured: true,
  },
  {
    id: "play",
    label: "播放或暂停",
    description: "继续当前练习，或暂停演奏",
    group: "练习与编排",
    icon: Play,
    keywords: "开始 继续 停止 play pause",
    needs: ["engine", "idle", "navigation", "song"],
    shortcut: "playPause",
    featured: true,
  },
  {
    id: "songHistory",
    label: "查看当前曲目的历史",
    description: "按曲目内容查看成绩、评语、日历与周趋势",
    group: "工作区",
    icon: History,
    keywords: "本曲 当前 歌曲 历史 记录 成绩 日历 统计 song history benqu",
    needs: ["engine", "idle", "navigation", "loaded"],
  },
  {
    id: "import",
    label: "导入曲目",
    description: "从 MIDI、MusicXML、MXL 或纸谱开始",
    group: "曲目与乐谱",
    icon: FolderOpen,
    keywords: "打开文件 导入 import midi xml pdf 图片 扫描 识谱 daoru quzi",
    needs: ["engine", "idle", "navigation"],
    featured: true,
  },
  {
    id: "exercise",
    label: "生成技术练习",
    description: "选择音阶、琶音等练习素材",
    group: "练习与编排",
    icon: Sparkles,
    keywords: "音阶 琶音 热身 基本功 generate",
    needs: ["engine", "idle", "navigation"],
  },
  {
    id: "routine",
    label: "编排练习计划",
    description: "安排日课、曲目与复习内容",
    group: "练习与编排",
    icon: ListMusic,
    keywords: "日课 计划 日程 每天 routine jihua rike",
    needs: ["engine", "idle", "navigation"],
    featured: true,
  },
  {
    id: "passages",
    label: "管理练习段落",
    description: "保存、选择与安排曲目选段",
    group: "练习与编排",
    icon: Target,
    keywords: "片段 分段 循环 passage loop",
    needs: ["engine", "idle", "navigation", "song", "editable"],
    shortcut: "passages",
  },
  {
    id: "ladder",
    label: "打开速度阶梯",
    description: "逐轮提高速度，保留练习进度",
    group: "练习与编排",
    icon: Layers,
    keywords: "速度 节奏 阶梯 tempo ladder",
    needs: ["engine", "idle", "navigation", "song", "editable"],
  },
  {
    id: "fingering",
    label: "查看与编辑指法",
    description: "生成指法建议、审阅并保存",
    group: "曲目与乐谱",
    icon: Hand,
    keywords: "手指 指法 建议 双手 fingering zhifa shouzhi",
    needs: ["engine", "idle", "navigation", "song", "editable"],
    featured: true,
  },
  {
    id: "hands",
    label: "分手与逐音播放",
    description: "分配左右手，设置弹奏、伴奏和忽略音符",
    group: "曲目与乐谱",
    icon: KeyboardMusic,
    keywords: "左手 右手 双手 分手 hands track",
    needs: ["engine", "idle", "navigation", "song", "editable"],
  },
  {
    id: "meter",
    label: "设置小节与拍号",
    description: "校正起拍与小节网格",
    group: "曲目与乐谱",
    icon: SlidersHorizontal,
    keywords: "节拍 拍号 弱起 小节 节奏 meter",
    needs: ["engine", "idle", "navigation", "song", "editable"],
  },
  {
    id: "scores",
    label: "管理乐谱与纸谱",
    description: "配对原谱、切换版本与整理附件",
    group: "曲目与乐谱",
    icon: FileMusic,
    keywords: "乐谱 五线谱 纸谱 musicxml mxl pdf score",
    needs: ["engine", "idle", "navigation", "loaded"],
  },
  {
    id: "metadata",
    label: "编辑当前曲目信息",
    description: "修改标题、作者、分类与备注",
    group: "曲目与乐谱",
    icon: BookOpen,
    keywords: "名称 作者 作曲家 标题 标签 metadata",
    needs: ["engine", "idle", "navigation", "loaded"],
  },
  {
    id: "keyboard",
    label: "切换到键盘视图",
    description: "显示音符下落与钢琴键盘",
    group: "工作区",
    icon: KeyboardMusic,
    keywords: "钢琴 瀑布 piano keyboard",
    needs: ["engine", "navigation"],
  },
  {
    id: "score",
    label: "切换到乐谱视图",
    description: "跟随演奏查看可播放乐谱",
    group: "工作区",
    icon: FileMusic,
    keywords: "五线谱 谱面 跟谱 notation",
    needs: ["engine", "navigation", "song", "score"],
  },
  {
    id: "libraryPanel",
    label: "选择歌曲",
    description: "暂停当前演奏并打开选曲页",
    group: "工作区",
    icon: PanelLeft,
    keywords: "选择 歌曲 曲库 文件夹",
    needs: ["engine", "navigation"],
    shortcut: "library",
  },
  {
    id: "inspector",
    label: "打开歌曲选项",
    description: "打开当前曲目的练习设置",
    group: "工作区",
    icon: PanelRight,
    keywords: "歌曲 设置 参数 版本",
    needs: ["engine", "navigation"],
    shortcut: "inspector",
  },
  {
    id: "devices",
    label: "设置键盘与声音",
    description: "连接 MIDI 键盘、音源和输出设备",
    group: "应用设置",
    icon: Settings2,
    keywords:
      "声音 没声音 设备 shebei shengyin midi 音源 音频 插件 vst3 pianoteq",
    needs: ["engine", "idle", "navigation"],
  },
  {
    id: "display",
    label: "显示与快捷键",
    description: "设置字号、视图、电脑键盘与快捷键",
    group: "应用设置",
    icon: SlidersHorizontal,
    keywords:
      "缩放 字体 太小 分辨率 快捷键 界面 display shortcuts xianshi kuaijiejian",
    needs: ["navigation"],
  },
  {
    id: "backup",
    label: "备份与恢复练习资料",
    description: "导出记录与设置，或从备份恢复",
    group: "应用设置",
    icon: Archive,
    keywords: "备份 恢复 导出 迁移 backup restore beifen huifu",
    needs: ["engine", "idle", "navigation"],
  },
  {
    id: "silence",
    label: "暂停并停止发声",
    description: "立即停止当前声音",
    group: "练习与编排",
    icon: VolumeX,
    keywords: "卡音 停音 停止 紧急 panic silence",
    needs: [],
    shortcut: "silence",
  },
] as const satisfies readonly CommandDefinition[];
export type ApplicationCommandId = (typeof definitions)[number]["id"];
export interface ApplicationCommand extends Omit<
  CommandDefinition,
  "id" | "shortcut"
> {
  id: ApplicationCommandId;
  shortcut: string | null;
  unavailable: string | null;
  run: (signal: AbortSignal) => void | boolean | Promise<void | boolean>;
}
export function applicationCommands(
  handlers: Record<ApplicationCommandId, ApplicationCommand["run"]>,
  unavailable: Record<CommandRequirement, string | null>,
  shortcuts: Shortcuts,
): ApplicationCommand[] {
  return definitions.filter(item => !["review", "songHistory", "routine", "ladder"].includes(item.id)).map(
    (item: CommandDefinition & { id: ApplicationCommandId }) => ({
      ...item,
      shortcut: item.shortcut ? shortcuts[item.shortcut] : null,
      unavailable:
        item.needs.map((need) => unavailable[need]).find(Boolean) ?? null,
      run: handlers[item.id],
    }),
  );
}
export function searchCommands(
  actions: ApplicationCommand[],
  query: string,
): ApplicationCommand[] {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return actions;
  return actions
    .map((action, index) => {
      const label = normalize(action.label),
        keywords = normalize(action.keywords),
        detail = normalize(action.description);
      let score = 0;
      for (const term of terms) {
        const value =
          label === term
            ? 100
            : label.startsWith(term)
              ? 60
              : label.includes(term)
                ? 40
                : keywords.includes(term)
                  ? 20
                  : detail.includes(term)
                    ? 5
                    : 0;
        if (!value) return { action, index, score: -1 };
        score += value;
      }
      return { action, index, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.action);
}
