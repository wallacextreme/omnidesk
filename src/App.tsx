import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dashboard, type RecentSession } from "./components/Dashboard";
import { IncomingRequestModal } from "./components/IncomingRequestModal";
import { RemoteSessionViewport } from "./components/RemoteSessionViewport";
import { WebRTCManager, type TelemetryStats } from "./core/webrtc-manager";
import { ACLGuard } from "./core/acl-guard";
import { FileSender, FileReceiver, type FileTransferProgress } from "./core/file-transfer";
import { nativeBridge } from "./core/native-bridge";
import {
  generateNonce,
  generateSalt,
  computeAuthProof,
  verifyAuthProof,
  safeRandomUUID,
  isSubtleAvailable,
} from "./core/crypto";
import {
  SignalingClient,
  type SignalingMode,
  type SignalingStatus,
  getOrCreateHostSecret,
} from "./core/signaling-client";
import {
  DEFAULT_ACL_PERMISSIONS,
  normalizeDeviceId,
  formatDeviceId,
  parseSignalingMessage,
  type ACLPermissions,
  type ChatMessagePacket,
  type InputPacket,
  type SignalingMessage,
} from "./shared/protocol";

function getInitialSignalingUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000";

  try {
    const saved = localStorage.getItem("omnidesk_signaling_url");
    if (saved) return saved;
  } catch {}

  const loc = window.location;
  const isLocalOrLan =
    loc.hostname === "localhost" ||
    loc.hostname === "127.0.0.1" ||
    loc.hostname.startsWith("192.168.") ||
    loc.hostname.startsWith("10.") ||
    loc.hostname.startsWith("172.");

  if (isLocalOrLan) {
    return `ws://${loc.hostname}:4000`;
  }

  return loc.protocol === "https:"
    ? `wss://${loc.hostname}:4000`
    : `ws://${loc.hostname}:4000`;
}

