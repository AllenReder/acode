import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bootstrapRemoteBearerSession } from "@awen/client-runtime/authorization";
import { remoteHttpClientLayer } from "@awen/client-runtime/rpc";
import {
  AuthStandardClientScopes,
  ConnectionFailureCodeSchema,
  DesktopSshPasswordPromptCancelledType,
  type AdvertisedEndpoint,
  type AuthBearerSessionResult,
  type AuthSessionState,
  type AuthWebSocketTicketResult,
  type ClientSettings,
  type ConnectionFailureCode,
  type ContextMenuItem,
  type DesktopAppBranding,
  type DesktopBridge,
  type DesktopDiscoveredSshHost,
  type DesktopEnvironmentBootstrap,
  type DesktopServerExposureState,
  type DesktopSshHostKeyTrust,
  type DesktopSshEnvironmentPlan,
  type DesktopSshEnvironmentProgress,
  type DesktopSshEnvironmentBootstrap,
  type DesktopSshEnvironmentTarget,
  type DesktopSshPasswordPromptRequest,
  type DesktopTheme,
  type DesktopUpdateActionResult,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
  type DesktopWslState,
  type ExecutionEnvironmentDescriptor,
  type PickFolderOptions,
} from "@awen/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { readBrowserClientSettings, writeBrowserClientSettings } from "../clientPersistenceStorage";
import { showContextMenuFallback } from "../contextMenuFallback";
import { DesktopSshRequestError, SshPasswordPromptCancelledError } from "./sshErrors";
import { recordDesktopRuntimeConfigError, markDesktopRuntimeConfigSettled } from "./runtimeConfigError";
import { isTauri } from "../env";

interface TauriRuntimeConfig {
  readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly bearerToken?: string | null;
  readonly clientPlatform: string;
}

let localEnvironmentBootstraps: ReadonlyArray<DesktopEnvironmentBootstrap> = [];
let localEnvironmentBearerToken = "";
let localEnvironmentBearerExchange: Promise<string> | null = null;
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

export interface DesktopSshApiClientOptions {
  readonly getBaseUrl: () => string | undefined;
  readonly getBearerToken: () => Promise<string>;
  readonly fetchFn?: typeof fetch;
}

