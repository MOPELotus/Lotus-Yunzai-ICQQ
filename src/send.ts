export type OutboundSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly target: number | "all" }
  | { readonly kind: "face"; readonly id: number }
  | { readonly kind: "image" | "record" | "video"; readonly bytes: Uint8Array };

export type IcqqSendable =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "at"; readonly qq: number | "all" }
  | { readonly type: "face"; readonly id: number }
  | { readonly type: "image" | "record" | "video"; readonly file: Buffer };

/** A caller resolves and authorizes media. This mapper carries bytes and never opens a URL or path. */
export function encodeSegments(segments: readonly OutboundSegment[]): IcqqSendable[] {
  return segments.map(segment => {
    switch (segment.kind) {
      case "text": return { type: "text", text: segment.text };
      case "mention": return { type: "at", qq: segment.target };
      case "face": return { type: "face", id: segment.id };
      case "image":
      case "record":
      case "video": return { type: segment.kind, file: Buffer.from(segment.bytes) };
    }
  });
}
