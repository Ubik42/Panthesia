import type { ReactNode } from "react";
import { Dialog } from "../../ui/Dialog";

/** The song's practice version (transposition and quantization). */
export function SongOptionsDialog({ close, children }: { close: () => void; children: ReactNode }) {
  return (
    <Dialog title="转调与量化" close={close}>
      {children}
    </Dialog>
  );
}
