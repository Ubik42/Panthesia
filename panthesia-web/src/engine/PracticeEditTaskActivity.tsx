import { TaskActivity } from "./TaskActivity";
const labels = [
  "保存指法与换指",
  "保存逐音分手",
  "保存拍号与小节",
  "保存练习编辑设置",
  "准备指法声音示范",
  "读取练习标注",
  "保存手跨度设置",
  "读取手跨度设置",
  "比较指法方案",
  "生成持音换指方案",
  "生成指法建议",
] as const;
export function PracticeEditTaskActivity({ contentId }: { contentId: string }) {
  return (
    <TaskActivity
      contentId={contentId}
      label={labels}
      cancelLabel="取消本次处理"
    />
  );
}
