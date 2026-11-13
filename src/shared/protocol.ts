import { z } from "zod";

/**
 * OmniDesk Protocol Specifications
 * Strict TypeScript & Type-Driven Architecture adhering to Matt Pocock & Cloudflare Security principles.
 */

// ==========================================
// 1. ACL PERMISSIONS & COMMON TYPES
// ==========================================

export const ACLPermissionsSchema = z.object({
  allowInput: z.boolean(),
  allowClipboard: z.boolean(),
  allowFileTransfer: z.boolean(),
  allowAudio: z.boolean(),
});
export type ACLPermissions = z.infer<typeof ACLPermissionsSchema>;

export const DEFAULT_ACL_PERMISSIONS: ACLPermissions = {
  allowInput: true,
  allowClipboard: true,
  allowFileTransfer: true,
  allowAudio: true,
};

// 9-digit Device ID Regex (either 9 continuous digits or formatted with spaces XXX XXX XXX)
export const DEVICE_ID_REGEX = /^\d{3}\s?\d{3}\s?\d{3}$/;

export function normalizeDeviceId(id: string): string {
  return id.replace(/\s+/g, "").trim();
}

export function formatDeviceId(id: string): string {
  const digits = normalizeDeviceId(id);
  if (digits.length !== 9) return id;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}

export function isValidDeviceId(id: string): boolean {
  const digits = normalizeDeviceId(id);
  return /^\d{9}$/.test(digits);
}

// ==========================================
// 2. WEBRTC SIGNALING PAYLOADS
// ==========================================

export const RTCIceCandidateInitSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});
export type RTCIceCandidateInitLike = z.infer<typeof RTCIceCandidateInitSchema>;

export const SignalOfferSchema = z.object({
  kind: z.literal("offer"),
  sdp: z.string().min(1),
});

export const SignalAnswerSchema = z.object({
  kind: z.literal("answer"),
  sdp: z.string().min(1),
});

export const SignalIceCandidateSchema = z.object({
  kind: z.literal("ice-candidate"),
  candidate: RTCIceCandidateInitSchema,
});

export const WebRTCSignalPayloadSchema = z.discriminatedUnion("kind", [
  SignalOfferSchema,
  SignalAnswerSchema,
  SignalIceCandidateSchema,
]);
export type WebRTCSignalPayload = z.infer<typeof WebRTCSignalPayloadSchema>;

// ==========================================
// 3. SIGNALING SERVER MESSAGES (WS)
// ==========================================

// Client/Host -> Server: Register Host
export const RegisterHostMsgSchema = z.object({
  type: z.literal("register-host"),
  deviceId: z.string().regex(DEVICE_ID_REGEX).optional(),
  deviceName: z.string().min(1).max(64),
  unattendedEnabled: z.boolean(),
  passwordHash: z.string().optional(),
  hostSecret: z.string().min(16).max(128).optional(),
});
export type RegisterHostMsg = z.infer<typeof RegisterHostMsgSchema>;

// Server -> Host: Registration Confirmation
export const RegisteredMsgSchema = z.object({
  type: z.literal("registered"),
  deviceId: z.string().length(9),
  success: z.literal(true),
});
export type RegisteredMsg = z.infer<typeof RegisteredMsgSchema>;

