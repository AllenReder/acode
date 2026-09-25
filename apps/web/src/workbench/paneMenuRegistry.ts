import { createContext, useContext } from "react";

export interface MenuAnchorPosition {
  readonly x: number;
  readonly y: number;
}

/** Lets the right-drag gesture open a Pane header menu on a non-dragging release. */
export interface PaneMenuRegistry {
  register(paneId: string, open: (position: MenuAnchorPosition) => void): () => void;
  open(paneId: string, position: MenuAnchorPosition): boolean;
}

export const PaneMenuRegistryContext = createContext<PaneMenuRegistry | null>(null);

export function usePaneMenuRegistry(): PaneMenuRegistry | null {
  return useContext(PaneMenuRegistryContext);
}
