import { describe, expect, it } from "vite-plus/test";

import {
  BASE_DAEMON_PORT,
  BASE_WEB_DEV_PORT,
  DAEMON_PORT_KEYS,
  MAX_HASH_OFFSET,
  daemonPortForOffset,
  describeInvalidDaemonPort,
  describeInvalidPortOffset,
  resolveDaemonPortRequest,
  resolveDesktopDevPorts,
  resolveDevPortOffset,
  resolvePortOffset,
  webDevPortForOffset,
} from "./daemonPort.ts";

describe("daemon port request", () => {
  it("reads the documented keys in precedence order", () => {
    expect(resolveDaemonPortRequest({})).toEqual({ _tag: "unset" });
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "14001" })).toEqual({
      _tag: "set",
      key: "AWEN_DAEMON_PORT",
      port: 14_001,
      required: true,
    });
    expect(resolveDaemonPortRequest({ AWEN_PORT: "14002" })).toEqual({
      _tag: "set",
      key: "AWEN_PORT",
      port: 14_002,
      required: false,
    });
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "14003" })).toEqual({
      _tag: "set",
      key: "AWEN_DAEMON_PORT",
      port: 14_003,
      required: true,
    });
    expect(resolveDaemonPortRequest({ AWEN_PORT: "14004" })).toEqual({
      _tag: "set",
      key: "AWEN_PORT",
      port: 14_004,
      required: false,
    });
  });

  // The desktop dev wrapper and daemon read the same ordered environment keys.
  it("keeps every key a developer can set, in the launcher's order", () => {
    expect(DAEMON_PORT_KEYS.map((entry) => entry.key)).toEqual(["AWEN_DAEMON_PORT", "AWEN_PORT"]);
    expect(
      resolveDaemonPortRequest({
        AWEN_DAEMON_PORT: "14001",
        AWEN_PORT: "14002",
      }),
    ).toEqual({ _tag: "set", key: "AWEN_DAEMON_PORT", port: 14_001, required: true });
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "  ", AWEN_PORT: "14003" })).toEqual({
      _tag: "set",
      key: "AWEN_PORT",
      port: 14_003,
      required: false,
    });
  });

  it("reports an unusable value instead of ignoring it", () => {
    expect(resolveDaemonPortRequest({ AWEN_PORT: "not-a-port" })).toEqual({
      _tag: "invalid",
      key: "AWEN_PORT",
      raw: "not-a-port",
    });
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "0" })._tag).toBe("invalid");
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "65536" })._tag).toBe("invalid");
    expect(resolveDaemonPortRequest({ AWEN_DAEMON_PORT: "-1" })._tag).toBe("invalid");
  });

  it("describes both failures in one wording", () => {
    expect(describeInvalidDaemonPort({ key: "AWEN_PORT", raw: "abc" })).toBe(
      'AWEN_PORT must be a port number between 1 and 65535; received "abc".',
    );
    expect(describeInvalidPortOffset("abc")).toBe(
      'AWEN_PORT_OFFSET must be a non-negative integer; received "abc".',
    );
  });
});

describe("port offset", () => {
  it("defaults to zero and rejects anything but a non-negative integer", () => {
    expect(resolvePortOffset({})).toEqual({ _tag: "unset" });
    expect(resolvePortOffset({ AWEN_PORT_OFFSET: "2" })).toEqual({ _tag: "set", offset: 2 });
    expect(resolvePortOffset({ AWEN_PORT_OFFSET: "2.5" })).toEqual({
      _tag: "invalid",
      raw: "2.5",
    });
    expect(resolvePortOffset({ AWEN_PORT_OFFSET: "-1" })._tag).toBe("invalid");
  });

  it("shifts both base ports by the same amount", () => {
    expect(daemonPortForOffset(0)).toBe(BASE_DAEMON_PORT);
    expect(webDevPortForOffset(0)).toBe(BASE_WEB_DEV_PORT);
    expect(webDevPortForOffset(2) - daemonPortForOffset(2)).toBe(
      BASE_WEB_DEV_PORT - BASE_DAEMON_PORT,
    );
  });
});