// Client -> Server: Peer Status Query
export const PeerStatusRequestMsgSchema = z.object({
  type: z.literal("peer-status-request"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
});
export type PeerStatusRequestMsg = z.infer<typeof PeerStatusRequestMsgSchema>;

// Server -> Client: Peer Status Response
export const PeerStatusResponseMsgSchema = z.object({
  type: z.literal("peer-status-response"),
  targetId: z.string(),
  online: z.boolean(),
  deviceName: z.string().optional(),
});
export type PeerStatusResponseMsg = z.infer<typeof PeerStatusResponseMsgSchema>;

// Client -> Server -> Host: Connection Request
export const SessionRequestMsgSchema = z.object({
  type: z.literal("session-request"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  clientName: z.string().min(1).max(64),
  clientDeviceId: z.string().length(9),
  hasUnattendedPassword: z.boolean(),
});
export type SessionRequestMsg = z.infer<typeof SessionRequestMsgSchema>;

// Host -> Server -> Client: Authentication Challenge for Unattended Access
export const AuthChallengeMsgSchema = z.object({
  type: z.literal("auth-challenge"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  nonce: z.string().min(16),
  salt: z.string().min(16),
  iterations: z.number().int().positive().optional(),
});
export type AuthChallengeMsg = z.infer<typeof AuthChallengeMsgSchema>;

// Client -> Server -> Host: Challenge Response Proof
export const AuthResponseMsgSchema = z.object({
  type: z.literal("auth-response"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  proof: z.string().min(32),
});
export type AuthResponseMsg = z.infer<typeof AuthResponseMsgSchema>;

// Host -> Server -> Client: Session Accepted
export const SessionAcceptedMsgSchema = z.object({
  type: z.literal("session-accepted"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  permissions: ACLPermissionsSchema,
});
export type SessionAcceptedMsg = z.infer<typeof SessionAcceptedMsgSchema>;

// Host/Server -> Client: Session Rejected
export const SessionRejectedMsgSchema = z.object({
  type: z.literal("session-rejected"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9).optional(),
  reason: z.string().min(1).max(256),
});
export type SessionRejectedMsg = z.infer<typeof SessionRejectedMsgSchema>;

// Peer -> Server -> Peer: WebRTC Signal Envelope
export const WebRTCSignalMsgSchema = z.object({
  type: z.literal("webrtc-signal"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  signal: WebRTCSignalPayloadSchema,
});
export type WebRTCSignalMsg = z.infer<typeof WebRTCSignalMsgSchema>;

// Peer -> Server -> Peer: Terminate Session
export const SessionCloseMsgSchema = z.object({
  type: z.literal("session-close"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  reason: z.string().max(256).optional(),
});
export type SessionCloseMsg = z.infer<typeof SessionCloseMsgSchema>;

// Fallback Video Relay: Host -> WSS Relay / DataChannel -> Client (AnyDesk Fallback)
export const VideoFrameMsgSchema = z.object({
  type: z.literal("video-frame"),
  targetId: z.string().optional(),
  senderId: z.string().optional(),
  fromId: z.string().optional(),
  frameDataUrl: z.string(),
  width: z.number(),
  height: z.number(),
  timestamp: z.number(),
});
export type VideoFrameMsg = z.infer<typeof VideoFrameMsgSchema>;

export const VideoFrameChunkMsgSchema = z.object({
  type: z.literal("video-frame-chunk"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  frameId: z.string().min(1).max(64),
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  data: z.string(),
  width: z.number(),
  height: z.number(),
  timestamp: z.number(),
});
export type VideoFrameChunkMsg = z.infer<typeof VideoFrameChunkMsgSchema>;

export const VideoStatusMsgSchema = z.object({
  type: z.literal("video-status"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  webrtcActive: z.boolean(),
  nativeControlActive: z.boolean().optional(),
});
export type VideoStatusMsg = z.infer<typeof VideoStatusMsgSchema>;

// Heartbeat & Errors
export const PingMsgSchema = z.object({ type: z.literal("ping") });
export const PongMsgSchema = z.object({ type: z.literal("pong") });

export const ErrorMsgSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type ErrorMsg = z.infer<typeof ErrorMsgSchema>;

// ==========================================
// 4. DATA CHANNEL #1: CONTROL CHANNEL PACKETS
// ==========================================

export const MouseMovePacketSchema = z.object({
  kind: z.literal("mouse-move"),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const MouseButtonPacketSchema = z.object({
  kind: z.enum(["mouse-down", "mouse-up"]),
  button: z.enum(["left", "right", "middle"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const MouseWheelPacketSchema = z.object({
  kind: z.literal("mouse-wheel"),
  deltaX: z.number(),
  deltaY: z.number(),
});

export const KeyPacketSchema = z.object({
  kind: z.enum(["key-down", "key-up"]),
  key: z.string(),
  code: z.string(),
  altKey: z.boolean(),
  ctrlKey: z.boolean(),
  shiftKey: z.boolean(),
  metaKey: z.boolean(),
});

export const SpecialKeyPacketSchema = z.object({
  kind: z.literal("special-key"),
  action: z.enum(["ctrl-alt-del", "lock", "esc"]),
});

export const InputPacketSchema = z.discriminatedUnion("kind", [
  MouseMovePacketSchema,
  MouseButtonPacketSchema,
  MouseWheelPacketSchema,
  KeyPacketSchema,
  SpecialKeyPacketSchema,
]);
export type InputPacket = z.infer<typeof InputPacketSchema>;

export const ACLUpdatePacketSchema = z.object({
  kind: z.literal("acl-update"),
  permissions: ACLPermissionsSchema,
});
export type ACLUpdatePacket = z.infer<typeof ACLUpdatePacketSchema>;

export const ChatMessagePacketSchema = z.object({
  kind: z.literal("chat-message"),
  id: z.string(),
  sender: z.string().min(1),
  text: z.string().min(1).max(2000),
  timestamp: z.number(),
});
export type ChatMessagePacket = z.infer<typeof ChatMessagePacketSchema>;

export const TelemetryPacketSchema = z.object({
  kind: z.literal("telemetry"),
  pingMs: z.number(),
  fps: z.number(),
  bitrateKbps: z.number(),
  packetLoss: z.number(),
});
export type TelemetryPacket = z.infer<typeof TelemetryPacketSchema>;

export const ControlChannelPacketSchema = z.discriminatedUnion("kind", [
  MouseMovePacketSchema,
  MouseButtonPacketSchema,
  MouseWheelPacketSchema,
  KeyPacketSchema,
  SpecialKeyPacketSchema,
  ACLUpdatePacketSchema,
  ChatMessagePacketSchema,
  TelemetryPacketSchema,
]);
export type ControlChannelPacket = z.infer<typeof ControlChannelPacketSchema>;

// Fallback Control Relay over WSS when WebRTC DataChannel is unavailable
export const ControlRelayMsgSchema = z.object({
  type: z.literal("control-relay"),
  targetId: z.string().regex(DEVICE_ID_REGEX),
  senderId: z.string().length(9),
  packet: ControlChannelPacketSchema,
});
export type ControlRelayMsg = z.infer<typeof ControlRelayMsgSchema>;

// Combined Discriminated Union for all Signaling Messages
export const SignalingMessageSchema = z.discriminatedUnion("type", [
  RegisterHostMsgSchema,
  RegisteredMsgSchema,
  PeerStatusRequestMsgSchema,
  PeerStatusResponseMsgSchema,
  SessionRequestMsgSchema,
  AuthChallengeMsgSchema,
  AuthResponseMsgSchema,
  SessionAcceptedMsgSchema,
  SessionRejectedMsgSchema,
  WebRTCSignalMsgSchema,
  SessionCloseMsgSchema,
  VideoFrameMsgSchema,
  VideoFrameChunkMsgSchema,
  VideoStatusMsgSchema,
  ControlRelayMsgSchema,
  PingMsgSchema,
  PongMsgSchema,
  ErrorMsgSchema,
]);
export type SignalingMessage = z.infer<typeof SignalingMessageSchema>;

// ==========================================
// 5. DATA CHANNEL #2: FILE & CLIPBOARD PACKETS
// ==========================================

export const FileMetadataPacketSchema = z.object({
  kind: z.literal("file-metadata"),
  transferId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  fileType: z.string(),
  totalChunks: z.number().int().positive(),
  sha256: z.string().length(64),
});
export type FileMetadataPacket = z.infer<typeof FileMetadataPacketSchema>;

export const FileChunkPacketSchema = z.object({
  kind: z.literal("file-chunk"),
  transferId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  dataBase64: z.string(),
});
export type FileChunkPacket = z.infer<typeof FileChunkPacketSchema>;

export const FileAckPacketSchema = z.object({
  kind: z.literal("file-ack"),
  transferId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
});
export type FileAckPacket = z.infer<typeof FileAckPacketSchema>;

export const FileCompletePacketSchema = z.object({
  kind: z.literal("file-complete"),
  transferId: z.string().uuid(),
  verified: z.boolean(),
});
export type FileCompletePacket = z.infer<typeof FileCompletePacketSchema>;

export const FileAbortPacketSchema = z.object({
  kind: z.literal("file-abort"),
  transferId: z.string().uuid(),
  reason: z.string().max(256),
});
export type FileAbortPacket = z.infer<typeof FileAbortPacketSchema>;

export const ClipboardSyncPacketSchema = z.object({
  kind: z.literal("clipboard-sync"),
  text: z.string(),
  timestamp: z.number(),
});
export type ClipboardSyncPacket = z.infer<typeof ClipboardSyncPacketSchema>;

export const TransferChannelPacketSchema = z.discriminatedUnion("kind", [
  FileMetadataPacketSchema,
  FileChunkPacketSchema,
  FileAckPacketSchema,
  FileCompletePacketSchema,
  FileAbortPacketSchema,
  ClipboardSyncPacketSchema,
]);
export type TransferChannelPacket = z.infer<typeof TransferChannelPacketSchema>;

// ==========================================
// 6. VALIDATION HELPERS
// ==========================================

export function parseSignalingMessage(raw: unknown): SignalingMessage | null {
  const parsed = SignalingMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function parseControlPacket(raw: unknown): ControlChannelPacket | null {
  const parsed = ControlChannelPacketSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function parseTransferPacket(raw: unknown): TransferChannelPacket | null {
  const parsed = TransferChannelPacketSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}
