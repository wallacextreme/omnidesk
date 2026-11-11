# 🏛️ Sistema de Gestão da Qualidade — Alinhamento à ISO 9001:2026 — OmniDesk Pro

**Documento:** SGQ-TEC-001  
**Versão do Documento:** 1.0  
**Data:** 11 de Novembro de 2026  
**Norma de Referência:** ABNT NBR ISO 9001:2026 (*Sistemas de Gestão da Qualidade — Requisitos*, 6ª edição, publicada em 16 de setembro de 2026)  
**Aplicação/Produto:** OmniDesk Pro (Desktop & Web/PWA)

---

## 1. Introdução e Escopo

### 1.1. Finalidade deste Documento
Este documento estrutura e formaliza as práticas de engenharia de software, controle documental e rotinas de qualidade observadas no repositório do **OmniDesk Pro**, alinhando-as aos blocos temáticos e requisitos da norma **ISO 9001:2026**. Ele serve como ponto de partida técnico e alicerce para a implantação formal de um Sistema de Gestão da Qualidade (SGQ) na organização.

### 1.2. Escopo Técnico
Engenharia, desenvolvimento, testes automatizados, controle de versão, empacotamento desktop (Tauri v2) e disponibilização web/PWA da aplicação de acesso remoto seguro **OmniDesk Pro**.

### 1.3. Convenção de Distinção de Conteúdo
Para garantir total honestidade e conformidade com auditorias reais, este documento utiliza os seguintes marcadores:
- 🔧 **Evidenciado via Código:** Práticas, procedimentos e rotinas que possuem comprovação direta nos arquivos, scripts, configurações e testes do repositório.
- 📝 **Requer Definição pela Organização:** Diretrizes de governança corporativa, liderança, competências humanas e políticas que só podem ser estabelecidas pela diretoria e equipe humana da empresa. Nesses tópicos, fornecem-se modelos e perguntas norteadoras sem conteúdo fictício.

---

## 2. Contexto da Organização

### 2.1. Descrição Técnica do Produto e Partes Interessadas (🔧 Evidenciado via Código)
- **Produto:** Software utilitário híbrido (Desktop Windows via Tauri v2 e PWA via navegadores modernos) para transmissão de tela, controle de ponteiro/teclado e transferência de arquivos ponto a ponto (P2P).
- **Partes Interessadas Técnicas Mapeadas:**
  - *Usuários Operadores / Controladores (Clientes):* Demandam baixa latência (<30ms), resposta imediata de mouse e feedback de status de conexão.
  - *Usuários Finais / Estações de Trabalho (Hosts):* Demandam soberania sobre a máquina, capacidade de revogação de permissões em tempo real (ACL), sigilo de arquivos e proteção contra invasão.
  - *Administradores de Rede / TI:* Demandam ausência de portas abteras na borda, isolamento de tráfego local e empacotamento corporativo via MSI.

### 2.2. Contexto de Negócio e Fatores de Sustentabilidade/Clima (📝 Requer Definição pela Organização)
*(A ser preenchido formalmente pela liderança da empresa em atendimento à ISO 9001:2026)*

- [ ] **Definição das Partes Interessadas de Negócio:**
  - Clientes compradores, órgãos reguladores (ex.: LGPD no Brasil, GDPR na UE), parceiros de distribuição e acionistas.
  - *Responsável pela definição:* `[Nome / Cargo a definir]`
- [ ] **Consideração de Fatores Climáticos e Sustentabilidade (Requisito ISO 9001:2026):**
  - A operação do software (local/P2P vs servidores em nuvem com alto consumo de energia em data centers) impacta metas de redução de pegada de carbono da organização?
  - *Parecer da liderança:* `[A preencher pela organização]`
- [ ] **Declaração Formal de Escopo do SGQ:**
  - *"O Sistema de Gestão da Qualidade da [Nome da Empresa] aplica-se às atividades de design, codificação, garantia da qualidade e suporte ao produto OmniDesk Pro..."*

---

## 3. Liderança e Política da Qualidade

A ISO 9001:2026 enfatiza o papel da alta direção no fomento ativo de uma **cultura da qualidade** e no **comportamento ético** em todos os níveis. Esses compromissos não são inferíveis de código-fonte.

### 3.1. Modelo em Branco para a Política da Qualidade (📝 Requer Definição pela Organização)

