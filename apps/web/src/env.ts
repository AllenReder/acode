/** True when the WebView is running inside the ACode Tauri shell. */
export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window ||
    "isTauri" in window ||
    Boolean((window as any).isTauri) ||
    window.location?.protocol === "tauri:" ||
    window.location?.port === "5733");

/**
 * True only for the existing Electron desktop runtime. Tauri uses the same
 * desktop bridge contract for connection/auth seams, but does not claim
 * Electron-only surfaces such as the embedded browser or custom title bar.
 */
export const isElectron =
  !isTauri && typeof window !== "undefined" && window.desktopBridge !== undefined;

/** True for either native desktop host. */
export const isDesktop = isElectron || isTauri;
