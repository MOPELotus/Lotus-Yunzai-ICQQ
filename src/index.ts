export { discoverLegacyAccounts, parseLegacyAccount } from "./config.ts";
export type { LegacyAccount, LegacyAccountCandidate, LegacyAccountIssue, LegacyDiscovery } from "./config.ts";
export { decodeEvent, decodeSegments, decodeSendReceipt } from "./wire.ts";
export type { Conversation, IncomingEvent, IncomingMessage, IncomingRequest, QuoteReference, RecallEvent, Segment, SendReceipt } from "./wire.ts";
export { encodeSegments } from "./send.ts";
export type { IcqqSendable, OutboundSegment } from "./send.ts";
export { createIcqqGateway, IcqqGatewayError, icqqReplySegments, icqqSendDestination, sameIcqqScope, toProtocolMessage } from "./gateway.ts";
export type { IcqqGatewayOptions, IcqqScope, IcqqSdkClient, IcqqSdkFactory, IcqqSdkLease } from "./gateway.ts";
export type { ProtocolConversation, ProtocolGateway, ProtocolIncomingMessage, ProtocolMessagePart, ProtocolReceipt, ProtocolReplyPart, ProtocolScope } from "./protocol.ts";