export const App: React.FC = () => {
  const [signalingUrl, setSignalingUrl] = useState<string>(getInitialSignalingUrl);

  const handleUpdateSignalingUrl = useCallback((url: string) => {
    setSignalingUrl(url);
    try {
      localStorage.setItem("omnidesk_signaling_url", url);
    } catch {}
  }, []);

  // Device & Host State (synchronously loaded from storage to maintain ID stability)
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem("omnidesk_device_id") || localStorage.getItem("pulsedesk_device_id") || "";
      } catch {}
    }
    return "";
  });

  const [deviceName] = useState<string>(() => {
    if (typeof navigator !== "undefined") {
      let saved = "";
      try {
        saved = localStorage.getItem("omnidesk_device_name") || localStorage.getItem("pulsedesk_device_name") || "";
      } catch {}
      if (saved) return saved;
      const gen = `OmniNode-${Math.floor(100 + Math.random() * 900)}`;
      try {
        localStorage.setItem("omnidesk_device_name", gen);
      } catch {}
      return gen;
    }
    return "OmniDesk-Node";
  });

  const [isSignalingOnline, setIsSignalingOnline] = useState<boolean>(false);
  const [unattendedPassword, setUnattendedPassword] = useState<string>("");
  const [defaultAcl, setDefaultAcl] = useState<ACLPermissions>({ ...DEFAULT_ACL_PERMISSIONS });
  const [useSyntheticStream, setUseSyntheticStream] = useState<boolean>(() => {
    return nativeBridge.isForceSyntheticStream();
  });

  // Incoming Connection Request Modal (Host-Side)
  const [incomingRequest, setIncomingRequest] = useState<{
    clientDeviceId: string;
    clientName: string;
    hasUnattendedPassword: boolean;
  } | null>(null);

  // Active Session State
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [sessionRole, setSessionRole] = useState<"host" | "client" | null>(null);
  const [remotePeerId, setRemotePeerId] = useState<string>("");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Telemetry & Permissions
  const [telemetry, setTelemetry] = useState<TelemetryStats>({
    rttMs: 15,
    fps: 60,
    bitrateKbps: 2400,
    packetLossPercent: 0,
  });
  const [activeAcl, setActiveAcl] = useState<ACLPermissions>({ ...DEFAULT_ACL_PERMISSIONS });

  // Chat & File Transfer State
  const [chatMessages, setChatMessages] = useState<ChatMessagePacket[]>([]);
  const [activeTransferProgress, setActiveTransferProgress] = useState<FileTransferProgress | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<
    Array<{ name: string; size: number; blob: Blob; sha256: string }>
  >([]);

  // Recent Sessions History
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => {
    if (typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("omnidesk_recent_sessions") || localStorage.getItem("pulsedesk_recent_sessions");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });

  // Refs for persistent state without re-triggering effects
  const [signalingMode, setSignalingMode] = useState<SignalingMode>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("omnidesk_signaling_mode");
      if (saved === "cloud" || saved === "local") return saved;
    }
    return "cloud";
  });
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus | null>(null);

  const deviceIdRef = useRef<string>(deviceId);
  const unattendedPasswordRef = useRef<string>(unattendedPassword);
  const defaultAclRef = useRef<ACLPermissions>(defaultAcl);
  const signalingClientRef = useRef<SignalingClient | null>(null);
  const hostSecretRef = useRef<string>(getOrCreateHostSecret());
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const aclGuardRef = useRef<ACLGuard>(new ACLGuard(DEFAULT_ACL_PERMISSIONS));
  const fileSenderRef = useRef<FileSender | null>(null);
  const fileReceiverRef = useRef<FileReceiver | null>(null);
  const currentChallengeRef = useRef<{
    nonce: string;
    salt: string;
    clientDeviceId: string;
    iterations?: number;
  } | null>(null);
  const pendingPasswordRef = useRef<string>("");

  // Sync state to refs
  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => {
    unattendedPasswordRef.current = unattendedPassword;
    if (signalingClientRef.current && deviceIdRef.current) {
      signalingClientRef.current.send({
        type: "register-host",
        deviceId: deviceIdRef.current,
        deviceName,
        unattendedEnabled: Boolean(unattendedPassword),
        hostSecret: hostSecretRef.current,
      });
    }
  }, [unattendedPassword, deviceName]);

  useEffect(() => {
    defaultAclRef.current = defaultAcl;
  }, [defaultAcl]);

  // Persist recent sessions
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("omnidesk_recent_sessions", JSON.stringify(recentSessions));
    }
  }, [recentSessions]);

  // Send signaling message helper
  const sendSignaling = useCallback((msg: SignalingMessage) => {
    signalingClientRef.current?.send(msg);
  }, []);

  const handleSwitchSignalingMode = useCallback((mode: SignalingMode, customUrl?: string) => {
    setSignalingMode(mode);
    if (customUrl) {
      setSignalingUrl(customUrl);
    }
    signalingClientRef.current?.switchMode(mode, customUrl);
  }, []);

  // WebRTC Setup Helper
  const setupWebRTC = useCallback(
    async (role: "host" | "client", targetId: string) => {
      if (webrtcRef.current) {
        webrtcRef.current.close();
      }

      const myDeviceId = deviceIdRef.current;

      const manager = new WebRTCManager({
        onSignal: (signal) => {
          sendSignaling({
            type: "webrtc-signal",
            targetId,
            senderId: myDeviceId,
            signal,
          });
        },
        onRemoteStream: (stream) => {
          setRemoteStream(stream);
        },
        onTelemetry: (stats) => {
          setTelemetry(stats);
        },
        onConnectionStateChange: (state) => {
          if (state === "disconnected" || state === "failed" || state === "closed") {
            handleEndSession();
          }
        },
        onControlPacket: (packet) => {
          // If host, verify ACL before injecting
          if (role === "host") {
            if (packet.kind === "acl-update") {
              aclGuardRef.current.setAll(packet.permissions);
              setActiveAcl(packet.permissions);
              return;
            }

            if (!aclGuardRef.current.canExecuteControlPacket(packet)) {
              return; // Dropped by Zero-Trust ACL Guard
            }

            if (packet.kind === "chat-message") {
              setChatMessages((prev) => [...prev, packet]);
              return;
            }

            if (packet.kind.startsWith("mouse-") || packet.kind.startsWith("key-") || packet.kind === "special-key") {
              nativeBridge.injectInput(packet as InputPacket);
            }
          } else {
            // Client side receiving packets
            if (packet.kind === "acl-update") {
              setActiveAcl(packet.permissions);
            } else if (packet.kind === "chat-message") {
              setChatMessages((prev) => [...prev, packet]);
            }
          }
        },
        onTransferPacket: (packet) => {
          if (role === "host" && !aclGuardRef.current.canExecuteTransferPacket(packet)) {
            return; // Dropped by ACL Guard
          }
          fileReceiverRef.current?.handlePacket(packet);
        },
      });

      webrtcRef.current = manager;

      // File transfer handlers
      fileSenderRef.current = new FileSender({
        sendPacket: (pkt) => manager.sendTransferPacket(pkt),
        getBufferedAmount: () => manager.getTransferBufferedAmount(),
        onProgress: (prog) => setActiveTransferProgress({ ...prog }),
      });

      fileReceiverRef.current = new FileReceiver({
        sendPacket: (pkt) => manager.sendTransferPacket(pkt),
        onProgress: (prog) => setActiveTransferProgress({ ...prog }),
        onFileReceived: (file) => {
          setReceivedFiles((prev) => [file, ...prev]);
        },
      });

      if (role === "host") {
        await manager.initializeAsHost();
      } else {
        await manager.initializeAsClient();
      }

      setSessionRole(role);
      setRemotePeerId(targetId);
      setSessionActive(true);
      setIsConnecting(false);
    },
    [sendSignaling]
  );

  const setupWebRTCRef = useRef(setupWebRTC);
  setupWebRTCRef.current = setupWebRTC;

  // Initialize Signaling Connection ONCE on mount
  useEffect(() => {
    const client = new SignalingClient(
      {
        onStatusChange: (status) => {
          setIsSignalingOnline(status.online);
          setSignalingStatus(status);
        },
        onRegistered: (registeredId) => {
          setDeviceId(registeredId);
          deviceIdRef.current = registeredId;
          try {
            localStorage.setItem("omnidesk_device_id", registeredId);
          } catch {}
        },
        onMessage: async (msg) => {
          try {
            switch (msg.type) {
              case "registered": {
                setDeviceId(msg.deviceId);
                deviceIdRef.current = msg.deviceId;
                try {
                  localStorage.setItem("omnidesk_device_id", msg.deviceId);
                } catch {}
                break;
              }

              case "session-request": {
                // Host receives connection request from client
                if (msg.hasUnattendedPassword && unattendedPasswordRef.current) {
                  // Unattended challenge flow
                  const nonce = generateNonce(32);
                  const salt = generateSalt(16);
                  const iterations = isSubtleAvailable ? 600_000 : 2_000;
                  currentChallengeRef.current = {
                    nonce,
                    salt,
                    clientDeviceId: msg.clientDeviceId,
                    iterations,
                  };
                  sendSignaling({
                    type: "auth-challenge",
                    targetId: msg.clientDeviceId,
                    senderId: deviceIdRef.current,
                    nonce,
                    salt,
                    iterations,
                  });
                } else {
                  // Manual modal prompt
                  setIncomingRequest({
                    clientDeviceId: msg.clientDeviceId,
                    clientName: msg.clientName,
                    hasUnattendedPassword: msg.hasUnattendedPassword,
                  });
                }
                break;
              }

              case "auth-challenge": {
                // Client receives challenge from host
                const pwd = pendingPasswordRef.current;
                if (pwd) {
                  const proof = await computeAuthProof(pwd, msg.salt, msg.nonce, msg.iterations);
                  sendSignaling({
                    type: "auth-response",
                    targetId: msg.senderId,
                    senderId: deviceIdRef.current,
                    proof,
                  });
                } else {
                  sendSignaling({
                    type: "session-rejected",
                    targetId: msg.senderId,
                    reason: "Senha de acesso desassistido requerida mas não fornecida.",
                  });
                }
                break;
              }

              case "auth-response": {
                // Host receives proof from client
                const challenge = currentChallengeRef.current;
                if (challenge && challenge.clientDeviceId === msg.senderId) {
                  const isValid = await verifyAuthProof(
                    unattendedPasswordRef.current,
                    challenge.salt,
                    challenge.nonce,
                    msg.proof,
                    challenge.iterations
                  );

                  if (isValid) {
                    // Approved!
                    sendSignaling({
                      type: "session-accepted",
                      targetId: msg.senderId,
                      senderId: deviceIdRef.current,
                      permissions: defaultAclRef.current,
                    });
                    await setupWebRTCRef.current("host", msg.senderId);
                  } else {
                    sendSignaling({
                      type: "session-rejected",
                      targetId: msg.senderId,
                      reason: "Senha de acesso desassistido incorreta.",
                    });
                  }
                  currentChallengeRef.current = null;
                }
                break;
              }

              case "session-accepted": {
                // Client receives acceptance from host
                setActiveAcl(msg.permissions);
                aclGuardRef.current.setAll(msg.permissions);
                await setupWebRTCRef.current("client", msg.senderId);
                break;
              }

              case "session-rejected": {
                setIsConnecting(false);
                alert(`Conexão recusada: ${msg.reason}`);
                break;
              }

              case "webrtc-signal": {
                if (webrtcRef.current) {
                  await webrtcRef.current.handleRemoteSignal(msg.signal);
                }
                break;
              }

              case "session-close": {
                handleEndSession();
                break;
              }
            }
          } catch (err) {
            console.error("[Signaling] Message error:", err);
          }
        },
      },
      signalingMode,
      signalingUrl
    );

    signalingClientRef.current = client;

    client.connect({
      deviceId: deviceIdRef.current || undefined,
      deviceName,
      unattendedEnabled: Boolean(unattendedPasswordRef.current),
      hostSecret: hostSecretRef.current,
    });

    return () => {
      client.disconnect();
      signalingClientRef.current = null;
    };
  }, [signalingMode, signalingUrl, deviceName, sendSignaling]);

  // Client Initiates Connection
  const handleConnect = (targetRaw: string, password?: string) => {
    const targetId = normalizeDeviceId(targetRaw);
    if (!targetId || targetId === deviceIdRef.current) {
      alert(
        "Você digitou o ID deste próprio dispositivo!\n\n" +
        "• Para testar com 2 computadores reais: conecte-se a partir de outro PC ou smartphone na mesma rede.\n" +
        "• Para testar neste mesmo computador sem o efeito de espelho infinito: ative a opção 'Simulação (1 PC)' no painel esquerdo."
      );
      return;
    }

    setIsConnecting(true);
    pendingPasswordRef.current = password || unattendedPassword;

    // Save to recents
    setRecentSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== targetId);
      return [
        {
          id: targetId,
          name: `Remoto ${formatDeviceId(targetId)}`,
          lastConnected: Date.now(),
          favorite: prev.find((s) => s.id === targetId)?.favorite ?? false,
        },
        ...filtered,
      ].slice(0, 10);
    });

    sendSignaling({
      type: "session-request",
      targetId,
      clientName: deviceName,
      clientDeviceId: deviceIdRef.current,
      hasUnattendedPassword: Boolean(password || unattendedPassword),
    });
  };

  // Host Approves Connection via Modal
  const handleAcceptIncoming = async (customPermissions: ACLPermissions) => {
    if (!incomingRequest) return;
    const client = incomingRequest.clientDeviceId;
    setIncomingRequest(null);

    aclGuardRef.current.setAll(customPermissions);
    setActiveAcl(customPermissions);

    sendSignaling({
      type: "session-accepted",
      targetId: client,
      senderId: deviceIdRef.current,
      permissions: customPermissions,
    });

    await setupWebRTC("host", client);
  };

  // Host Rejects Connection via Modal
  const handleRejectIncoming = (reason: string) => {
    if (!incomingRequest) return;
    sendSignaling({
      type: "session-rejected",
      targetId: incomingRequest.clientDeviceId,
      senderId: deviceIdRef.current,
      reason,
    });
    setIncomingRequest(null);
  };

  // Toggle Input Block in real time (Host ACL Guard)
  const handleToggleInputBlock = () => {
    const newPerms = { ...activeAcl, allowInput: !activeAcl.allowInput };
    setActiveAcl(newPerms);
    aclGuardRef.current.updatePermissions(newPerms);

    if (webrtcRef.current) {
      webrtcRef.current.sendControlPacket({
        kind: "acl-update",
        permissions: newPerms,
      });
    }
  };

  // Send input packet (Client -> Host)
  const handleSendInputPacket = (packet: InputPacket) => {
    if (webrtcRef.current && activeAcl.allowInput) {
      webrtcRef.current.sendControlPacket(packet);
    }
  };

  // Send Special Key
  const handleSendSpecialKey = (action: "ctrl-alt-del" | "lock" | "esc") => {
    if (webrtcRef.current) {
      webrtcRef.current.sendControlPacket({
        kind: "special-key",
        action,
      });
    }
  };

  // Send Chat Message
  const handleSendChatMessage = (text: string) => {
    const packet: ChatMessagePacket = {
      kind: "chat-message",
      id: safeRandomUUID(),
      sender: deviceName,
      text,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, packet]);
    webrtcRef.current?.sendControlPacket(packet);
  };

  // Send File
  const handleSendFile = async (file: File) => {
    if (!fileSenderRef.current || !activeAcl.allowFileTransfer) {
      alert("Transferência de arquivos não permitida pelo Host nesta sessão.");
      return;
    }
    try {
      await fileSenderRef.current.sendFile(file);
    } catch (err) {
      console.error("[App] Send file failed:", err);
    }
  };

  // Toggle Synthetic Stream
  const handleToggleSyntheticStream = (enabled: boolean) => {
    nativeBridge.setForceSyntheticStream(enabled);
    setUseSyntheticStream(enabled);
  };

  // Terminate Active Session
  const handleEndSession = () => {
    if (remotePeerId) {
      sendSignaling({
        type: "session-close",
        targetId: remotePeerId,
        senderId: deviceIdRef.current,
        reason: "Sessão encerrada pelo usuário.",
      });
    }

    webrtcRef.current?.close();
    webrtcRef.current = null;
    fileSenderRef.current = null;
    fileReceiverRef.current = null;
    setSessionActive(false);
    setSessionRole(null);
    setRemotePeerId("");
    setRemoteStream(null);
    setIsConnecting(false);
    setChatMessages([]);
    setActiveTransferProgress(null);
  };

  return (
    <div className="w-full min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-center">
      {/* 1. Active Remote Session Viewport */}
      {sessionActive ? (
        <RemoteSessionViewport
          remoteStream={remoteStream}
          telemetry={telemetry}
          permissions={activeAcl}
          onSendInputPacket={handleSendInputPacket}
          onToggleInputBlock={handleToggleInputBlock}
          onSendSpecialKey={handleSendSpecialKey}
          onEndSession={handleEndSession}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChatMessage}
          localSenderName={deviceName}
          activeTransferProgress={activeTransferProgress}
          onSendFile={handleSendFile}
          receivedFiles={receivedFiles}
          isHost={sessionRole === "host"}
        />
      ) : (
        /* 2. Main AnyDesk Dashboard */
        <Dashboard
          deviceId={deviceId}
          isSignalingOnline={isSignalingOnline}
          signalingMode={signalingMode}
          signalingStatus={signalingStatus}
          onSwitchSignalingMode={handleSwitchSignalingMode}
          unattendedPassword={unattendedPassword}
          onUpdateUnattendedPassword={setUnattendedPassword}
          defaultAcl={defaultAcl}
          onUpdateDefaultAcl={(acl) => setDefaultAcl((prev) => ({ ...prev, ...acl }))}
          onConnect={handleConnect}
          recentSessions={recentSessions}
          onToggleFavorite={(id) =>
            setRecentSessions((prev) =>
              prev.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s))
            )
          }
          onRemoveRecent={(id) =>
            setRecentSessions((prev) => prev.filter((s) => s.id !== id))
          }
          isConnecting={isConnecting}
          useSyntheticStream={useSyntheticStream}
          onToggleSyntheticStream={handleToggleSyntheticStream}
          signalingUrl={signalingUrl}
          onUpdateSignalingUrl={handleUpdateSignalingUrl}
        />
      )}

      {/* 3. Incoming Connection Request Modal */}
      {incomingRequest && (
        <IncomingRequestModal
          clientDeviceId={incomingRequest.clientDeviceId}
          clientName={incomingRequest.clientName}
          defaultPermissions={defaultAcl}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
        />
      )}
    </div>
  );
};
