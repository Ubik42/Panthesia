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
  "engine" | "idle" | "loaded" | "song" | "editable" | "score";
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
    label: "返回主页",
    description: "最近打开的乐曲、打开文件与设置",
    group: "工作区",
    icon: Library,
    keywords: "主页 最近 home zhuye",
    needs: ["engine", "idle"],
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
    needs: ["engine", "idle"],
    featured: true,
  },
  {
    id: "play",
    label: "播放或暂停",
    description: "继续当前练习，或暂停演奏",
    group: "练习与编排",
    icon: Play,
    keywords: "开始 继续 停止 play pause",
    needs: ["engine", "idle", "song"],
    shortcut: "playPause",
    featured: true,
  },
  {
    id: "import",
    label: "打开乐曲",
    description: "从原位置打开 MIDI、MusicXML 或歌曲清单",
    group: "曲目与乐谱",
    icon: FolderOpen,
    keywords: "打开文件 导入 import midi xml pdf 图片 扫描 识谱 daoru quzi",
    needs: ["engine", "idle"],
    featured: true,
  },
  {
    id: "exercise",
    label: "生成技术练习",
    description: "选择音阶、琶音等练习素材",
    group: "练习与编排",
    icon: Sparkles,
    keywords: "音阶 琶音 热身 基本功 generate",
    needs: ["engine", "idle"],
  },
  {
    id: "passages",
    label: "管理练习段落",
    description: "保存、选择与安排曲目选段",
    group: "练习与编排",
    icon: Target,
    keywords: "片段 分段 循环 passage loop",
    needs: ["engine", "idle", "song", "editable"],
    shortcut: "passages",
  },
  {
    id: "fingering",
    label: "查看与编辑指法",
    description: "生成指法建议、审阅并保存",
    group: "曲目与乐谱",
    icon: Hand,
    keywords: "手指 指法 建议 双手 fingering zhifa shouzhi",
    needs: ["engine", "idle", "song", "editable"],
    featured: true,
  },
  {
    id: "hands",
    label: "分手与逐音播放",
    description: "分配左右手，设置弹奏、伴奏和忽略音符",
    group: "曲目与乐谱",
    icon: KeyboardMusic,
    keywords: "左手 右手 双手 分手 hands track",
    needs: ["engine", "idle", "song", "editable"],
  },
  {
    id: "meter",
    label: "设置小节与拍号",
    description: "校正起拍与小节网格",
    group: "曲目与乐谱",
    icon: SlidersHorizontal,
    keywords: "节拍 拍号 弱起 小节 节奏 meter",
    needs: ["engine", "idle", "song", "editable"],
  },
  {
    id: "scores",
    label: "管理乐谱与纸谱",
    description: "配对原谱、切换版本与整理附件",
    group: "曲目与乐谱",
    icon: FileMusic,
    keywords: "乐谱 五线谱 纸谱 musicxml mxl pdf score",
    needs: ["engine", "idle", "loaded"],
  },
  {
    id: "metadata",
    label: "编辑当前曲目信息",
    description: "修改标题、作者、分类与备注",
    group: "曲目与乐谱",
    icon: BookOpen,
    keywords: "名称 作者 作曲家 标题 标签 metadata",
    needs: ["engine", "idle", "loaded"],
  },
  {
    id: "keyboard",
    label: "切换到键盘视图",
    description: "显示音符下落与钢琴键盘",
    group: "工作区",
    icon: KeyboardMusic,
    keywords: "钢琴 瀑布 piano keyboard",
    needs: ["engine"],
  },
  {
    id: "score",
    label: "切换到乐谱视图",
    description: "跟随演奏查看可播放乐谱",
    group: "工作区",
    icon: FileMusic,
    keywords: "五线谱 谱面 跟谱 notation",
    needs: ["engine", "song", "score"],
  },
  {
    id: "libraryPanel",
    label: "打开其他乐曲",
    description: "暂停当前演奏并选择另一个文件",
    group: "工作区",
    icon: PanelLeft,
    keywords: "选择 歌曲 曲库 文件夹",
    needs: ["engine"],
    shortcut: "library",
  },
  {
    id: "inspector",
    label: "打开歌曲选项",
    description: "打开当前曲目的练习设置",
    group: "工作区",
    icon: PanelRight,
    keywords: "歌曲 设置 参数 版本",
    needs: ["engine"],
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
    needs: ["engine", "idle"],
  },
  {
    id: "display",
    label: "显示与快捷键",
    description: "设置字号、视图、电脑键盘与快捷键",
    group: "应用设置",
    icon: SlidersHorizontal,
    keywords:
      "缩放 字体 太小 分辨率 快捷键 界面 display shortcuts xianshi kuaijiejian",
    needs: [],
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
  return definitions.map(
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
