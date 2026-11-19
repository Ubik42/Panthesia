import { useMemo } from "react";
import { ReadCache } from "../../engine/readCache";
import { useCachedRead } from "../../engine/useCachedRead";
import { useHistoryRead } from "../../engine/useHistoryRead";
import type { PracticeCalendarData } from "./historyTypes";

export function usePracticeCalendarRead({
  from,
  to,
  contentId,
  enabled = true,
  engineId,
  cache: supplied,
}: {
  from: number;
  to: number;
  contentId?: string | null;
  enabled?: boolean;
  engineId?: string;
  cache?: ReadCache<PracticeCalendarData>;
}) {
  const own = useMemo(() => new ReadCache<PracticeCalendarData>(8), []);
  const reads = useHistoryRead(engineId);
  const read = useCachedRead({
    cache: supplied ?? own,
    key: JSON.stringify(["calendar", contentId ?? null, from, to]),
    scope: engineId,
    enabled,
    load: async (signal) => {
      const data = await reads.request(
        {
          type: "practiceCalendar",
          from,
          to,
          content_id: contentId ?? null,
        },
        signal,
      ).result;
      if (
        data.from !== from ||
        data.to !== to ||
        (contentId &&
          (data.contentId !== contentId ||
            data.intervals.some((entry) => entry.contentId !== contentId) ||
            data.saves?.some((entry) => entry.contentId !== contentId)))
      )
        throw new Error("日历资料与所选曲目或日期不一致，请重新读取");
      return data;
    },
  });
  return { ...read, data: read.current ? read.value : null };
}
