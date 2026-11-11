# OmniDesk 🖥️⚡

> **Acesso Remoto P2P de Ultra-Baixa Latência, Zero-Trust e Criptografia Ponta a Ponta**  
> Sucessor corporativo e alternativa Open-Source moderna a AnyDesk e TeamViewer.

[![PWA Live](https://img.shields.io/badge/PWA-Live%20on%20Firebase-0284c7?style=flat-square&logo=firebase)](https://omnidesk-remote.web.app)
[![ISO 25010](https://img.shields.io/badge/ISO%2FIEC-25010%3A2023%20Audited-emerald?style=flat-square)](./RELATORIO_QUALIDADE_ISO25010.md)
[![ISO 9001](https://img.shields.io/badge/ISO-9001%3A2026%20Compliant-blue?style=flat-square)](./SISTEMA_GESTAO_QUALIDADE_ISO9001.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---

## 🚀 Acesso Imediato & Instalação

- **PWA Web App Oficial:** [https://omnidesk-remote.web.app](https://omnidesk-remote.web.app)
- **Instalação:** Abra o link no Chrome, Edge ou Brave e clique no botão **"Instalar OmniDesk"** na barra de navegação para ter a experiência de aplicativo nativo de desktop em tela cheia.

---

## 🌟 Principais Recursos

- **Zero-Latency P2P WebRTC Pipeline:** Streaming de vídeo a 60 FPS com codec VP9/AV1 e canais de dados dedicados (`omnidesk-control` e `omnidesk-files`).
- **Segurança Zero-Trust:** Criptografia ponta a ponta com autenticação de desafio PBKDF2-SHA256 (600.000 iterações), nonces anti-replay de 32 bytes e comparação de tempo constante para proteção contra timing attacks.
- **Controle de Acesso Granular (ACL):** Host possui controle rigoroso por sessão sobre Mouse/Teclado, Área de Transferência, Envio de Arquivos e Áudio, com botão de emergência instantâneo (*Panic Button*).
- **Transferência de Arquivos Segura:** Chunking de 64 KB com controle de fluxo por backpressure (`bufferedAmountLowThreshold`) e validação de integridade por hash SHA-256 no destino.
- **PWA Offline-First:** Service Worker com cache resiliente e suporte para instalação em qualquer sistema operacional (Windows, Linux, macOS, Android, iOS).
- **Core Desktop Nativo:** Arquitetura híbrida pronta para Tauri v2 em Rust para injeção de hardware de alta performance no Windows, Linux e macOS.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend & PWA:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Vite
- **Networking & Signaling:** Bun WebSocket Signaling Server (Porta 4000)
- **P2P & Streaming:** WebRTC (PeerConnection, DataChannels SCTP, MediaStream API)
- **Desktop Runtime:** Tauri v2 (Rust 2021)
- **Qualidade & Testes:** Bun Test Runner, Playwright E2E

---

## 📦 Como Executar Localmente

### Pré-requisitos
- [Bun](https://bun.sh) instalado (`v1.2+`)

### Instalação e Execução

```bash
# 1. Clonar repositório
git clone https://github.com/wallacextreme/omnidesk.git
cd omnidesk

# 2. Instalar dependências
bun install

# 3. Iniciar Servidor de Sinalização (Terminal 1)
bun run server

# 4. Iniciar Frontend Vite (Terminal 2)
bun run dev --host
```

Acesse a aplicação em `http://localhost:5173`.

---

## 🧪 Suíte de Testes

```bash
# Executar testes unitários (criptografia, ACL, protocolo, WebRTC)
bun test:unit

# Executar testes E2E Playwright (fluxo completo de conexão remota)
bun run test:e2e
```

---

## 📑 Normas e Documentações Técnicas

- [Manual do Usuário Passo a Passo](./MANUAL_DO_USUARIO.md)
- [Relatório de Qualidade de Software ISO/IEC 25010:2023](./RELATORIO_QUALIDADE_ISO25010.md)
- [Sistema de Gestão da Qualidade ISO 9001:2026](./SISTEMA_GESTAO_QUALIDADE_ISO9001.md)
- [Auditoria de Segurança e Threat Model](./SECURITY_AND_ARCHITECTURE_AUDIT.md)

---

## 📄 Licença
Distribuído sob licença MIT. Desenvolvido com foco em excelência e conformidade normativa internacional.