```markdown
POLÍTICA DA QUALIDADE DA [NOME DA EMPRESA]

A [Nome da Empresa], atuando no desenvolvimento e licenciamento de softwares de alta criticidade e conectividade remota, compromete-se a:

1. [Definir o compromisso com a satisfação do cliente e disponibilidade do produto]
2. [Definir o compromisso com a proteção de dados e privacidade Zero-Trust]
3. [Definir o compromisso com o atendimento a requisitos legais e regulamentares aplicáveis]
4. [Definir o compromisso com a melhoria contínua dos processos do SGQ e conduta ética da equipe]

Aprovado por: ___________________________   Data: ___/___/______
Cargo: Diretor(a) Executivo(a) / CEO
```

#### Perguntas Orientadoras para a Liderança:
- *Como a liderança demonstra engajamento com a qualidade no dia a dia da equipe técnica?*
- *Existe canal de denúncia ou conduta ética para relatar vulnerabilidades ou desvios de processo?*
- *Como a política da qualidade é comunicada aos novos desenvolvedores e mantenedores?*

---

## 4. Planejamento — Riscos, Oportunidades e Objetivos da Qualidade

### 4.1. Riscos Técnicos e Salvaguardas Implementadas (🔧 Evidenciado via Código)

| Risco Técnico Identificado | Impacto Potencial | Salvaguarda Técnica no Repositório | Arquivo de Evidência |
| :--- | :--- | :--- | :--- |
| **Ataque de Replay na Autenticação** | Invasão de host por interceptação de hash de rede. | Handshake com desafio PBKDF2-SHA256 (100k iterações) + HMAC-SHA256 com nonce aleatório de 32 bytes descartável. | [`src/core/crypto.ts`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/src/core/crypto.ts) |
| **Path Traversal na Recepção de Arquivos** | Sobrescrita de binários do sistema operacional por nomes maliciosos. | Sanitização mandatória com remoção de null bytes, `../` e separadores de pasta. | [`src/core/file-transfer.ts`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/src/core/file-transfer.ts) |
| **Esgotamento de Memória (Buffer Bloat)** | Travamento de abas ou processos ao enviar arquivos grandes via DataChannel. | Controle de *backpressure* com pausa em fila quando o buffer WebRTC atinge 1MB. | [`src/core/file-transfer.ts`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/src/core/file-transfer.ts) |
| **Entrada Insegura de Dados em Tempo de Execução** | Falhas inesperadas por payloads mal formatados. | Validação estrita de todos os pacotes de rede via Discriminated Unions com Zod. | [`src/shared/protocol.ts`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/src/shared/protocol.ts) |

### 4.2. Objetivos Formais da Qualidade de Negócio (📝 Requer Definição pela Organização)
*(A preencher pela organização para medição periódica)*

- **Meta de Confiabilidade:** Índice de falhas em produção não superior a `[X]%` de sessões.
- **Meta de Resolução de Vulnerabilidades:** Bugs críticos de segurança resolvidos em até `[Y]` horas.
- **Meta de Cobertura de Testes Automatizados:** Manter cobertura de testes unitários superior a `[Z]%`.

---

## 5. Apoio — Recursos, Competência e Informação Documentada

