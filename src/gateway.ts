import { qqNumber, record } from "./config.ts";
import type { ProtocolConversation, ProtocolGateway, ProtocolIncomingMessage, ProtocolMessagePart,
  ProtocolReceipt, ProtocolReplyPart, ProtocolScope } from "./protocol.ts";
import { encodeSegments, type IcqqSendable, type OutboundSegment } from "./send.ts";
import { decodeEvent, decodeSendReceipt, type IncomingMessage, type Segment } from "./wire.ts";

export interface IcqqScope extends ProtocolScope {
  readonly adapter: "icqq";
  readonly platform?: never;
}

export interface IcqqQuote {
  readonly user_id: number;
  readonly seq: number;
  readonly time: number;
  readonly rand: number;
  readonly message: string;
}

interface IcqqSendTarget {
  sendMsg(message: IcqqSendable[], source?: IcqqQuote): Promise<unknown>;
}

export interface IcqqSdkClient {
  readonly uin: number;
  isOnline(): boolean;
  on(event: "message", handler: (value: unknown) => void): () => unknown;
  pickFriend(id: number, strict?: boolean): IcqqSendTarget;
  pickGroup(id: number, strict?: boolean): IcqqSendTarget;
}

export interface IcqqSdkLease {
  readonly client: IcqqSdkClient;
  close(): void | Promise<void>;
}

/** Called only for an enabled endpoint, with ownership of an already authenticated lease. */
export type IcqqSdkFactory = (scope: IcqqScope, signal: AbortSignal) => IcqqSdkLease | Promise<IcqqSdkLease>;

export class IcqqGatewayError extends Error {
  constructor(readonly code: "configuration" | "sdk-unavailable" | "account-offline" | "already-running") {
    super({
      configuration: "ICQQ endpoint requires an explicit instance and QQ account.",
      "sdk-unavailable": "ICQQ SDK is unavailable. Install and configure the selected SDK for this endpoint.",
      "account-offline": "The ICQQ SDK did not provide the configured online account.",
      "already-running": "This ICQQ endpoint already has a running session.",
    }[code]);
    this.name = "IcqqGatewayError";
  }
}

function numericId(value: string): number | undefined {
  return /^[1-9]\d*$/u.test(value) ? qqNumber(Number(value)) : undefined;
}

export function sameIcqqScope(expected: IcqqScope, actual: ProtocolScope): boolean {
  return actual.adapter === "icqq" && actual.instance === expected.instance
    && actual.account === expected.account && actual.platform === undefined;
}

function messagePart(segment: Segment): ProtocolMessagePart | undefined {
  switch (segment.kind) {
    case "text": return { type: "text", text: segment.text };
    case "mention": return { type: "mention", id: String(segment.target) };
    case "file": return { type: "file", id: segment.fileId, ...(segment.name ? { name: segment.name } : {}) };
    case "image":
    case "record":
    case "video": {
      const id = segment.fileId ?? segment.url;
      if (id) return { type: segment.kind === "record" ? "audio" : segment.kind, id };
      return;
    }
    default: return;
  }
}

export function toProtocolMessage(scope: IcqqScope, message: IncomingMessage): ProtocolIncomingMessage | undefined {
  if (String(message.account) !== scope.account) return;
  const source = message.conversation;
  let conversation: ProtocolConversation;
  if (source.kind === "group") conversation = { kind: "group", id: String(source.group) };
  else if (source.kind === "friend") conversation = { kind: "private", id: String(source.user) };
  else conversation = { kind: "temporary", id: String(source.user),
    ...(source.sourceGroup ? { parentId: String(source.sourceGroup) } : {}) };
  const parts = message.segments.flatMap(segment => {
    const part = messagePart(segment);
    return part ? [part] : [];
  });
  if (!parts.length) return;
  return { scope, conversation, actor: String(message.sender), messageId: message.messageId, parts };
}

/** A QQ group ID is not a private-chat ID. Temporary/channel sends need their own SDK method. */
export function icqqSendDestination(conversation: ProtocolConversation): { kind: "friend" | "group"; id: number } | undefined {
  if (conversation.parentId !== undefined || conversation.transportKind !== undefined
    || (conversation.kind !== "private" && conversation.kind !== "group")) return;
  const id = numericId(conversation.id);
  return id ? { kind: conversation.kind === "private" ? "friend" : "group", id } : undefined;
}

