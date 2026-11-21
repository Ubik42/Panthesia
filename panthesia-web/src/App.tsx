import { AppContext } from "./app/AppContext";
import { AppShell } from "./app/AppShell";
import { useAppModel } from "./app/useAppModel";

export default function App() {
  const model = useAppModel();
  return (
    <AppContext.Provider value={model}>
      <AppShell />
    </AppContext.Provider>
  );
}
