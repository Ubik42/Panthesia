import { useApp } from "./AppContext";
import { AppDialogs } from "./AppDialogs";
import { AppMenu } from "./AppMenu";
import { AppNotices } from "./AppNotices";
import { PracticeWorkspace } from "./PracticeWorkspace";
import { ProductScreens } from "./ProductScreens";

/** The application window: menu, notices, product screens, practice workspace and dialogs. */
export function AppShell() {
  const { workspace, productScreens, display, connected, startupReady } =
    useApp();
  return (
    <div
      data-skin={display.skin}
      className={`workbench daily-workbench synthesia-layout page-${workspace} ${display.practiceFocus ? "practice-focus" : ""}`}
      data-product-screen={productScreens.screen}
      data-engine-connected={connected}
      data-engine-ready={startupReady}
    >
      <AppMenu />
      <AppNotices />
      <ProductScreens />
      <PracticeWorkspace />
      <AppDialogs />
    </div>
  );
}
