import React, { useState, useRef, useEffect } from "react";
import { X, Send, MessageSquare } from "lucide-react";
import type { ChatMessagePacket } from "../shared/protocol";

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessagePacket[];
  onSendMessage: (text: string) => void;
  localSenderName: string;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  localSenderName,
}) => {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-80 sm:w-96 bg-slate-900/95 border-l border-slate-800 backdrop-blur-2xl z-50 flex flex-col shadow-2xl animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">Chat da Sessão</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
            <MessageSquare className="w-8 h-8 opacity-20 mb-2" />
            <p className="text-xs">Nenhuma mensagem ainda.</p>
            <p className="text-[10px] text-slate-600 mt-1">Converse com o outro dispositivo em tempo real.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === localSenderName;
            return (
              <div
                key={msg.id}
                data-testid="chat-message-item"
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] text-slate-400 mb-0.5 px-1">{msg.sender}</span>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${isMe ? "bg-cyan-500 text-slate-950 font-medium rounded-tr-none" : "bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/80"}`}
                >
                  {msg.text}
                </div>
                <span className="text-[9px] text-slate-500 mt-0.5 px-1 font-mono">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <input
            data-testid="chat-input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Digite uma mensagem..."
            className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            data-testid="chat-send-btn"
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-medium transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
