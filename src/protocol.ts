// Structural snapshot of the host optional-protocol DTOs. Checked against the host contract separately.
export interface ProtocolScope {
  /** The registered adapter and local endpoint label, independent of any remote IDs. */
  readonly adapter: string;
  readonly instance: string;
  readonly platform?: string;
  readonly account: string;
}

export interface ProtocolConversation {
  readonly kind: "private" | "group" | "channel" | "temporary";
  readonly id: string;
  readonly parentId?: string;
  readonly transportKind?: string;
}

export type ProtocolMessagePart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "mention"; readonly id: string }
  | { readonly type: "image" | "audio" | "video" | "file"; readonly id: string; readonly name?: string };

export interface ProtocolIncomingMessage {
  readonly scope: ProtocolScope;
  readonly conversation: ProtocolConversation;
  readonly actor: string;
  readonly messageId: string;
  readonly parts: readonly ProtocolMessagePart[];
  readonly replyTo?: string;
}

export type ProtocolReplyPart =
  | Extract<ProtocolMessagePart, { type: "text" | "mention" }>
  | { readonly type: "image" | "audio" | "video" | "file"; readonly bytes: Uint8Array; readonly name: string };

export type ProtocolReceipt =
  | { readonly status: "accepted"; readonly messageId?: string }
  | { readonly status: "rejected" | "unknown" | "unsupported" };

export interface ProtocolGateway {
  send(message: Pick<ProtocolIncomingMessage, "scope" | "conversation" | "replyTo">,
    parts: readonly ProtocolReplyPart[], signal: AbortSignal): Promise<ProtocolReceipt>;
  start(receive: (message: ProtocolIncomingMessage) => Promise<void>, signal: AbortSignal): Promise<void>;
}
