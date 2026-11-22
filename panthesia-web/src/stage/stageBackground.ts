import { useSyncExternalStore } from "react";

/** The stage's background image: a picture the player chooses, kept in this browser profile
 * (downscaled JPEG), shown behind the waterfall. `backgroundOpacity` decides how much of it shows. */
const KEY = "panthesia-stage-background";
const MAX_EDGE = 2560;
const listeners = new Set<() => void>();
let current: string | null = read();

function read() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function publish(value: string | null) {
  current = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or blocked: the picture still shows until the program closes.
  }
  listeners.forEach((listener) => listener());
}

/** Read an image file, scale its longer edge to at most 2560 px and keep it. */
export async function chooseStageBackground(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  publish(canvas.toDataURL("image/jpeg", 0.86));
}
export const clearStageBackground = () => publish(null);

export function useStageBackground() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
