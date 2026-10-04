/** Lets the active page render its toolbar (e.g. calendar navigation) inside the TopBar. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Setter = (node: ReactNode) => void;
const ToolbarSetterContext = createContext<Setter>(() => {});
const ToolbarNodeContext = createContext<ReactNode>(null);

export function ToolbarProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <ToolbarSetterContext.Provider value={setNode}>
      <ToolbarNodeContext.Provider value={node}>{children}</ToolbarNodeContext.Provider>
    </ToolbarSetterContext.Provider>
  );
}

export function usePageToolbar(node: ReactNode): void {
  const set = useContext(ToolbarSetterContext);
  useEffect(() => {
    set(node);
  }, [node, set]);
  useEffect(() => () => set(null), [set]);
}

export function useToolbarNode(): ReactNode {
  return useContext(ToolbarNodeContext);
}
