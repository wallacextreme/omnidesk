import mqtt, { type MqttClient } from "mqtt";
import {
  parseSignalingMessage,
  type SignalingMessage,
  type RegisterHostMsg,
} from "../shared/protocol";
import { generateRandomBytes, generateNonce } from "./crypto";

export type SignalingMode = "cloud" | "local";

export interface SignalingStatus {
  online: boolean;
  mode: SignalingMode;
  label: string;
  brokerOrUrl: string;
}

export interface SignalingClientHandlers {
  onStatusChange?: (status: SignalingStatus) => void;
  onRegistered?: (deviceId: string) => void;
  onMessage?: (message: SignalingMessage) => void;
}

export interface ConnectOptions {
  deviceId?: string | undefined;
  deviceName: string;
  unattendedEnabled: boolean;
  hostSecret?: string | undefined;
}

export interface ISignalingTransport {
  connect(options: ConnectOptions): void;
  send(message: SignalingMessage): void;
  disconnect(): void;
  readonly isConnected: boolean;
}

// Public low-latency WSS MQTT brokers for Zero-Config Serverless P2P
export const CLOUD_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];

export function generateSecureDeviceId(): string {
  const bytes = generateRandomBytes(4);
  const num = (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
  const idNum = 100_000_000 + (num % 900_000_000);
  return idNum.toString();
}

export function getOrCreateHostSecret(): string {
  if (typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem("omnidesk_host_secret");
      if (saved && saved.length >= 32) return saved;
      const created = generateNonce(32);
      localStorage.setItem("omnidesk_host_secret", created);
      return created;
    } catch {}
  }
  return generateNonce(32);
}

/**
 * 1. Cloud WSS Signaling (MQTT-over-WSS)
 * Completely eliminates the need for a local server when accessing https://omnidesk-remote.web.app
 * Direct P2P routing through omnidesk/v1/peer/${targetDeviceId} topics.
 */
export class CloudWSSSignaling implements ISignalingTransport {
  private client: MqttClient | null = null;
  private currentBrokerIndex = 0;
  private activeDeviceId: string = "";
  private myTopic: string = "";
  private isDestroyed = false;
  private connected = false;

  constructor(private handlers: SignalingClientHandlers) {}

  public get isConnected(): boolean {
    return this.connected;
  }