### 5.1. Procedimento de Controle de Informação Documentada (🔧 Evidenciado via Código)
- **Código-Fonte e Versionamento:** Controlado via Git com histórico determinístico de commits.
- **Configurações Centralizadas:**
  - Dependências de projeto rastreadas em [`package.json`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/package.json) e bloqueadas via `bun.lock`.
  - Configuração do runtime desktop rastreada em [`src-tauri/tauri.conf.json`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/src-tauri/tauri.conf.json).
  - Parâmetros de compilação em [`tsconfig.json`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/tsconfig.json) e [`vite.config.ts`](file:///c:/Users/Usu/Documents/Workspace%202026/OmniDesk/remote-desk-pro/vite.config.ts).
- **Documentação Técnica Versionada:** Relatórios de arquitetura e manuais armazenados em Markdown diretamente no repositório.

### 5.2. Matriz de Competências e Treinamento (📝 Requer Definição pela Organização)

```markdown
MATRIZ DE COMPETÊNCIA DA EQUIPE DE DESENVOLVIMENTO

| Função / Papel | Competências Mínimas Exigidas | Treinamento Necessário | Responsável |
| :--- | :--- | :--- | :--- |
| Engenheiro(a) Frontend | TypeScript estrito, React 19, WebRTC APIs | Boas práticas de acessibilidade WCAG | [A definir] |
| Engenheiro(a) Rust/Sistemas | Rust 2021, Tauri v2, Win32 APIs, Concorrência | Segurança de memória e auditoria C/Rust | [A definir] |
| Engenheiro(a) de QA | Playwright E2E, Bun Test, Automação CI | Testes de segurança em DataChannels | [A definir] |
```

---

## 6. Operação — Desenvolvimento, Testes e Entrega

Abaixo encontram-se os procedimentos operacionais rascunhados a partir das práticas de engenharia implementadas no projeto:

### 6.1. Procedimento de Controle de Versão (🔧 Evidenciado via Código)
- **Objetivo:** Assegurar rastreabilidade de código e integridade da base principal.
- **Entradas:** Mudança de código, correção de defeito ou nova funcionalidade.
- **Regras Operacionais:**
  - Nenhuma alteração sobe diretamente para `main` sem validação prévia de tipo (`bun run typecheck`).
  - Commits devem expressar o escopo alterado de forma clara e atômica.
- **Saídas:** Branches testadas e tags de release SemVer (`v1.0.0`).

### 6.2. Procedimento de Design e Desenvolvimento (🔧 Evidenciado via Código)
- **Ciclo de Vida Adotado:**
  1. *Definição de Contratos (Type-Driven):* Criar os tipos TypeScript e esquemas Zod em `src/shared/protocol.ts`.
  2. *Implementação de Core Modules:* Desenvolver lógica pura em `src/core/` desacoplada de UI.
  3. *Camada de Apresentação:* Implementar componentes React utilizando o Design System escuro (Slate/Zinc 950).
  4. *Integração com Abstração Nativa:* Conectar via `NativeBridge` garantindo fallback web seguro.

### 6.3. Procedimento de Testes e Validação da Qualidade (🔧 Evidenciado via Código)
- **Execução Obrigatória de Quality Gates:**
  1. *Verificação de Tipagem Estrita:* `bun run typecheck` (`tsc --noEmit`) -> **0 erros exigidos**.
  2. *Bateria de Testes Unitários:* `bun test tests/unit` -> **100% de sucesso exigido** (atualmente 21 testes aprovados cobrindo protocolos, criptografia, sanitização de arquivos e matemática de viewport).
  3. *Bateria E2E Multi-Contexto:* `bunx playwright test` -> **100% de sucesso exigido** (atualmente 2 testes cobrindo fluxo AnyDesk completo e entrada desassistida).

### 6.4. Procedimento de Build e Empacotamento de Release (🔧 Evidenciado via Código)
- **Para a Versão Web/PWA:**
  1. Executar `bun run build`.
  2. Validar que o bundle gerado em `dist/` não possui avisos de compilação e registra o Service Worker `public/sw.js`.
- **Para a Versão Desktop Windows:**
  1. Executar `bunx tauri build`.
  2. Validar a geração do pacote MSI em `src-tauri/target/release/bundle/msi/`.

### 6.5. Procedimento de Tratamento de Não Conformidades (Bugs) (🔧 Evidenciado via Código)
- **Critério de Bloqueio:** Qualquer falha na suíte de testes (`bun test` ou Playwright) constitui uma **Não Conformidade Crítica** que impede o avanço de fase de lançamento.
- **Resolução:** O desenvolvedor deve reproduzir o defeito em um teste unitário isolado, corrigir o código-fonte e validar o reteste antes do fechamento.

---

## 7. Avaliação de Desempenho

### 7.1. Métricas Técnicas Disponíveis no Código (🔧 Evidenciado via Código)
- **Taxa de Compilação Estática:** 100% livre de warnings ou erros de tipos TypeScript (`strict: true`).
- **Aprovação de Testes:** 23/23 testes automatizados verdes (21 unitários + 2 E2E).
- **Telemetria de Runtime:** Monitoramento ativo durante a sessão remota via `webrtc-manager.ts` computando em tempo real:
  - RTT (Ping em ms)
  - Taxa de quadros (FPS de decodificação de vídeo)
  - Taxa de transferência (Bitrate em kbps)
  - Porcentagem de pacotes perdidos (Packet Loss %)

### 7.2. Processos Organizacionais de Avaliação (📝 Requer Definição pela Organização)
*(Processos organizacionais obrigatórios na ISO 9001:2026, a serem estruturados pela liderança)*

- [ ] **Pesquisa Periódica de Satisfação do Cliente / Usuário:** `[A definir metodologia e frequência]`
- [ ] **Auditoria Interna da Qualidade:** `[A definir calendário de auditorias e auditores internos]`
- [ ] **Reunião de Análise Crítica pela Direção:** `[A definir periodicidade anual/semestral e atas]`

---

## 8. Melhoria

### 8.1. Evidências de Melhoria Técnica Contínua (🔧 Evidenciado via Código)
- Implementação de Service Worker com fallback offline resiliente para a versão PWA.
- Atualização e refatoração de tipagem para conformidade integral com TypeScript 5.8+ sem casts forçados.
- Eliminação de alertas de configuração no Vite usando `import.meta.dirname`.

### 8.2. Gestão Formal de Ações Corretivas (📝 Requer Definição pela Organização)
- [ ] Modelo de Registro de Ação Corretiva (RAC) para análise de causa raiz (método 5 Porquês / Ishikawa) quando falhas de produção forem relatadas.
- [ ] Indicador de tempo médio para correção de falhas (MTTR).

---

## 9. Matriz de Aderência (Gap Analysis — ISO 9001:2026)

| Bloco ISO 9001:2026 | Requisito da Norma | Situação Atual | Evidência / Observação |
| :--- | :--- | :---: | :--- |
| **4. Contexto** | 4.1 Compreensão da organização | 🟡 Parcialmente Coberto | Contexto técnico mapeado; fatores de negócio a definir pela gestão. |
| **4. Contexto** | 4.2 Partes interessadas | 🟡 Parcialmente Coberto | Perfis de usuário mapeados; clientes de negócio a formalizar. |
| **5. Liderança** | 5.1 Liderança e comprometimento | 🔴 Requer Definição | Exige atas de diretoria e compromisso formal da alta gestão. |
| **5. Liderança** | 5.2 Política da qualidade | 🔴 Requer Definição | Modelo em branco fornecido na Seção 3 deste documento. |
| **6. Planejamento** | 6.1 Riscos e oportunidades | 🟢 Documentado via Código | Matriz de riscos técnicos documentada na Seção 4.1. |
| **6. Planejamento** | 6.2 Objetivos da qualidade | 🟡 Parcialmente Coberto | Métricas técnicas existentes; metas corporativas a aprovar. |
| **7. Apoio** | 7.1 Recursos e infraestrutura | 🟢 Documentado via Código | Toolchain definida (Bun, Vite, Rust, Playwright). |
| **7. Apoio** | 7.2 Competência e treinamento | 🔴 Requer Definição | Matriz de capacitação fornecida para preenchimento. |
| **7. Apoio** | 7.5 Informação documentada | 🟢 Documentado via Código | Controle de versão Git, configs de lockfile e manuais Markdown. |
| **8. Operação** | 8.3 Design e desenvolvimento | 🟢 Documentado via Código | Ciclo de vida estrito com Zod, arquitetura limpa e testes unitários. |
| **8. Operação** | 8.5 Liberação e entrega | 🟢 Documentado via Código | Pipelines de build definidos para MSI e PWA. |
| **8. Operação** | 8.7 Saídas não conformes | 🟢 Documentado via Código | Quality Gates no terminal impedem merge/release com falhas. |
| **9. Avaliação** | 9.1 Monitoramento e medição | 🟢 Documentado via Código | Testes automatizados e telemetria de RTT/FPS/Bitrate. |
| **9. Avaliação** | 9.2 Auditoria interna | 🔴 Requer Definição | Calendário e escopo a serem instituídos pela organização. |
| **9. Avaliação** | 9.3 Análise crítica da direção | 🔴 Requer Definição | Reuniões formais com registros de ata a serem implantadas. |
| **10. Melhoria** | 10.2 Ação corretiva | 🟡 Parcialmente Coberto | Resolução de bugs no código existente; procedimento formal a redigir. |

---

## 10. Aviso Importante sobre Certificação

> [!IMPORTANT]
> **Ressalva Formal:** A norma **ISO 9001:2026** é uma norma de *requisitos para sistemas de gestão organizacional*, abrangendo liderança humana, relacionamento comercial, auditorias internas, conformidade legal e melhoria contínua de processos ao longo do tempo.  
> Este documento organiza e formaliza as práticas de engenharia de software presentes no repositório, servindo como a **base técnica essencial** para o atendimento dos requisitos operacionais da norma; contudo, a certificação formal ISO 9001 exige uma auditoria independente realizada por um Organismo de Certificação Acreditado (como Bureau Veritas, DNV, TÜV, BSI ou ABNT), que avaliará as práticas reais da empresa como um todo, e **não pode ser conferida automaticamente por nenhuma ferramenta, relatório ou IA**.
