import { createContext, useContext } from "react";
import type { AppModel } from "./useAppModel";

export const AppContext = createContext<AppModel | null>(null);
export function useApp(): AppModel {
  const model = useContext(AppContext);
  if (!model) throw new Error("AppContext is missing");
  return model;
}