interface DesktopSshApiRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export function createDesktopSshApiClient(options: DesktopSshApiClientOptions) {
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  return {
    request: async <T>(path: string, requestOptions: DesktopSshApiRequestOptions = {}) => {
      const baseUrl = options.getBaseUrl();
      if (!baseUrl) {
        throw new DesktopSshRequestError(
          "unreachable",
          "The local daemon endpoint is unavailable.",
        );
      }
      const token = await options.getBearerToken();
      let response: Response;
      try {
        response = await fetchFn(new URL(path, baseUrl), {
          method: requestOptions.method ?? "GET",
          ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
          headers: {
            authorization: `Bearer ${token}`,
            ...(requestOptions.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(requestOptions.body === undefined
            ? {}
            : { body: JSON.stringify(requestOptions.body) }),
        });
      } catch (cause) {
        if (requestOptions.signal?.aborted) throw cause;
        throw new DesktopSshRequestError(
          "unreachable",
          cause instanceof Error ? cause.message : "The local daemon is unreachable.",
        );
      }

      if (!response.ok) {
        let message = `Local daemon SSH request failed with HTTP ${response.status}.`;
        let code: ConnectionFailureCode = "unknown";
        try {
          const body = (await response.clone().json()) as {
            readonly error?: { readonly code?: unknown; readonly message?: unknown };
          };
          if (typeof body.error?.message === "string" && body.error.message.length > 0) {
            message = body.error.message;
          }
          if (
            typeof body.error?.code === "string" &&
            Schema.is(ConnectionFailureCodeSchema)(body.error.code)
          ) {
            code = body.error.code;
          }
        } catch {
          // Keep the HTTP status fallback when the daemon returns no JSON body.
        }
        throw new DesktopSshRequestError(code, message, response.status);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    },
  };
}

function unsupported(capability: string): Promise<never> {
  return Promise.reject(new Error(`Awen Tauri shell does not support ${capability} yet.`));
}

export { SshPasswordPromptCancelledError } from "./sshErrors";

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
    channel: "stable",
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
        label: "Awen Desktop",
        deviceType: "desktop",
        surface: "desktop",
        ...(import.meta.env.APP_VERSION ? { appVersion: import.meta.env.APP_VERSION } : {}),
      },
    }).pipe(Effect.provide(remoteHttpClientLayer(globalThis.fetch))),
  )
    .then((access) => {
      localEnvironmentBearerToken = access.token;
      return access.token;
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
  const readLocalEnvironmentBearerToken = async () => {
    if (localEnvironmentBearerToken.length > 0) {
      return localEnvironmentBearerToken;
    }
    const bootstrap = primaryBootstrap();
    if (!bootstrap?.httpBaseUrl || !bootstrap.bootstrapToken) {
      return "";
    }
    return exchangeBearerCredential(bootstrap.httpBaseUrl, bootstrap.bootstrapToken);
  };
  const desktopSshApi = createDesktopSshApiClient({
    getBaseUrl: () => primaryBootstrap()?.httpBaseUrl ?? undefined,
    getBearerToken: readLocalEnvironmentBearerToken,
  });

  return {
    getAppBranding: (): DesktopAppBranding => {
      const stageLabel = import.meta.env.DEV ? "Dev" : "Alpha";
      return {
        baseName: "Awen",
        stageLabel,
        displayName: `Awen ${stageLabel}`,
      };
    },
    getClientPlatform: () => nativeClientPlatform,
    getSystemLocale: () => navigator.language || null,
    getLocalEnvironmentBootstraps: () => localEnvironmentBootstraps,
    getLocalEnvironmentEnabled: () => true,
    getLocalEnvironmentBearerToken: readLocalEnvironmentBearerToken,
    getClientSettings: async (): Promise<ClientSettings | null> => readBrowserClientSettings(),
    setClientSettings: async (settings: ClientSettings): Promise<void> => {
      writeBrowserClientSettings(settings);
    },
    discoverSshHosts: async () =>
      desktopSshApi.request<readonly DesktopDiscoveredSshHost[]>("/api/desktop/ssh/hosts"),
    resolveSshHost: async (alias: string): Promise<DesktopSshEnvironmentTarget> =>
      desktopSshApi.request("/api/desktop/ssh/hosts/resolve", {
        method: "POST",
        body: { alias },
      }),
    inspectSshHostTrust: async (
      target: DesktopSshEnvironmentTarget,
    ): Promise<DesktopSshHostKeyTrust> =>
      desktopSshApi.request("/api/desktop/ssh/trust", {
        method: "POST",
        body: target,
      }),
    inspectSshEnvironmentPlan: async (
      target: DesktopSshEnvironmentTarget,
    ): Promise<DesktopSshEnvironmentPlan> =>
      desktopSshApi.request("/api/desktop/ssh/plan", {
        method: "POST",
        body: target,
      }),
    trustSshHost: async (
      target: DesktopSshEnvironmentTarget,
      keyType: string,
      fingerprint: string,
    ): Promise<void> => {
      await desktopSshApi.request("/api/desktop/ssh/trust/accept", {
        method: "POST",
        body: { target, keyType, fingerprint },
      });
    },
    ensureSshEnvironment: async (
      target: DesktopSshEnvironmentTarget,
      options?: { issuePairingToken?: boolean; operationId?: string; signal?: AbortSignal },
    ): Promise<DesktopSshEnvironmentBootstrap> => {
      const result = await desktopSshApi.request<
        | DesktopSshEnvironmentBootstrap
        | { readonly type: typeof DesktopSshPasswordPromptCancelledType; readonly message: string }
      >("/api/desktop/ssh/ensure", {
        method: "POST",
        body: {
          target,
          options: options
            ? { issuePairingToken: options.issuePairingToken, operationId: options.operationId }
            : undefined,
        },
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if ("type" in result && result.type === DesktopSshPasswordPromptCancelledType) {
        throw new SshPasswordPromptCancelledError(result.message);
      }
      return result as DesktopSshEnvironmentBootstrap;
    },
    getSshEnvironmentProgress: (
      operationId: string,
    ): Promise<DesktopSshEnvironmentProgress | null> =>
      desktopSshApi.request("/api/desktop/ssh/progress", {
        method: "POST",
        body: { operationId },
      }),
    cancelSshEnvironment: async (operationId: string): Promise<void> => {
      await desktopSshApi.request("/api/desktop/ssh/cancel", {
        method: "POST",
        body: { operationId },
      });
    },
    disconnectSshEnvironment: async (target: DesktopSshEnvironmentTarget): Promise<void> => {
      await desktopSshApi.request("/api/desktop/ssh/disconnect", {
        method: "POST",
        body: target,
      });
    },
    fetchSshEnvironmentDescriptor: async (
      httpBaseUrl: string,
    ): Promise<ExecutionEnvironmentDescriptor> =>
      desktopSshApi.request("/api/desktop/ssh/descriptor", {
        method: "POST",
        body: { httpBaseUrl },
      }),
    bootstrapSshBearerSession: async (
      httpBaseUrl: string,
      credential: string,
    ): Promise<AuthBearerSessionResult> =>
      desktopSshApi.request("/api/desktop/ssh/bearer/bootstrap", {
        method: "POST",
        body: { httpBaseUrl, credential },
      }),
    fetchSshSessionState: async (
      httpBaseUrl: string,
      bearerToken: string,
    ): Promise<AuthSessionState> =>
      desktopSshApi.request("/api/desktop/ssh/bearer/session", {
        method: "POST",
        body: { httpBaseUrl, bearerToken },
      }),
    issueSshWebSocketTicket: async (
      httpBaseUrl: string,
      bearerToken: string,
    ): Promise<AuthWebSocketTicketResult> =>
      desktopSshApi.request("/api/desktop/ssh/bearer/ws-ticket", {
        method: "POST",
        body: { httpBaseUrl, bearerToken },
      }),
    onSshPasswordPrompt: (listener: (request: DesktopSshPasswordPromptRequest) => void) => {
      const seenRequestIds = new Set<string>();
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        try {
          const pending = await desktopSshApi.request<readonly DesktopSshPasswordPromptRequest[]>(
            "/api/desktop/ssh/password-prompts",
          );
          for (const request of pending) {
            if (!seenRequestIds.has(request.requestId)) {
              seenRequestIds.add(request.requestId);
              listener(request);
            }
          }
        } catch {
          // Retry on the next interval; connection setup itself reports its own failure.
        }
      };
      void poll();
      const interval = window.setInterval(() => {
        void poll();
      }, 250);
      return () => {
        stopped = true;
        window.clearInterval(interval);
      };
    },
    resolveSshPasswordPrompt: async (requestId: string, password: string | null): Promise<void> => {
      await desktopSshApi.request("/api/desktop/ssh/password-prompts/resolve", {
        method: "POST",
        body: { requestId, password },
      });
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
      readonly filters?: ReadonlyArray<{
        readonly name: string;
        readonly extensions: ReadonlyArray<string>;
      }>;
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
      recordDesktopRuntimeConfigError(error);
      // Say why, loudly: a missing bootstrap otherwise only shows up as the
      // primary target falling back to the window origin, where the proxy dials a
      // backend port nothing serves. The shell reports the launcher's own code.
      console.error(
        `[awen] the local daemon runtime config failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    })
    .finally(() => {
      markDesktopRuntimeConfigSettled();
    });
}
