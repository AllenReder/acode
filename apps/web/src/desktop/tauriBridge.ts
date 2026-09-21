import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import {
  AuthStandardClientScopes,
  type AdvertisedEndpoint,
  type AuthAccessTokenResult,
  type AuthSessionState,
  type AuthWebSocketTicketResult,
  type ClientSettings,
  type ContextMenuItem,
  type DesktopAppBranding,
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
  type DesktopServerExposureState,
  type DesktopSshEnvironmentBootstrap,
  type DesktopSshEnvironmentTarget,
  type DesktopSshPasswordPromptRequest,
  type DesktopTheme,
  type DesktopUpdateActionResult,
  type DesktopUpdateChannel,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
  type DesktopWslState,
  type ExecutionEnvironmentDescriptor,
  type PickFolderOptions,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readBrowserClientSettings, writeBrowserClientSettings } from "../clientPersistenceStorage";
import { showContextMenuFallback } from "../contextMenuFallback";
import { isTauri } from "../env";

interface TauriRuntimeConfig {
  readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly bearerToken?: string | null;
  readonly clientPlatform: string;
}

let localEnvironmentBootstraps: ReadonlyArray<DesktopEnvironmentBootstrap> = [];
let localEnvironmentBearerToken = "";
let localEnvironmentBearerExchange: Promise<string> | null = null;
let localEnvironmentConfigError: unknown = null;
let nativeClientPlatform = "other";

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function unsupported(capability: string): Promise<never> {
  return Promise.reject(new Error(`ACode Tauri shell does not support ${capability} yet.`));
}

function disabledWslState(): DesktopWslState {
  return {
    enabled: false,
    distro: null,
    available: false,
    wslOnly: false,
    distros: [],
    preflightError: null,
  };
}

function localOnlyExposureState(): DesktopServerExposureState {
  return {
    mode: "local-only",
    endpointUrl: primaryBootstrap()?.httpBaseUrl ?? null,
    advertisedHost: null,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  };
}

function disabledUpdateState(): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    channel: "latest",
    currentVersion: import.meta.env.APP_VERSION || "0.0.0",
    hostArch: "other",
    appArch: "other",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

function primaryBootstrap(): DesktopEnvironmentBootstrap | undefined {
  return localEnvironmentBootstraps.find((entry) => entry.id === "primary");
}

async function exchangeBearerCredential(httpBaseUrl: string, credential: string): Promise<string> {
  if (localEnvironmentBearerExchange) {
    return localEnvironmentBearerExchange;
  }

  localEnvironmentBearerExchange = Effect.runPromise(
    bootstrapRemoteBearerSession({
      httpBaseUrl,
      credential,
      scopes: AuthStandardClientScopes,
      clientMetadata: {
        label: "ACode Desktop",
        deviceType: "desktop",
        surface: "desktop",
        ...(import.meta.env.APP_VERSION ? { appVersion: import.meta.env.APP_VERSION } : {}),
      },
    }).pipe(Effect.provide(remoteHttpClientLayer(globalThis.fetch))),
  )
    .then((access) => {
      localEnvironmentBearerToken = access.access_token;
      return access.access_token;
    })
    .catch((error) => {
      localEnvironmentBearerExchange = null;
      throw error;
    });

  return localEnvironmentBearerExchange;
}

export async function exchangeTauriPrimaryCredential(credential: string): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("Tauri desktop authentication is unavailable."));
  }
  const httpBaseUrl = primaryBootstrap()?.httpBaseUrl;
  if (!httpBaseUrl) {
    return Promise.reject(new Error("The local daemon endpoint is unavailable."));
  }
  return exchangeBearerCredential(httpBaseUrl, credential);
}

