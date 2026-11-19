import type { Snapshot, EngineSession, LoadedSong } from "./sessionTypes";
export const sameEngine = (left: Snapshot, right: Snapshot) =>
  left.stateOrder?.engineId === right.stateOrder?.engineId;
export const olderState = (next: Snapshot, current: Snapshot) =>
  !!next.stateOrder &&
  !!current.stateOrder &&
  sameEngine(next, current) &&
  next.stateOrder.sequence < current.stateOrder.sequence;
export const matchesSong = (
  state: Pick<Snapshot, "contentId" | "scoreRevision" | "annotationRevision">,
  song: LoadedSong | null,
) =>
  state.contentId === (song?.contentId ?? null) &&
  (!song ||
    ((state.scoreRevision === undefined ||
      state.scoreRevision === song.scoreRevision) &&
      (state.annotationRevision === undefined ||
        state.annotationRevision === (song.annotationRevision ?? 0))));
export function verifySession(session: EngineSession) {
  if (!matchesSong(session.state, session.song))
    throw new Error("曲目与播放状态不一致，请重新读取");
  if (
    session.song &&
    (session.song.engineId ?? null) !==
      (session.state.stateOrder?.engineId ?? null)
  )
    throw new Error("曲目与练习室连接不一致，请重新读取");
}
/** Only a paired session can introduce an engine identity. Polls can request a rebind. */
export class EngineIdentity {
  private engine: string | null = null;
  private retired = new Set<string>();
  isRetired(state: Snapshot) {
    const id = state.stateOrder?.engineId;
    return !!id && this.retired.has(id);
  }
  accepts(state: Snapshot) {
    const id = state.stateOrder?.engineId ?? null;
    return id === this.engine;
  }
  bind(state: Snapshot) {
    const id = state.stateOrder?.engineId ?? null;
    if (id && this.retired.has(id)) return false;
    if (this.engine && this.engine !== id) this.retired.add(this.engine);
    this.engine = id;
    return true;
  }
}
