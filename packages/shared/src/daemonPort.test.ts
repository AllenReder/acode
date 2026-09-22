import { describe, expect, it } from "vite-plus/test";

import {
  BASE_DAEMON_PORT,
  BASE_WEB_DEV_PORT,
  DAEMON_PORT_KEYS,
  daemonPortForOffset,
  describeInvalidDaemonPort,
  describeInvalidPortOffset,
  resolveDaemonPortRequest,
  resolveDesktopDevPorts,
  resolvePortOffset,
  webDevPortForOffset,
} from "./daemonPort.ts";

describe("daemon port request", () => {
  it("reads the documented keys in precedence order", () => {
    expect(resolveDaemonPortRequest({})).toEqual({ _tag: "unset" });
    expect(resolveDaemonPortRequest({ ACODE_DAEMON_PORT: "14001" })).toEqual({
      _tag: "set",
      key: "ACODE_DAEMON_PORT",
      port: 14_001,
      required: true,
    });
    expect(resolveDaemonPortRequest({ ACODE_PORT: "14002" })).toEqual({
      _tag: "set",
      key: "ACODE_PORT",
      port: 14_002,
      required: false,
    });
    expect(resolveDaemonPortRequest({ T3CODE_DAEMON_PORT: "14003" })).toEqual({
      _tag: "set",
      key: "T3CODE_DAEMON_PORT",
      port: 14_003,
      required: true,
    });
    expect(resolveDaemonPortRequest({ T3CODE_PORT: "14004" })).toEqual({
      _tag: "set",
      key: "T3CODE_PORT",
      port: 14_004,
      required: false,
    });
  });

  // The desktop dev wrapper resolved only ACODE_DAEMON_PORT and T3CODE_PORT, so
  // a developer's T3CODE_DAEMON_PORT was shadowed by the wrapper's default while
  // the launcher happily bound the port they asked for. Both sides now read this
  // one list.
  it("keeps every key a developer can set, in the launcher's order", () => {
    expect(DAEMON_PORT_KEYS.map((entry) => entry.key)).toEqual([
      "ACODE_DAEMON_PORT",
      "ACODE_PORT",
      "T3CODE_DAEMON_PORT",
      "T3CODE_PORT",
    ]);
    expect(
      resolveDaemonPortRequest({
        ACODE_DAEMON_PORT: "14001",
        ACODE_PORT: "14002",
        T3CODE_DAEMON_PORT: "14003",
        T3CODE_PORT: "14004",
      }),
    ).toMatchObject({ _tag: "set", key: "ACODE_DAEMON_PORT" });
    expect(
      resolveDaemonPortRequest({ ACODE_DAEMON_PORT: "  ", T3CODE_DAEMON_PORT: "14003" }),
    ).toMatchObject({ _tag: "set", key: "T3CODE_DAEMON_PORT" });
  });

  it("reports an unusable value instead of ignoring it", () => {
    expect(resolveDaemonPortRequest({ T3CODE_PORT: "not-a-port" })).toEqual({
      _tag: "invalid",
      key: "T3CODE_PORT",
      raw: "not-a-port",
    });
    expect(resolveDaemonPortRequest({ ACODE_DAEMON_PORT: "0" })._tag).toBe("invalid");
    expect(resolveDaemonPortRequest({ ACODE_DAEMON_PORT: "65536" })._tag).toBe("invalid");
    expect(resolveDaemonPortRequest({ ACODE_DAEMON_PORT: "-1" })._tag).toBe("invalid");
  });

  it("describes both failures in one wording", () => {
    expect(describeInvalidDaemonPort({ key: "ACODE_PORT", raw: "abc" })).toBe(
      'ACODE_PORT must be a port number between 1 and 65535; received "abc".',
    );
    expect(describeInvalidPortOffset("abc")).toBe(
      'T3CODE_PORT_OFFSET must be a non-negative integer; received "abc".',
    );
  });
});

describe("port offset", () => {
  it("defaults to zero and rejects anything but a non-negative integer", () => {
    expect(resolvePortOffset({})).toEqual({ _tag: "unset" });
    expect(resolvePortOffset({ T3CODE_PORT_OFFSET: "2" })).toEqual({ _tag: "set", offset: 2 });
    expect(resolvePortOffset({ T3CODE_PORT_OFFSET: "2.5" })).toEqual({
      _tag: "invalid",
      raw: "2.5",
    });
    expect(resolvePortOffset({ T3CODE_PORT_OFFSET: "-1" })._tag).toBe("invalid");
  });

  it("shifts both base ports by the same amount", () => {
    expect(daemonPortForOffset(0)).toBe(BASE_DAEMON_PORT);
    expect(webDevPortForOffset(0)).toBe(BASE_WEB_DEV_PORT);
    expect(webDevPortForOffset(2) - daemonPortForOffset(2)).toBe(
      BASE_WEB_DEV_PORT - BASE_DAEMON_PORT,
    );
  });
});

describe("desktop dev ports", () => {
  it("pairs the daemon and web ports of the same offset", () => {
    expect(resolveDesktopDevPorts({})).toEqual({
      _tag: "set",
      ports: { offset: 0, daemonPort: 13_773, webPort: 5_733 },
    });
    expect(resolveDesktopDevPorts({ T3CODE_PORT_OFFSET: "2" })).toEqual({
      _tag: "set",
      ports: { offset: 2, daemonPort: 13_775, webPort: 5_735 },
    });
  });

  // An explicit daemon port is absolute: it is not shifted again, or the window
  // and the proxy would address a port the daemon never bound.
  it("honours an explicit daemon port and leaves the offset to the web port", () => {
    expect(resolveDesktopDevPorts({ T3CODE_PORT_OFFSET: "2", ACODE_PORT: "15000" })).toEqual({
      _tag: "set",
      ports: { offset: 2, daemonPort: 15_000, webPort: 5_735 },
    });
  });

  it("surfaces an invalid port or offset instead of falling back", () => {
    expect(resolveDesktopDevPorts({ T3CODE_DAEMON_PORT: "nope" })).toEqual({
      _tag: "invalid",
      message: 'T3CODE_DAEMON_PORT must be a port number between 1 and 65535; received "nope".',
    });
    expect(resolveDesktopDevPorts({ T3CODE_PORT_OFFSET: "-3" })._tag).toBe("invalid");
  });
});