const createTauriDesktopBridge = (): DesktopBridge => {
  let updateState = disabledUpdateState();

  return {
    getAppBranding: (): DesktopAppBranding => {
      const stageLabel = import.meta.env.DEV ? "Dev" : "Alpha";
      return {
        baseName: "ACode",
        stageLabel,
        displayName: `ACode ${stageLabel}`,
      };
    },
    getClientPlatform: () => nativeClientPlatform,
    getSystemLocale: () => navigator.language || null,
    getLocalEnvironmentBootstraps: () => localEnvironmentBootstraps,
    getLocalEnvironmentEnabled: () => true,
    getLocalEnvironmentBearerToken: async () => {
      if (localEnvironmentBearerToken.length > 0) {
        return localEnvironmentBearerToken;
      }
      const bootstrap = primaryBootstrap();
      if (!bootstrap?.httpBaseUrl || !bootstrap.bootstrapToken) {
        return "";
      }
      return exchangeBearerCredential(bootstrap.httpBaseUrl, bootstrap.bootstrapToken);
    },
    getClientSettings: async (): Promise<ClientSettings | null> => readBrowserClientSettings(),
    setClientSettings: async (settings: ClientSettings): Promise<void> => {
      writeBrowserClientSettings(settings);
    },
    discoverSshHosts: async () => [],
    resolveSshHost: async (_alias: string): Promise<DesktopSshEnvironmentTarget> =>
      unsupported("SSH host discovery"),
    ensureSshEnvironment: async (
      _target: DesktopSshEnvironmentTarget,
      _options?: { issuePairingToken?: boolean },
    ): Promise<DesktopSshEnvironmentBootstrap> => unsupported("SSH environments"),
    disconnectSshEnvironment: async (_target: DesktopSshEnvironmentTarget): Promise<void> => {
      await unsupported("SSH environments");
    },
    fetchSshEnvironmentDescriptor: async (
      _httpBaseUrl: string,
    ): Promise<ExecutionEnvironmentDescriptor> => unsupported("SSH environments"),
    bootstrapSshBearerSession: async (
      _httpBaseUrl: string,
      _credential: string,
    ): Promise<AuthAccessTokenResult> => unsupported("SSH environments"),
    fetchSshSessionState: async (
      _httpBaseUrl: string,
      _bearerToken: string,
    ): Promise<AuthSessionState> => unsupported("SSH environments"),
    issueSshWebSocketTicket: async (
      _httpBaseUrl: string,
      _bearerToken: string,
    ): Promise<AuthWebSocketTicketResult> => unsupported("SSH environments"),
    onSshPasswordPrompt: (_listener: (request: DesktopSshPasswordPromptRequest) => void) => () =>
      undefined,
    resolveSshPasswordPrompt: async (
      _requestId: string,
      _password: string | null,
    ): Promise<void> => {
      await unsupported("SSH password prompts");
    },
    getServerExposureState: async () => localOnlyExposureState(),
    setServerExposureMode: async (_mode) => unsupported("server exposure changes"),
    setTailscaleServeEnabled: async (_input) => unsupported("Tailscale Serve"),
    getAdvertisedEndpoints: async (): Promise<ReadonlyArray<AdvertisedEndpoint>> => [],
    getWslState: async () => disabledWslState(),
    setWslBackendEnabled: async (_enabled: boolean) => unsupported("WSL backends"),
    setWslDistro: async (_distro: string | null) => unsupported("WSL backends"),
    setWslOnly: async (_enabled: boolean) => unsupported("WSL backends"),
    pickFolder: async (options?: PickFolderOptions): Promise<string | null> => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
      });
      return typeof selected === "string" ? selected : null;
    },
    pickFile: async (options?: {
      readonly filters?: ReadonlyArray<{ readonly name: string; readonly extensions: ReadonlyArray<string> }>;
      readonly initialPath?: string;
    }): Promise<string | null> => {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        ...(options?.filters ? { filters: options.filters as any } : {}),
        ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
      });
      return typeof selected === "string" ? selected : null;
    },
    setTheme: async (_theme: DesktopTheme): Promise<void> => undefined,
    setWindowGlassEnabled: async (enabled: boolean): Promise<void> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_window_glass_enabled", { enabled });
      } catch {
        // Desktop IPC unavailable
      }
    },
    setWindowBackgroundBlur: async (radius: number): Promise<void> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_window_background_blur", { radius });
      } catch {
        // Desktop IPC unavailable
      }
    },
    showContextMenu: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ): Promise<T | null> => showContextMenuFallback(items, position),
    openExternal: async (url: string): Promise<boolean> => {
      if (!isSafeExternalUrl(url)) {
        return false;
      }
      try {
        await openUrl(url);
        return true;
      } catch {
        return false;
      }
    },
    onMenuAction: (_listener: (action: string) => void) => () => undefined,
    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: (_listener: (fullscreen: boolean) => void) => () => undefined,
    getUpdateState: async () => updateState,
    setUpdateChannel: async (channel: DesktopUpdateChannel) => {
      updateState = { ...updateState, channel };
      return updateState;
    },
    checkForUpdate: async (): Promise<DesktopUpdateCheckResult> => ({
      checked: false,
      state: updateState,
    }),
    downloadUpdate: async (): Promise<DesktopUpdateActionResult> => ({
      accepted: false,
      completed: false,
      state: updateState,
    }),
    installUpdate: async (): Promise<DesktopUpdateActionResult> => ({
      accepted: false,
      completed: false,
      state: updateState,
    }),
    onUpdateState: (_listener: (state: DesktopUpdateState) => void) => () => undefined,
  };
};

function installExternalLinkGuard(bridge: Pick<DesktopBridge, "openExternal">): void {
  if (typeof document === "undefined") {
    return;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      const anchor = event
        .composedPath()
        .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
      if (!anchor) {
        return;
      }

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (url.origin === window.location.origin) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (isSafeExternalUrl(url.toString())) {
        void bridge.openExternal(url.toString());
      }
    },
    true,
  );
}

export let tauriDesktopBridgeReady: Promise<void> = Promise.resolve();

if (isTauri) {
  const bridge = createTauriDesktopBridge();
  window.desktopBridge = bridge;
  installExternalLinkGuard(bridge);
  tauriDesktopBridgeReady = import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<TauriRuntimeConfig>("read_desktop_runtime_config"))
    .then((config) => {
      localEnvironmentBootstraps = config.bootstraps;
      localEnvironmentBearerToken = config.bearerToken ?? "";
      nativeClientPlatform = config.clientPlatform;
    })
    .catch((error) => {
      // Keep rendering so the client can show its normal disconnected/auth
      // state instead of turning a missing daemon descriptor into a blank app.
      localEnvironmentConfigError = error;
    });
}

export function readTauriDesktopConfigError(): unknown {
  return localEnvironmentConfigError;
}
