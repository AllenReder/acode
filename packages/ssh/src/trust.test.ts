import { assert, describe, it } from "@effect/vitest";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";

import { classifySshHostKeyTrust } from "./trust.ts";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "allen",
  port: 22,
};

const KEY_A = "AAAAC3NzaC1lZDI1NTE5AAAAIKeyA";
const KEY_B = "AAAAC3NzaC1lZDI1NTE5AAAAIKeyB";
const RSA_KEY = "AAAAB3NzaC1yc2EAAAADAQABAAABKey";

const keyscanOutput = (key = KEY_A) =>
  [
    "# devbox.example.test:22 SSH-2.0-OpenSSH_9.9",
    `devbox.example.test ssh-ed25519 ${key}`,
    `devbox.example.test ssh-rsa ${RSA_KEY}`,
    "",
  ].join("\n");

const knownHostsOutput = (key = KEY_A) =>
  [
    "# Host devbox.example.test found: line 3",
    `devbox.example.test ssh-ed25519 ${key}`,
    "",
  ].join("\n");

describe("classifySshHostKeyTrust", () => {
  it("trusts a known host when a scanned key matches the known_hosts entry", () => {
    const result = classifySshHostKeyTrust(knownHostsOutput(), keyscanOutput(), TARGET);
    assert.deepEqual(result, { status: "trusted", keyType: null });
  });

  it("blocks when the scanned key for a known key type changed", () => {
    const result = classifySshHostKeyTrust(knownHostsOutput(), keyscanOutput(KEY_B), TARGET);
    assert.equal(result.status, "changed");
    assert.equal(result.keyType, "ssh-ed25519");
  });

  it("treats a host with no known_hosts entry as new", () => {
    const result = classifySshHostKeyTrust("", keyscanOutput(), TARGET);
    assert.equal(result.status, "new");
    assert.equal(result.keyType, "ssh-ed25519");
  });

  it("stays trusted when the host is unreachable but a known_hosts entry exists", () => {
    const result = classifySshHostKeyTrust(knownHostsOutput(), "", TARGET);
    assert.deepEqual(result, { status: "trusted", keyType: null });
  });

  it("reports a new host with no key material when nothing scans and nothing is known", () => {
    const result = classifySshHostKeyTrust("", "", TARGET);
    assert.deepEqual(result, { status: "new", keyType: null });
  });

  it("blocks when every scanned key type is absent or different in known_hosts", () => {
    // Host was reimaged and now only serves RSA; the known ed25519 key is gone.
    const scanned = `devbox.example.test ssh-rsa ${RSA_KEY}\n`;
    const result = classifySshHostKeyTrust(knownHostsOutput(), scanned, TARGET);
    assert.equal(result.status, "changed");
  });

  it("reads hashed known_hosts entries matched by ssh-keygen -F", () => {
    const hashed = "|1|salt==|hash== ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyA\n";
    const result = classifySshHostKeyTrust(hashed, keyscanOutput(), TARGET);
    assert.equal(result.status, "trusted");
  });

  it("matches non-default ports with the bracketed host prefix", () => {
    const target: DesktopSshEnvironmentTarget = { ...TARGET, port: 2222 };
    const scanned = `[devbox.example.test]:2222 ssh-ed25519 ${KEY_B}\n`;
    const known = `[devbox.example.test]:2222 ssh-ed25519 ${KEY_A}\n`;
    const result = classifySshHostKeyTrust(known, scanned, target);
    assert.equal(result.status, "changed");
  });

  it("ignores keyscan lines for other hosts", () => {
    const scanned = `other.example.test ssh-ed25519 ${KEY_B}\n`;
    const result = classifySshHostKeyTrust("", scanned, TARGET);
    assert.deepEqual(result, { status: "new", keyType: null });
  });
});
