import { create } from "zustand";

interface SessionAlertStoreState {
  readonly dismissedKeys: Record<string, string>;
  readonly dismissAlert: (sessionId: string, stateKey: string) => void;
  readonly isAlertDismissed: (sessionId: string, stateKey: string) => boolean;
}

export const useSessionAlertStore = create<SessionAlertStoreState>((set, get) => ({
  dismissedKeys: {},
  dismissAlert: (sessionId, stateKey) => {
    set((state) => {
      if (state.dismissedKeys[sessionId] === stateKey) return state;
      return {
        dismissedKeys: {
          ...state.dismissedKeys,
          [sessionId]: stateKey,
        },
      };
    });
  },
  isAlertDismissed: (sessionId, stateKey) => {
    return get().dismissedKeys[sessionId] === stateKey;
  },
}));
