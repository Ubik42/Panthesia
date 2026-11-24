import { route, screenOf, useRoute } from "../../stores/route";
export type { SettingsSection } from "../../stores/route";

/** The route store seen as one object, for components that take it as a prop. New code reads
 * `useRoute` / `route` from stores/route directly. */
export function useProductScreens() {
  const screen = useRoute(screenOf);
  const splitTrack = useRoute((s) => s.splitTrack);
  const settingsSection = useRoute((s) => s.settingsSection);
  return {
    screen,
    splitTrack,
    settingsSection,
    setSettingsSection: route.setSettingsSection,
    home: route.home,
    settings: route.settings,
    leaveSettings: route.leaveSettings,
    browse: route.resume,
    resume: route.resume,
    show: route.show,
    split: route.split,
    setSongSetup: route.setSongSetup,
  };
}
