import { qqNumber, record } from "./config.ts";

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly target: number | "all" }
  | { readonly kind: "face"; readonly id: number }
  | { readonly kind: "image" | "record" | "video"; readonly url?: string; readonly fileId?: string }
  | { readonly kind: "file"; readonly fileId: string; readonly name?: string; readonly bytes?: number }
  | { readonly kind: "unsupported"; readonly type: string };

export type Conversation =
  | { readonly kind: "group"; readonly group: number }
  | { readonly kind: "friend"; readonly user: number }
  | { readonly kind: "temporary"; readonly user: number; readonly sourceGroup?: number };

export interface QuoteReference {
  readonly sender: number;
  readonly sequence?: number;
  readonly time?: number;
  readonly random?: number;
}

export interface IncomingMessage {
  readonly kind: "message";
  readonly account: number;
  readonly sender: number;
  readonly messageId: string;
  readonly conversation: Conversation;
  readonly segments: readonly Segment[];
  readonly text: string;
  readonly quote?: QuoteReference;
  readonly time?: number;
  readonly senderName?: string;
  readonly groupRole?: "member" | "admin" | "owner";
}

export type IncomingRequest =
  | { readonly kind: "friend-request"; readonly account: number; readonly sender: number;
    readonly subtype: "add" | "single"; readonly requestId: string }
  | { readonly kind: "group-request"; readonly account: number; readonly sender: number;
    readonly subtype: "add" | "invite"; readonly group: number; readonly requestId: string };

export interface RecallEvent {
  readonly kind: "recall";
  readonly account: number;
  readonly sender: number;
  readonly messageId: string;
  readonly group?: number;
  readonly operator?: number;
}

export type IncomingEvent = IncomingMessage | IncomingRequest | RecallEvent;

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 && !/[\r\n\0]/u.test(value) ? value : undefined;
}

function displayText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function mediaURL(value: unknown): string | undefined {
  const url = identifier(value);
  if (!url) return;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) return url;
  } catch {}
}

export function decodeSegments(message: readonly unknown[]): Segment[] {
  const result: Segment[] = [];
  for (const raw of message) {
    if (typeof raw === "string") {
      result.push({ kind: "text", text: raw });
      continue;
    }
    const elem = record(raw);
    if (!elem) continue;
    const type = elem.type;
    if (typeof type !== "string") continue;
    if (type === "text" && typeof elem.text === "string") result.push({ kind: "text", text: elem.text });
    else if (type === "at") {
      const target = elem.qq === "all" ? "all" : qqNumber(elem.qq);
      if (target) result.push({ kind: "mention", target });
    } else if (type === "face") {
      const id = nonnegativeNumber(elem.id);
      if (id !== undefined) result.push({ kind: "face", id });
    } else if (type === "image" || type === "record" || type === "video") {
      const url = mediaURL(elem.url);
      const fileId = identifier(elem.fid);
      result.push({ kind: type, ...(url ? { url } : {}), ...(fileId ? { fileId } : {}) });
    } else if (type === "file") {
      const fileId = identifier(elem.fid);
      if (fileId) {
        const name = displayText(elem.name);
        const bytes = nonnegativeNumber(elem.size);
        result.push({ kind: "file", fileId, ...(name ? { name } : {}), ...(bytes === undefined ? {} : { bytes }) });
      }
    } else result.push({ kind: "unsupported", type });
  }
  return result;
}

function quoteOf(value: unknown): QuoteReference | undefined {
  const source = record(value);
  const sender = qqNumber(source?.user_id);
  const sequence = nonnegativeNumber(source?.seq);
  const time = nonnegativeNumber(source?.time);
  const random = typeof source?.rand === "number" && Number.isSafeInteger(source.rand) ? source.rand : undefined;
  if (!sender || (sequence === undefined && time === undefined)) return;
  return { sender, ...(sequence === undefined ? {} : { sequence }), ...(time === undefined ? {} : { time }),
    ...(random === undefined ? {} : { random }) };
}

function decodeMessage(account: number, raw: Readonly<Record<string, unknown>>): IncomingMessage | undefined {
  const profile = record(raw.sender);
  const sender = qqNumber(profile?.user_id ?? raw.user_id);
  const messageId = identifier(raw.message_id);
  if (!sender || sender === account || !messageId || !Array.isArray(raw.message)) return;
  const group = qqNumber(raw.group_id);
  let conversation: Conversation;
  if (raw.message_type === "group" && raw.sub_type === "normal" && group) {
    conversation = { kind: "group", group };
  } else if (raw.message_type === "private" && qqNumber(raw.from_id) === sender && qqNumber(raw.to_id) === account) {
    if (raw.sub_type === "friend") conversation = { kind: "friend", user: sender };
    else if (raw.sub_type === "group" || raw.sub_type === "other") {
      const sourceGroup = qqNumber(profile?.group_id);
      conversation = { kind: "temporary", user: sender, ...(sourceGroup ? { sourceGroup } : {}) };
    } else return;
  } else return;
  const segments = decodeSegments(raw.message);
  if (!segments.length) return;
  const groupRole = conversation.kind === "group" && (profile?.role === "member" || profile?.role === "admin" || profile?.role === "owner")
    ? profile.role : undefined;
  const senderName = displayText(profile?.card) ?? displayText(profile?.nickname);
  const time = nonnegativeNumber(raw.time);
  const quote = quoteOf(raw.source);
  return { kind: "message", account, sender, messageId, conversation, segments,
    text: segments.filter(segment => segment.kind === "text").map(segment => segment.text).join(""),
    ...(senderName ? { senderName } : {}), ...(time === undefined ? {} : { time }),
    ...(groupRole ? { groupRole } : {}), ...(quote ? { quote } : {}),
  };
}

export function decodeEvent(account: number, input: unknown): IncomingEvent | undefined {
  const raw = record(input);
  if (!raw || !qqNumber(account) || (Object.hasOwn(raw, "self_id") && raw.self_id !== account)) return;
  if (raw.post_type === "message") return decodeMessage(account, raw);
  const sender = qqNumber(raw.user_id);
  if (!sender) return;
  if (raw.post_type === "request") {
    if (sender === account) return;
    const requestId = identifier(raw.flag);
    if (!requestId) return;
    if (raw.request_type === "friend" && (raw.sub_type === "add" || raw.sub_type === "single")) {
      return { kind: "friend-request", account, sender, subtype: raw.sub_type, requestId };
    }
    const group = qqNumber(raw.group_id);
    if (raw.request_type === "group" && group && (raw.sub_type === "add" || raw.sub_type === "invite")) {
      return { kind: "group-request", account, sender, subtype: raw.sub_type, group, requestId };
    }
  }
  if (raw.post_type === "notice" && raw.sub_type === "recall") {
    const messageId = identifier(raw.message_id);
    const group = qqNumber(raw.group_id);
    const operator = qqNumber(raw.operator_id);
    if (!messageId || (raw.notice_type !== "friend" && (raw.notice_type !== "group" || !group))) return;
    return { kind: "recall", account, sender, messageId, ...(group ? { group } : {}),
      ...(operator ? { operator } : {}) };
  }
}

export type SendReceipt =
  | { readonly kind: "sent"; readonly messageId: string }
  | { readonly kind: "unknown" };

/** Missing acknowledgements stay unknown. A send with unknown outcome must not be replayed. */
export function decodeSendReceipt(value: unknown): SendReceipt {
  const messageId = identifier(record(value)?.message_id);
  return messageId ? { kind: "sent", messageId } : { kind: "unknown" };
}
