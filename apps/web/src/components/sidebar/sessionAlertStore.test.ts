import { describe, expect, it } from "vite-plus/test";
import { useSessionAlertStore } from "./sessionAlertStore";

describe("sessionAlertStore", () => {
  it("records dismissed alert state keys per session and checks dismissal", () => {
    const store = useSessionAlertStore.getState();

    expect(store.isAlertDismissed("session-1", "running:1")).toBe(false);

    store.dismissAlert("session-1", "running:1");
    expect(useSessionAlertStore.getState().isAlertDismissed("session-1", "running:1")).toBe(true);

    // Different state key is not dismissed
    expect(useSessionAlertStore.getState().isAlertDismissed("session-1", "error:2")).toBe(false);

    // Different session is not dismissed
    expect(useSessionAlertStore.getState().isAlertDismissed("session-2", "running:1")).toBe(false);

    // Dismissing new state key updates dismissed state
    store.dismissAlert("session-1", "error:2");
    expect(useSessionAlertStore.getState().isAlertDismissed("session-1", "error:2")).toBe(true);
    expect(useSessionAlertStore.getState().isAlertDismissed("session-1", "running:1")).toBe(false);
  });
});
