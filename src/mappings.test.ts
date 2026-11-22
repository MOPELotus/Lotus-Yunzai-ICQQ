import { expect, test } from "bun:test";
import { decodeEvent, decodeSendReceipt, discoverLegacyAccounts, encodeSegments, parseLegacyAccount } from "./index.ts";

test("legacy discovery retains entry precedence and returns no migration secrets", () => {
  const token = "790001:fixture-secret:3:fixture-version:https://sign.invalid:8443/example";
  expect(parseLegacyAccount(token)).toEqual({ account: 790001, password: "fixture-secret", platform: 3,
    version: "fixture-version", signEndpoint: "https://sign.invalid:8443/example" });
  const rows = discoverLegacyAccounts({ token: [token, "790001", "790002::x", "9007199254740993"] });
  expect(rows).toEqual([
    { index: 0, status: "candidate", account: 790001, hasPassword: true, hasSignEndpoint: true },
    { index: 1, status: "duplicate-account" },
    { index: 2, status: "invalid-platform" },
    { index: 3, status: "invalid-account" },
  ]);
  expect(JSON.stringify(rows)).not.toContain("fixture-secret");
  expect(JSON.stringify(rows)).not.toContain("sign.invalid");
});

test("direct SDK message decoding keeps opaque identifiers and authoritative sender metadata", () => {
  const event = { post_type: "message", message_type: "group", sub_type: "normal", group_id: 80,
    message_id: "ZAAIQ==", self_id: 12, user_id: 99, sender: { user_id: 99, role: "admin", card: "群名片" },
    source: { user_id: 11, seq: 0, time: 100, rand: -10 },
    message: [{ type: "at", qq: 12 }, { type: "text", text: "#状态" },
      { type: "image", url: "file:///etc/passwd", fid: "known-fid" }, { type: "custom", value: "opaque" }] };
  expect(decodeEvent(12, event)).toEqual({
    kind: "message", account: 12, sender: 99, conversation: { kind: "group", group: 80 }, messageId: "ZAAIQ==",
    text: "#状态", senderName: "群名片", groupRole: "admin",
    quote: { sender: 11, sequence: 0, time: 100, random: -10 },
    segments: [{ kind: "mention", target: 12 }, { kind: "text", text: "#状态" },
      { kind: "image", fileId: "known-fid" }, { kind: "unsupported", type: "custom" }],
  });
  expect(decodeEvent(13, event)).toBeUndefined();
  expect(decodeEvent(12, { ...event, sub_type: "anonymous" })).toBeUndefined();
});

test("temporary private scenes stay distinct from friend scenes and outgoing echoes", () => {
  const message = { post_type: "message", message_type: "private", self_id: 12, from_id: 99, to_id: 12,
    message_id: "D001", sender: { user_id: 99, group_id: 80, role: "owner" }, message: ["hello"] };
  expect(decodeEvent(12, { ...message, sub_type: "group" })).toMatchObject({
    conversation: { kind: "temporary", user: 99, sourceGroup: 80 }, text: "hello",
  });
  const friend = decodeEvent(12, { ...message, sub_type: "friend" });
  expect(friend).toMatchObject({ conversation: { kind: "friend", user: 99 } });
  expect(friend).not.toHaveProperty("groupRole");
  expect(decodeEvent(12, { ...message, sub_type: "friend", to_id: 13 })).toBeUndefined();
  expect(decodeEvent(12, { ...message, sub_type: "self" })).toBeUndefined();
});

test("request and recall conversion never returns callables or coerces SDK response identifiers", () => {
  expect(decodeEvent(12, { post_type: "request", request_type: "group", sub_type: "invite",
    user_id: 99, group_id: 80, flag: "req=01", approve() {} })).toEqual({
    kind: "group-request", subtype: "invite", sender: 99, group: 80, requestId: "req=01", account: 12,
  });
  expect(decodeEvent(12, { post_type: "notice", notice_type: "friend", sub_type: "recall", user_id: 99,
    operator_id: 99, message_id: "R01=" })).toEqual({
    kind: "recall", account: 12, sender: 99, operator: 99, messageId: "R01=",
  });
  expect(decodeSendReceipt({ message_id: "N001=", seq: 99 })).toEqual({ kind: "sent", messageId: "N001=" });
  expect(decodeSendReceipt({ message_id: 99 })).toEqual({ kind: "unknown" });
  expect(decodeSendReceipt({ seq: 99 })).toEqual({ kind: "unknown" });
});

test("outbound segments preserve caller media bytes, text and mentions", () => {
  const bytes = Uint8Array.of(1, 2, 3);
  const result = encodeSegments([{ kind: "text", text: "中文" }, { kind: "mention", target: 12 },
    { kind: "image", bytes }]);
  expect(result).toEqual([{ type: "text", text: "中文" }, { type: "at", qq: 12 },
    { type: "image", file: Buffer.from([1, 2, 3]) }]);
});
