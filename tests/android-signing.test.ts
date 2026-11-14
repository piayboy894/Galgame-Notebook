import { describe, it, expect } from "vitest";
import { wrapIdentity, unwrapIdentity } from "../scripts/android-signing.mjs";

const identity = {
  alias: "xuxian",
  password: "a-valid-long-random-fixture-password",
  keystore: "private-keystore-fixture",
};
describe("Android signing identity protection", () => {
  it("recovers the same signing identity and never stores its plaintext in the envelope", () => {
    const encrypted = wrapIdentity(identity, "first-publishing-key\n");
    expect(JSON.stringify(encrypted)).not.toContain(identity.password);
    expect(JSON.stringify(encrypted)).not.toContain(identity.keystore);
    expect(unwrapIdentity(encrypted, "first-publishing-key\r\n")).toEqual(
      identity,
    );
    expect(wrapIdentity(identity, "first-publishing-key").data).not.toBe(
      encrypted.data,
    );
  });
  it("rejects a changed master key, modified ciphertext or authentication tag", () => {
    const encrypted = wrapIdentity(identity, "publishing-key");
    expect(() => unwrapIdentity(encrypted, "wrong-key")).toThrow(
      "不会生成替代身份",
    );
    const bytes = Buffer.from(encrypted.data, "base64");
    bytes[0] ^= 1;
    expect(() =>
      unwrapIdentity(
        { ...encrypted, data: bytes.toString("base64") },
        "publishing-key",
      ),
    ).toThrow();
    expect(() =>
      unwrapIdentity(
        { ...encrypted, tag: Buffer.alloc(16).toString("base64") },
        "publishing-key",
      ),
    ).toThrow();
  });
});
