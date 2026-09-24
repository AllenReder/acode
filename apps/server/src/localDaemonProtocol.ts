export const LOCAL_DAEMON_PROTOCOL_VERSION = 1 as const;
export const LOCAL_DAEMON_OWNER = "awen-local-daemon" as const;
export const LOCAL_DAEMON_HANDSHAKE_PATH = "/.well-known/awen/daemon" as const;

export interface LocalDaemonHandshake {
  readonly protocolVersion: typeof LOCAL_DAEMON_PROTOCOL_VERSION;
  readonly owner: typeof LOCAL_DAEMON_OWNER;
  readonly daemonId: string | null;
  readonly pid: number;
  readonly managed: boolean;
  /** Coarse local-only signal used for explicit-stop confirmation. */
  readonly activeWork?: boolean;
}
