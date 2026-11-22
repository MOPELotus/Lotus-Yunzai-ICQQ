import { expect, test } from "bun:test";
import { createIcqqGateway, icqqReplySegments, icqqSendDestination, sameIcqqScope, toProtocolMessage,
  type IcqqScope, type ProtocolConversation } from "./index.ts";

const scope: IcqqScope = { adapter: "icqq", instance: "test-instance", account: "900001" };
const conversation: ProtocolConversation = { kind: "private", id: "900002" };

test("QQ numbers cannot inherit identity across realm, instance or account", () => {
  expect(sameIcqqScope(scope, { ...scope })).toBe(true);
  expect(sameIcqqScope(scope, { ...scope, adapter: "onebot" })).toBe(false);
  expect(sameIcqqScope(scope, { ...scope, instance: "other-instance" })).toBe(false);
  expect(sameIcqqScope(scope, { ...scope, account: "900002" })).toBe(false);
  expect(sameIcqqScope(scope, { ...scope, platform: "onebot" })).toBe(false);
});

test("common DTO retains provider string IDs and separates temporary conversations", () => {
  expect(toProtocolMessage(scope, {
    kind: "message", account: 900001, sender: 900002, messageId: "QQ-opaque-id=", text: "你好",
    groupRole: "owner", conversation: { kind: "temporary", user: 900002, sourceGroup: 900003 }, segments: [
      { kind: "mention", target: 900001 }, { kind: "text", text: "你好" },
      { kind: "image", fileId: "opaque-image-id" }, { kind: "unsupported", type: "custom" },
    ],
  })).toEqual({
    scope, actor: "900002", messageId: "QQ-opaque-id=",
    conversation: { kind: "temporary", id: "900002", parentId: "900003" },
    parts: [{ type: "mention", id: "900001" }, { type: "text", text: "你好" }, { type: "image", id: "opaque-image-id" }],
  });
});

test("validate conversation and all outgoing parts before invoking a send", () => {
  expect(icqqSendDestination(conversation)).toEqual({ kind: "friend", id: 900002 });
  expect(icqqSendDestination({ ...conversation, kind: "temporary" })).toBeUndefined();
  expect(icqqSendDestination({ ...conversation, kind: "group", parentId: "900003" })).toBeUndefined();
  expect(icqqSendDestination({ ...conversation, transportKind: "unregistered" })).toBeUndefined();
  expect(icqqSendDestination({ ...conversation, id: "9007199254740993" })).toBeUndefined();
  expect(icqqReplySegments([{ type: "text", text: "你好" }, { type: "file", name: "a", bytes: new Uint8Array(3) }])).toBeUndefined();
  expect(icqqReplySegments([{ type: "audio", name: "audio.silk", bytes: Uint8Array.of(7) }])).toEqual([
    { type: "record", file: Buffer.of(7) },
  ]);
});

test("unconfigured SDK reports a safe error without a session", async () => {
  const gateway = createIcqqGateway({ instance: scope.instance, account: scope.account });
  const signal = new AbortController().signal;
  await expect(gateway.start(async () => {}, signal)).rejects.toMatchObject({ code: "sdk-unavailable" });
  await expect(gateway.send({ scope, conversation }, [{ type: "text", text: "a" }], signal)).resolves.toEqual({ status: "rejected" });
  await expect(gateway.send({ scope: { ...scope, adapter: "onebot" }, conversation },
    [{ type: "text", text: "a" }], signal)).resolves.toEqual({ status: "unsupported" });
});
