import { dialogs, useDialogs } from "../stores/dialogs";

/** The dialog store with its setters, for the application model. Components read
 * `useDialogs` from stores/dialogs directly. */
export function useAppDialogs() {
  return { ...useDialogs(), ...dialogs };
}