describe("dev port offset (shared authority)", () => {
  it("prefers an explicit offset, then a dev instance, then the checkout path", () => {
    expect(resolveDevPortOffset({ env: {} })).toEqual({
      _tag: "set",
      offset: 0,
      source: "default ports",
    });
    expect(resolveDevPortOffset({ env: { AWEN_DEV_INSTANCE: "12" } })).toMatchObject({
      _tag: "set",
      offset: 12,
    });
    expect(
      resolveDevPortOffset({ env: { AWEN_PORT_OFFSET: "3", AWEN_DEV_INSTANCE: "12" } }),
    ).toMatchObject({ _tag: "set", offset: 3 });
    expect(
      resolveDevPortOffset({ env: { AWEN_PORT_OFFSET: "3" }, worktreePath: "/work/tree" }),
    ).toMatchObject({ _tag: "set", offset: 3 });
  });

  it("hashes a non-numeric dev instance and a checkout path into the same band", () => {
    const byInstance = resolveDevPortOffset({ env: { AWEN_DEV_INSTANCE: "feature-branch" } });
    expect(byInstance._tag).toBe("set");
    if (byInstance._tag !== "set") throw new Error("expected a set offset");
    expect(byInstance.offset).toBeGreaterThanOrEqual(1);
    expect(byInstance.offset).toBeLessThanOrEqual(MAX_HASH_OFFSET);

    const byPath = resolveDevPortOffset({ env: {}, worktreePath: "/work/awen" });
    expect(byPath._tag).toBe("set");
    if (byPath._tag !== "set") throw new Error("expected a set offset");
    expect(byPath.offset).toBeGreaterThanOrEqual(1);
    expect(byPath.offset).toBeLessThanOrEqual(MAX_HASH_OFFSET);
  });

  it("rejects an unusable offset instead of silently ignoring it", () => {
    expect(resolveDevPortOffset({ env: { AWEN_PORT_OFFSET: "-1" } })).toEqual({
      _tag: "invalid",
      raw: "-1",
    });
    expect(resolveDevPortOffset({ env: { AWEN_PORT_OFFSET: "2.5" } })._tag).toBe("invalid");
  });
});

describe("desktop dev ports", () => {
  // The parity that fixes issue #129: the wrapper and the dev-runner resolve the
  // very same offset for one checkout, so a second stack fails on a shared port
  // instead of silently dialing a port nothing serves.
  it("agrees with the shared offset resolver for one checkout", () => {
    const shared = resolveDevPortOffset({ env: {}, worktreePath: "/work/awen" });
    const desktop = resolveDesktopDevPorts({}, "/work/awen");
    expect(shared._tag).toBe("set");
    expect(desktop._tag).toBe("set");
    if (shared._tag !== "set" || desktop._tag !== "set") throw new Error("expected set ports");
    expect(desktop.ports.offset).toBe(shared.offset);
    expect(desktop.ports.webPort).toBe(BASE_WEB_DEV_PORT + shared.offset);
    expect(desktop.ports.daemonPort).toBe(BASE_DAEMON_PORT + shared.offset);
  });

  it("derives the offset from the checkout path so two worktrees never collide", () => {
    const a = resolveDesktopDevPorts({}, "/work/awen-a");
    const b = resolveDesktopDevPorts({}, "/work/awen-b");
    expect(a._tag).toBe("set");
    expect(b._tag).toBe("set");
    if (a._tag !== "set" || b._tag !== "set") throw new Error("expected set ports");
    expect(a.ports.offset).toBeGreaterThanOrEqual(1);
    expect(b.ports.offset).toBeGreaterThanOrEqual(1);
    expect(a.ports.daemonPort).not.toBe(b.ports.daemonPort);
  });

  it("pairs the daemon and web ports of the same offset", () => {
    expect(resolveDesktopDevPorts({})).toEqual({
      _tag: "set",
      ports: { offset: 0, daemonPort: 13_773, webPort: 5_733 },
    });
    expect(resolveDesktopDevPorts({ AWEN_PORT_OFFSET: "2" })).toEqual({
      _tag: "set",
      ports: { offset: 2, daemonPort: 13_775, webPort: 5_735 },
    });
  });

  // An explicit daemon port is absolute: it is not shifted again, or the window
  // and the proxy would address a port the daemon never bound.
  it("honours an explicit daemon port and leaves the offset to the web port", () => {
    expect(resolveDesktopDevPorts({ AWEN_PORT_OFFSET: "2", AWEN_PORT: "15000" })).toEqual({
      _tag: "set",
      ports: { offset: 2, daemonPort: 15_000, webPort: 5_735 },
    });
  });

  it("surfaces an invalid port or offset instead of falling back", () => {
    expect(resolveDesktopDevPorts({ AWEN_DAEMON_PORT: "nope" })).toEqual({
      _tag: "invalid",
      message: 'AWEN_DAEMON_PORT must be a port number between 1 and 65535; received "nope".',
    });
    expect(resolveDesktopDevPorts({ AWEN_PORT_OFFSET: "-3" })._tag).toBe("invalid");
  });
});