export function icqqReplySegments(parts: readonly ProtocolReplyPart[]): IcqqSendable[] | undefined {
  if (!parts.length) return;
  const prepared: OutboundSegment[] = [];
  for (const part of parts) {
    if (part.type === "text") prepared.push({ kind: "text", text: part.text });
    else if (part.type === "mention") {
      const target = part.id === "all" ? "all" : numericId(part.id);
      if (!target) return;
      prepared.push({ kind: "mention", target });
    } else if (part.type !== "file" && part.bytes.byteLength) {
      prepared.push({ kind: part.type === "audio" ? "record" : part.type, bytes: part.bytes });
    } else return;
  }
  return encodeSegments(prepared);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function conversationKey(conversation: ProtocolConversation): string {
  return JSON.stringify([conversation.kind, conversation.transportKind ?? null, conversation.parentId ?? null, conversation.id]);
}

function quoteKey(conversation: string, messageId: string): string {
  return JSON.stringify([conversation, messageId]);
}

const QUOTES_LIMIT = 256;
const QUOTE_PREVIEW_LIMIT = 512;

function incomingQuote(input: unknown, message: IncomingMessage): IcqqQuote | undefined {
  const raw = record(input);
  const { time, seq, rand } = raw ?? {};
  if (typeof time !== "number" || !Number.isSafeInteger(time) || time < 0 ||
      typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 ||
      typeof rand !== "number" || !Number.isSafeInteger(rand)) return;
  return { user_id: message.sender, time, seq, rand, message: message.text.slice(0, QUOTE_PREVIEW_LIMIT) };
}

export interface IcqqGatewayOptions {
  readonly instance: string;
  readonly account: string;
  readonly sdkFactory?: IcqqSdkFactory;
  readonly diagnose?: (code: "receive-failed" | "shutdown-failed") => void;
}

export function createIcqqGateway(options: IcqqGatewayOptions): ProtocolGateway {
  const account = numericId(options.account);
  if (!account || !options.instance.trim() || /[\r\n\0]/u.test(options.instance)) {
    throw new IcqqGatewayError("configuration");
  }
  const scope: IcqqScope = Object.freeze({ adapter: "icqq", instance: options.instance, account: options.account });
  const quotes = new Map<string, { conversation: string; messageId: string; quote: IcqqQuote }>();
  let starting = false;
  let active: { client: IcqqSdkClient; signal: AbortSignal } | undefined;

  function diagnostic(code: "receive-failed" | "shutdown-failed"): void {
    try { options.diagnose?.(code); } catch {}
  }

  async function close(lease: IcqqSdkLease): Promise<void> {
    try { await lease.close(); } catch { diagnostic("shutdown-failed"); }
  }

  async function start(receive: (message: ProtocolIncomingMessage) => Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (starting) throw new IcqqGatewayError("already-running");
    const factory = options.sdkFactory;
    if (!factory) throw new IcqqGatewayError("sdk-unavailable");
    starting = true;
    let lease: IcqqSdkLease | undefined;
    let dispose: (() => unknown) | undefined;
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return factory(scope, signal);
    });
    try {
      try {
        lease = await abortable(pending, signal);
      } catch {
        throw new IcqqGatewayError("sdk-unavailable");
      }
      if (!lease) {
        if (!signal.aborted) throw new IcqqGatewayError("sdk-unavailable");
        // Keep the start slot until a late factory relinquishes its lease.
        void pending.then(close, () => {}).finally(() => { starting = false; });
        return;
      }
      if (signal.aborted) return;
      const { client } = lease;
      if (client.uin !== account || !client.isOnline()) throw new IcqqGatewayError("account-offline");
      active = { client, signal };
      const receiveFrame = (frame: unknown) => {
        if (signal.aborted || client.uin !== account || !client.isOnline()) return;
        const message = decodeEvent(account, frame);
        if (message?.kind !== "message") return;
        const event = toProtocolMessage(scope, message);
        if (!event) return;
        const conversation = conversationKey(event.conversation);
        const reference = message.quote;
        const replyTo = reference && [...quotes.values()].find(entry =>
          entry.conversation === conversation && entry.quote.user_id === reference.sender
          && entry.quote.time === reference.time && entry.quote.seq === reference.sequence
          && entry.quote.rand === reference.random)?.messageId;
        const quote = incomingQuote(frame, message);
        if (quote && event.conversation.kind !== "temporary") {
          quotes.set(quoteKey(conversation, event.messageId), { conversation, messageId: event.messageId, quote });
          if (quotes.size > QUOTES_LIMIT) quotes.delete(quotes.keys().next().value!);
        }
        void Promise.resolve().then(() => {
          if (!signal.aborted) return receive(replyTo ? { ...event, replyTo } : event);
        }).catch(() => diagnostic("receive-failed"));
      };
      try { dispose = client.on("message", receiveFrame); } catch { throw new IcqqGatewayError("sdk-unavailable"); }
      await waitForAbort(signal);
    } finally {
      active = undefined;
      quotes.clear();
      try { dispose?.(); } catch { diagnostic("shutdown-failed"); }
      if (lease) await close(lease);
      if (lease || !signal.aborted) starting = false;
    }
  }

  async function send(message: Pick<ProtocolIncomingMessage, "scope" | "conversation" | "replyTo">,
    parts: readonly ProtocolReplyPart[], signal: AbortSignal): Promise<ProtocolReceipt> {
    if (!sameIcqqScope(scope, message.scope)) return { status: "unsupported" };
    if (signal.aborted) return { status: "rejected" };
    const destination = icqqSendDestination(message.conversation);
    const encoded = icqqReplySegments(parts);
    const quote = message.replyTo !== undefined
      ? quotes.get(quoteKey(conversationKey(message.conversation), message.replyTo))?.quote : undefined;
    if (!destination || !encoded || (message.replyTo !== undefined && !quote)) return { status: "unsupported" };
    const session = active;
    if (!session || session.signal.aborted || session.client.uin !== account || !session.client.isOnline()) {
      return { status: "rejected" };
    }
    let target: IcqqSendTarget;
    try {
      target = destination.kind === "group" ? session.client.pickGroup(destination.id, true)
        : session.client.pickFriend(destination.id, true);
    } catch {
      return { status: "rejected" };
    }
    try {
      const result = decodeSendReceipt(await abortable(
        target.sendMsg(encoded, quote), AbortSignal.any([signal, session.signal])));
      return result.kind === "sent" ? { status: "accepted", messageId: result.messageId } : { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }
  return { start, send };
}
