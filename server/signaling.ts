import type { ServerWebSocket } from "bun";
import {
  SignalingMessageSchema,
  normalizeDeviceId,
  isValidDeviceId,
  type SignalingMessage,
  type ACLPermissions,
} from "../src/shared/protocol";
import { constantTimeCompare } from "../src/core/crypto";

export interface WSClientData {
  id: string;
  ip: string;
  isRegistered: boolean;
  deviceName: string;
  unattendedEnabled: boolean;
  passwordHash?: string;
  hostSecret?: string;
}

export class RateLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 10000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public isRateLimited(key: string): boolean {
    const now = Date.now();
    const entry = this.requests.get(key);
    if (!entry || now > entry.resetAt) {
      this.requests.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    entry.count++;
    return entry.count > this.maxRequests;
  }

  public clear(): void {
    this.requests.clear();
  }
}

export class SignalingServer {
  private port: number;
  private server: ReturnType<typeof Bun.serve<WSClientData>> | null = null;
  private hosts = new Map<string, ServerWebSocket<WSClientData>>();
  private rateLimiter: RateLimiter;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(port = 4000, rateLimiter = new RateLimiter(150, 10000)) {
    this.port = port;
    this.rateLimiter = rateLimiter;
  }

  public start(): ReturnType<typeof Bun.serve<WSClientData>> {
    const self = this;

    this.server = Bun.serve<WSClientData>({
      port: this.port,
      hostname: "0.0.0.0",
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ status: "healthy", hostsCount: self.hosts.size }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Get remote IP
        const clientIp = server.requestIP(req)?.address || "127.0.0.1";

        if (self.rateLimiter.isRateLimited(clientIp)) {
          return new Response("Too Many Requests", { status: 429 });
        }

        const upgraded = server.upgrade(req, {
          data: {
            id: "",
            ip: clientIp,
            isRegistered: false,
            deviceName: "Unknown Device",
            unattendedEnabled: false,
          },
        });

        if (upgraded) {
          return undefined;
        }

        return new Response("OmniDesk Signaling Gateway", { status: 200 });
      },
      websocket: {
        open(ws) {
          // Socket opened, awaiting registration
        },
        message(ws, rawMessage) {
          self.handleMessage(ws, rawMessage);
        },
        close(ws) {
          self.handleDisconnect(ws);
        },
      },
    });

    this.pingInterval = setInterval(() => {
      for (const [id, hostWs] of self.hosts.entries()) {
        try {
          if (hostWs.readyState === 1) {
            hostWs.send(JSON.stringify({ type: "ping" }));
          } else {
            self.hosts.delete(id);
          }
        } catch {
          self.hosts.delete(id);
        }
      }
    }, 30000);

    console.log(`[OmniDesk Signaling] Server listening on ws://localhost:${this.port}`);
    return this.server;
  }

  public stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.hosts.clear();
    this.rateLimiter.clear();
  }

  public getRegisteredHostsCount(): number {
    return this.hosts.size;
  }

  public isHostRegistered(id: string): boolean {
    return this.hosts.has(normalizeDeviceId(id));
  }

  private generateUniqueId(): string {
    let attempts = 0;
    while (attempts < 10000) {
      // 9 digits between 100000000 and 999999999
      const randomNum = Math.floor(100000000 + Math.random() * 900000000);
      const candidate = randomNum.toString();
      if (!this.hosts.has(candidate)) {
        return candidate;
      }
      attempts++;
    }
    throw new Error("ID space exhausted or collision threshold reached");
  }

  private sendJson(ws: ServerWebSocket<WSClientData>, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error("[Signaling] Failed to send JSON to client:", err);
    }
  }

  private handleDisconnect(ws: ServerWebSocket<WSClientData>): void {
    if (ws.data.id && this.hosts.get(ws.data.id) === ws) {
      this.hosts.delete(ws.data.id);
      console.log(`[Signaling] Host ${ws.data.id} disconnected. Total active: ${this.hosts.size}`);
    }
  }

  private handleMessage(ws: ServerWebSocket<WSClientData>, rawMessage: string | Buffer): void {
    // Rate limit per IP
    if (this.rateLimiter.isRateLimited(ws.data.ip)) {
      this.sendJson(ws, {
        type: "error",
        code: "RATE_LIMITED",
        message: "Too many messages sent. Please slow down.",
      });
      return;
    }

    let parsedJson: unknown;
    try {
      const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf-8");
      parsedJson = JSON.parse(text);
    } catch {
      this.sendJson(ws, {
        type: "error",
        code: "INVALID_JSON",
        message: "Message must be valid JSON.",
      });
      return;
    }

    const validation = SignalingMessageSchema.safeParse(parsedJson);
    if (!validation.success) {
      this.sendJson(ws, {
        type: "error",
        code: "INVALID_PAYLOAD",
        message: `Schema validation failed: ${validation.error.issues.map((i) => i.message).join(", ")}`,
      });
      return;
    }

    const msg: SignalingMessage = validation.data;

    switch (msg.type) {
      case "ping": {
        this.sendJson(ws, { type: "pong" });
        break;
      }

      case "pong": {
        // Heartbeat ack
        break;
      }

      case "register-host": {
        let assignedId = "";
        if (msg.deviceId) {
          const normalized = normalizeDeviceId(msg.deviceId);
          if (isValidDeviceId(normalized)) {
            const existing = this.hosts.get(normalized);
            if (existing && existing !== ws) {
              // ID Hijacking Protection: verify hostSecret if already claimed
              const existingSecret = existing.data.hostSecret;
              const matchesSecret =
                existingSecret &&
                msg.hostSecret &&
                constantTimeCompare(existingSecret, msg.hostSecret);

              if (matchesSecret || !existingSecret) {
                try {
                  existing.close();
                } catch {}
                this.hosts.delete(normalized);
                assignedId = normalized;
              } else {
                console.warn(
                  `[Signaling] Prevented ID Hijacking attempt on ${normalized}. Assigning new unique ID.`
                );
                assignedId = this.generateUniqueId();
              }
            } else {
              assignedId = normalized;
            }
          }
        }

        if (!assignedId) {
          assignedId = this.generateUniqueId();
        }

        ws.data.id = assignedId;
        ws.data.isRegistered = true;
        ws.data.deviceName = msg.deviceName;
        ws.data.unattendedEnabled = msg.unattendedEnabled;
        if (msg.hostSecret) {
          ws.data.hostSecret = msg.hostSecret;
        }
        if (msg.passwordHash !== undefined) {
          ws.data.passwordHash = msg.passwordHash;
        }

        this.hosts.set(assignedId, ws);

        this.sendJson(ws, {
          type: "registered",
          deviceId: assignedId,
          success: true,
        });

        console.log(`[Signaling] Host registered: ${assignedId} (${msg.deviceName}). Total: ${this.hosts.size}`);
        break;
      }

      case "peer-status-request": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        const online = Boolean(targetWs);
        const deviceName = targetWs?.data.deviceName;

        this.sendJson(ws, {
          type: "peer-status-response",
          targetId: targetNormalized,
          online,
          ...(deviceName ? { deviceName } : {}),
        });
        break;
      }

      case "session-request": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const senderId = ws.data.id || msg.clientDeviceId;

        if (targetNormalized === senderId) {
          this.sendJson(ws, {
            type: "session-rejected",
            targetId: targetNormalized,
            reason: "Não é possível conectar a este mesmo computador. Para testar o acesso remoto, conecte-se a partir de outro computador ou dispositivo (ex: celular ou outro PC na rede Wi-Fi).",
          });
          return;
        }

        const targetWs = this.hosts.get(targetNormalized);

        if (!targetWs) {
          this.sendJson(ws, {
            type: "session-rejected",
            targetId: targetNormalized,
            reason: "Dispositivo remoto está offline ou ID não existe.",
          });
          return;
        }

        // Forward to the target host with client's device ID
        this.sendJson(targetWs, {
          type: "session-request",
          targetId: targetNormalized,
          clientName: msg.clientName,
          clientDeviceId: senderId,
          hasUnattendedPassword: msg.hasUnattendedPassword,
        });
        break;
      }

      case "auth-challenge": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, msg);
        }
        break;
      }

      case "auth-response": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, msg);
        }
        break;
      }

      case "session-accepted": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, msg);
        }
        break;
      }

      case "session-rejected": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, msg);
        }
        break;
      }

      case "webrtc-signal": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, {
            type: "webrtc-signal",
            targetId: targetNormalized,
            senderId: ws.data.id || msg.senderId,
            signal: msg.signal,
          });
        } else {
          this.sendJson(ws, {
            type: "error",
            code: "PEER_NOT_FOUND",
            message: `Target peer ${targetNormalized} is not reachable.`,
          });
        }
        break;
      }

      case "session-close": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, msg);
        }
        break;
      }

      case "video-frame": {
        if (msg.targetId) {
          const targetNormalized = normalizeDeviceId(msg.targetId);
          const targetWs = this.hosts.get(targetNormalized);
          if (targetWs) {
            this.sendJson(targetWs, msg);
          }
        }
        break;
      }

      case "video-frame-chunk":
      case "video-status":
      case "control-relay": {
        const targetNormalized = normalizeDeviceId(msg.targetId);
        const targetWs = this.hosts.get(targetNormalized);
        if (targetWs) {
          this.sendJson(targetWs, {
            ...msg,
            senderId: ws.data.id || msg.senderId,
          });
        }
        break;
      }

      default: {
        this.sendJson(ws, {
          type: "error",
          code: "UNHANDLED_TYPE",
          message: "Unhandled message type.",
        });
      }
    }
  }
}

// Standalone execution entrypoint
if (import.meta.main) {
  const port = Number(process.env.PORT) || 4000;
  const server = new SignalingServer(port);
  server.start();

  const handleShutdown = () => {
    console.log("\n[Signaling] Shutting down gracefully...");
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}
