import { TaskActivity } from "./TaskActivity";
const labels = [
  "读取历史演奏",
  "读取已保存评语",
  "读取演奏记录详情",
  "读取演奏评语",
  "读取历史问题音符",
  "读取回放片段",
  "筛选练习历史",
] as const;
export function HistoryTaskActivity() {
  return <TaskActivity label={labels} cancelLabel="取消本次读取" />;
}