  public connect(options: ConnectOptions): void {
    this.isDestroyed = false;

    // Retrieve or generate persistent 9-digit deviceId
    let devId = options.deviceId;
    if (!devId && typeof localStorage !== "undefined") {
      try {
        devId = localStorage.getItem("omnidesk_device_id") || undefined;
      } catch {}
    }
    if (!devId || devId.length !== 9) {
      devId = generateSecureDeviceId();
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("omnidesk_device_id", devId);
        } catch {}
      }
    }

    this.activeDeviceId = devId;
    this.myTopic = `omnidesk/v1/peer/${this.activeDeviceId}`;

    this.connectBroker();
  }

  private connectBroker(): void {
    if (this.isDestroyed) return;

    if (this.client) {
      try {
        this.client.end(true);
      } catch {}
      this.client = null;
    }

    const brokerUrl = CLOUD_BROKERS[this.currentBrokerIndex] ?? CLOUD_BROKERS[0]!;
    const clientId = `omnidesk_${this.activeDeviceId}_${Math.random().toString(16).slice(2, 8)}`;

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 7000,
        keepalive: 30,
        reconnectPeriod: 4000,
      });

      this.client.on("connect", () => {
        if (this.isDestroyed || !this.client) return;
        this.connected = true;

        // Subscribe to our exclusive peer topic
        this.client.subscribe(this.myTopic, { qos: 1 }, (err) => {
          if (err) {
            console.warn(`[CloudWSS] Failed to subscribe to ${this.myTopic}:`, err);
            return;
          }

          // Emit instant registered event
          this.handlers.onRegistered?.(this.activeDeviceId);

          this.handlers.onStatusChange?.({
            online: true,
            mode: "cloud",
            label: "Online (Nuvem WSS)",
            brokerOrUrl: brokerUrl,
          });
        });
      });

      this.client.on("message", (_topic: string, payload: Buffer) => {
        if (this.isDestroyed) return;
        try {
          const raw = JSON.parse(payload.toString("utf-8"));
          const validMsg = parseSignalingMessage(raw);
          if (validMsg) {
            this.handlers.onMessage?.(validMsg);
          }
        } catch (err) {
          // Discard malformed packets silently per Zero-Trust specification
        }
      });

      this.client.on("error", (err) => {
        console.warn(`[CloudWSS] Error on broker ${brokerUrl}:`, err.message);
        this.connected = false;
        this.failoverBroker();
      });

      this.client.on("close", () => {
        if (this.isDestroyed) return;
        this.connected = false;
        this.handlers.onStatusChange?.({
          online: false,
          mode: "cloud",
          label: "Reconectando Nuvem...",
          brokerOrUrl: brokerUrl,
        });
      });
    } catch (err) {
      console.warn("[CloudWSS] Broker connect threw error:", err);
      this.failoverBroker();
    }
  }

  private failoverBroker(): void {
    if (this.isDestroyed) return;
    this.currentBrokerIndex = (this.currentBrokerIndex + 1) % CLOUD_BROKERS.length;
    const nextBroker = CLOUD_BROKERS[this.currentBrokerIndex]!;
    console.info(`[CloudWSS] Switching to backup WSS broker: ${nextBroker}`);
    setTimeout(() => {
      if (!this.isDestroyed) this.connectBroker();
    }, 1500);
  }

  public send(message: SignalingMessage): void {
    if (!this.client || !this.connected) {
      console.warn("[CloudWSS] Cannot send, client not connected");
      return;
    }

    // Direct peer-to-peer routing by target device ID
    let targetId: string | undefined;
    if ("targetId" in message && typeof message.targetId === "string") {
      targetId = message.targetId;
    }

    if (!targetId) {
      // Internal or registration message, handled locally in serverless mode
      if (message.type === "register-host") {
        this.handlers.onRegistered?.(this.activeDeviceId);
      }
      return;
    }

    const targetTopic = `omnidesk/v1/peer/${targetId}`;
    const payloadStr = JSON.stringify(message);

    this.client.publish(targetTopic, payloadStr, { qos: 1, retain: false }, (err) => {
      if (err) {
        console.warn(`[CloudWSS] Publish error to ${targetTopic}:`, err);
      }
    });
  }

  public disconnect(): void {
    this.isDestroyed = true;
    this.connected = false;
    if (this.client) {
      try {
        this.client.end(true);
      } catch {}
      this.client = null;
    }
  }
}

/**
 * 2. Local Bun WebSocket Signaling (LAN / Offline Mode)
 * Used when running on an isolated local network (e.g. ws://192.168.1.138:4000)
 */
export class LocalSignalingClient implements ISignalingTransport {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedOptions?: ConnectOptions;

  constructor(
    private serverUrl: string,
    private handlers: SignalingClientHandlers
  ) {}

  public get isConnected(): boolean {
    return this.connected;
  }

  public connect(options: ConnectOptions): void {
    this.isDestroyed = false;
    this.cachedOptions = options;
    this.initSocket();
  }

  private initSocket(): void {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        if (this.isDestroyed || !this.ws) return;
        this.connected = true;

        this.handlers.onStatusChange?.({
          online: true,
          mode: "local",
          label: "Online (Servidor Local)",
          brokerOrUrl: this.serverUrl,
        });

        // Register host with ID Hijacking protection token (hostSecret)
        const opts = this.cachedOptions;
        if (opts) {
          const regMsg: RegisterHostMsg = {
            type: "register-host",
            ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
            deviceName: opts.deviceName,
            unattendedEnabled: opts.unattendedEnabled,
            hostSecret: opts.hostSecret || getOrCreateHostSecret(),
          };
          this.ws.send(JSON.stringify(regMsg));
        }
      };

