import type { ReactNode } from "react";
import { Dialog } from "../../ui/Dialog";
export function SongOptionsDialog({
  close,
  children,
}: {
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div className="product-song-options-dialog">
      <Dialog title="歌曲选项" close={close}>
        {children}
      </Dialog>
    </div>
  );
}
