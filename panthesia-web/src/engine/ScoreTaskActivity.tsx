import { TaskActivity } from "./TaskActivity";
const labels = ["保存谱面资料", "提交谱面资料", "读取原谱资料", "打开曲库谱面", "提交曲目与谱面"] as const;
export function ScoreTaskActivity() {
  return <TaskActivity label={labels} cancelLabel="取消本次处理" />;
}