      this.ws.onmessage = (event) => {
        if (this.isDestroyed) return;
        try {
          const raw = JSON.parse(event.data);
          const valid = parseSignalingMessage(raw);
          if (!valid) return;

          if (valid.type === "registered") {
            this.handlers.onRegistered?.(valid.deviceId);
          }
          this.handlers.onMessage?.(valid);
        } catch {}
      };

      this.ws.onclose = () => {
        if (this.isDestroyed) return;
        this.connected = false;
        this.handlers.onStatusChange?.({
          online: false,
          mode: "local",
          label: "Desconectado (Servidor Local)",
          brokerOrUrl: this.serverUrl,
        });

        this.reconnectTimer = setTimeout(() => {
          this.initSocket();
        }, 3000);
      };

      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {}
      };
    } catch (err) {
      this.connected = false;
      this.handlers.onStatusChange?.({
        online: false,
        mode: "local",
        label: "Falha na conexão local",
        brokerOrUrl: this.serverUrl,
      });
      this.reconnectTimer = setTimeout(() => {
        this.initSocket();
      }, 4000);
    }
  }

  public send(message: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  public disconnect(): void {
    this.isDestroyed = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

/**
 * 3. Unified Hybrid Signaling Client
 * Automatically selects Cloud WSS on HTTPS / production environments,
 * and seamlessly supports toggling to local Bun WebSocket server.
 */
export class SignalingClient {
  private currentTransport: ISignalingTransport | null = null;
  private mode: SignalingMode = "cloud";
  private localUrl: string;
  private activeOptions?: ConnectOptions;

  constructor(
    private handlers: SignalingClientHandlers,
    initialMode?: SignalingMode,
    initialLocalUrl?: string
  ) {
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const savedMode = (typeof localStorage !== "undefined"
      ? (localStorage.getItem("omnidesk_signaling_mode") as SignalingMode)
      : null) || (isHttps ? "cloud" : "cloud"); // Cloud WSS is default for zero-config

    this.mode = initialMode ?? savedMode;
    this.localUrl =
      initialLocalUrl ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("omnidesk_signaling_url") || "" : "") ||
      (typeof window !== "undefined" ? `ws://${window.location.hostname}:4000` : "ws://localhost:4000");
  }

  public getMode(): SignalingMode {
    return this.mode;
  }

  public getLocalUrl(): string {
    return this.localUrl;
  }

  public connect(options: ConnectOptions): void {
    this.activeOptions = options;
    this.spawnTransport();
  }

  public switchMode(newMode: SignalingMode, customLocalUrl?: string): void {
    if (customLocalUrl) {
      this.localUrl = customLocalUrl;
      try {
        localStorage.setItem("omnidesk_signaling_url", customLocalUrl);
      } catch {}
    }

    this.mode = newMode;
    try {
      localStorage.setItem("omnidesk_signaling_mode", newMode);
    } catch {}

    if (this.currentTransport) {
      this.currentTransport.disconnect();
      this.currentTransport = null;
    }

    if (this.activeOptions) {
      this.spawnTransport();
    }
  }

  private spawnTransport(): void {
    if (!this.activeOptions) return;

    if (this.mode === "cloud") {
      this.currentTransport = new CloudWSSSignaling(this.handlers);
    } else {
      this.currentTransport = new LocalSignalingClient(this.localUrl, this.handlers);
    }

    this.currentTransport.connect(this.activeOptions);
  }

  public send(message: SignalingMessage): void {
    this.currentTransport?.send(message);
  }

  public disconnect(): void {
    this.currentTransport?.disconnect();
    this.currentTransport = null;
  }
}
