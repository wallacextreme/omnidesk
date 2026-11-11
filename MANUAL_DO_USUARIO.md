# 📖 Manual do Usuário — OmniDesk Pro

**Versão do Manual:** 11 de Novembro de 2026  
**Aplicável à Versão do Sistema:** v1.0.0 (Desktop & Web/PWA)  
**Ambiente Suportado:** Windows 10/11 (64-bit), Navegadores Modernos (Chromium / Edge / Chrome / Safari / Firefox)

---

## Sumário

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Como Instalar e Acessar o Sistema](#2-como-instalar-e-acessar-o-sistema)
   - [2.1. Instalação no Windows (Desktop — .exe ou .msi)](#21-instalação-no-windows-desktop--exe-ou-msi)
   - [2.2. Instalação e Uso via Navegador (PWA)](#22-instalação-e-uso-via-navegador-pwa)
3. [Guia de Início Rápido (Primeiros Passos)](#3-guia-de-início-rápido-primeiros-passos)
4. [O Funcionamento Offline e Seus Dados](#4-o-funcionamento-offline-e-seus-dados)
5. [Manual Operacional Passo a Passo (Mapeamento Completo)](#5-manual-operacional-passo-a-passo-mapeamento-completo)
   - [5.1. Painel Principal (Dashboard)](#51-painel-principal-dashboard)
   - [5.2. Modal de Solicitação de Conexão (Lado do Host)](#52-modal-de-solicitação-de-conexão-lado-do-host)
   - [5.3. Viewport de Sessão Ativa & Barra HUD Superior](#53-viewport-de-sessão-ativa--barra-hud-superior)
   - [5.4. Chat em Tempo Real](#54-chat-em-tempo-real)
   - [5.5. Transferência Segura de Arquivos (Drag & Drop)](#55-transferência-segura-de-arquivos-drag--drop)
6. [Perguntas Frequentes (FAQ)](#6-perguntas-frequentes-faq)
7. [Solução de Problemas (Troubleshooting)](#7-solução-de-problemas-troubleshooting)
8. [Boas Práticas e Recomendações Finais](#8-boas-práticas-e-recomendações-finais)

---

## 1. Visão Geral do Sistema

O **OmniDesk Pro** é uma solução profissional de acesso e suporte remoto para computadores, com paridade funcional ao AnyDesk, projetada com foco em **ultra-baixa latência**, **privacidade total** e **arquitetura híbrida** (aplicativo nativo Windows ou PWA executável no navegador).

### Para quem foi feito?
- **Profissionais de TI e Suporte:** prestação de suporte remoto rápido sem necessidade de configurações de firewall ou portas complexas.
- **Usuários em Home Office:** acesso direto ao computador da empresa a partir de qualquer dispositivo pessoal.
- **Empresas com Requisitos de Privacidade Estrita:** operação em redes locais fechadas (LAN/Intranet) sem envio de imagens ou arquivos para servidores em nuvem de terceiros.

### Principais Vantagens:
- **Transmissão Fluida a 60 FPS:** aceleração por hardware via WebRTC com latência típica inferior a 30 milissegundos.
- **Arquitetura P2P / Offline-First:** todo o tráfego de tela, teclado, mouse e arquivos trafega diretamente entre os dois computadores via canais criptografados ponta a ponta (DTLS-SRTP).
- **Zero-Trust Security:** senhas nunca trafegam em texto puro pela rede; o controle de acesso é validado por desafio criptográfico (PBKDF2-SHA256 + HMAC com *nonce* descartável) e o computador anfitrião mantém controle total para revogar mouse, teclado ou arquivos a qualquer instante.

---

## 2. Como Instalar e Acessar o Sistema

O OmniDesk Pro pode ser executado de duas maneiras: como aplicativo nativo instalado no Windows ou diretamente no navegador de internet como Aplicativo Web Progressivo (PWA).

### 2.1. Instalação no Windows (Desktop — .exe ou .msi)

#### Requisitos Mínimos:
- Sistema Operacional: Windows 10 (Build 1809 ou superior) ou Windows 11 (64-bit).
- Componente de Sistema: Microsoft Edge WebView2 Runtime (pré-instalado no Windows 10/11 atualizados).
- Memória RAM: Mínimo 2 GB (recomendado 4 GB).
- Espaço em Disco: 80 MB livres.

#### Passo a Passo de Instalação:
1. Obtenha o instalador oficial `OmniDesk Pro_1.0.0_x64_en-US.msi` (pacote corporativo) ou `OmniDesk Pro.exe`.
2. Dê um duplo clique no arquivo para iniciar o assistente de instalação.
3. Se o assistente solicitar permissão de Administrador do Windows, clique em **"Sim"**.
4. Conclua a instalação clicando em **"Instalar"** e em seguida **"Concluir"**.

> [!NOTE]
> **Aviso do Windows SmartScreen:**  
> Caso o Windows exiba a tela azul com a mensagem *"O Windows protegeu o seu computador - O Windows Defender SmartScreen impediu a inicialização de um aplicativo não reconhecido"*, execute o seguinte procedimento:
> 1. Clique no link **"Mais informações"** localizado abaixo do texto de aviso.
> 2. Clique no botão **"Executar assim mesmo"** que surgirá no canto inferior direito.  
> Esse alerta é normal em binários recém-compilados que ainda não acumularam histórico de reputação nas chaves comerciais da Microsoft.

#### Onde encontrar o aplicativo:
- Um atalho denominado **OmniDesk Pro** será criado na sua **Área de Trabalho**.
- Você também pode localizá-lo abrindo o **Menu Iniciar** e digitando `OmniDesk Pro`.

---

### 2.2. Instalação e Uso via Navegador (PWA)

Se você estiver em um computador corporativo restrito onde não possui permissão para instalar arquivos `.msi` ou `.exe`, você pode usar e instalar o OmniDesk Pro pelo próprio navegador.

#### Navegadores Recomendados:
- Google Chrome (versão 100 ou superior).
- Microsoft Edge (versão 100 ou superior).
- Brave ou navegadores baseados no Chromium.

#### Passo a Passo de Acesso e Instalação PWA:
1. Abra o navegador e digite o endereço fornecido pela sua equipe de TI (exemplo local: `http://localhost:5173` ou o IP do servidor local na rede da empresa).
2. Na barra de endereços do navegador, localize o ícone de instalação:
   - No **Google Chrome**: clique no ícone de monitor com seta para baixo no lado direito da barra de URLs (*"Instalar OmniDesk Pro"*).
   - No **Microsoft Edge**: clique no ícone de três quadrados com um sinal de mais (*"Aplicativo disponível. Instalar OmniDesk Pro"*).
3. Na caixa de diálogo que surgir, clique em **"Instalar"**.
4. O OmniDesk Pro será aberto em uma janela dedicada e independente, sem barra de navegação, com atalho criado no Menu Iniciar e na Área de Trabalho.

---

## 3. Guia de Início Rápido (Primeiros Passos)

Em menos de 1 minuto você pode realizar sua primeira conexão:

1. **Abra o OmniDesk Pro:** execute o aplicativo no computador que deseja acessar (Computador A - Host) e no computador que você usará para controlar (Computador B - Cliente).
2. **Localize o seu ID:** no Computador A, observe o card **"Este Dispositivo"** na coluna esquerda. O sistema exibe um ID de 9 dígitos no formato `XXX XXX XXX`. Clique no botão **"Copiar ID"**.
3. **Informe o ID no Computador B:** no Computador B, clique no campo **"Digite o ID de 9 dígitos"** na coluna direita e cole o ID do Computador A.
4. **Clique em "Conectar":** o Computador B iniciará a solicitação de conexão.
5. **Aprove a Conexão:** no Computador A, uma janela surgirá exibindo o nome de quem está conectando. Clique no botão verde **"Aceitar"**.
6. **Pronto!** A tela remota aparecerá instantaneamente em alta resolução a 60 quadros por segundo.

---

## 4. O Funcionamento Offline e Seus Dados

O OmniDesk Pro adota o princípio de **Soberania e Privacidade de Dados**:

### Onde ficam os dados?
- Os seus identificadores de dispositivo (`OmniDesk_device_id`), histórico de conexões recentes (`OmniDesk_recent_sessions`) e senhas configuradas ficam armazenados **exclusivamente na memória local do seu computador** (no `localStorage` criptografado da WebView ou do navegador).
- **Nenhum dado de tela, histórico ou credencial é salvo em servidores remotos.**

### Uso em Redes Isoladas (Sem Internet Externa):
- Em ambientes hospitalares, laboratoriais, industriais ou filiais sem acesso à internet externa, o OmniDesk Pro opera com perfeição: basta que o servidor de sinalização local (`server/signaling.ts`) esteja rodando em qualquer máquina da rede local (LAN ou Wi-Fi) na porta 4000.
- Os computadores se encontram diretamente pelo IP local e transmitem vídeo e comandos P2P com tráfego 100% contido na sua rede interna.

> [!IMPORTANT]
> **Atenção aos Usuários da Versão PWA no Navegador:**  
> Caso utilize a versão PWA pelo navegador, evite selecionar a opção *"Limpar cookies e dados de navegação"* ao fechar o browser, pois isso apagará o histórico de sessões recentes salvas localmente. Para manter seus favoritos garantidos, anote os IDs das máquinas com as quais você mais se conecta.

---

## 5. Manual Operacional Passo a Passo (Mapeamento Completo)

### 5.1. Painel Principal (Dashboard)

Ao abrir o OmniDesk Pro, você visualiza a tela inicial dividida em duas colunas principais:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│          ESTE DISPOSITIVO            │    CONECTAR A OUTRO DISPOSITIVO      │
│                                      │                                      │
│  Seu ID:   [ 123 456 789 ]  [Copiar] │  [ Digite o ID de 9 dígitos... ]     │
│  Status:   🟢 Conectado ao Gateway   │  [ Conectar ➜ ]                      │
│                                      │                                      │
│  [🛡️ Acesso Desassistido (Senha)]    │  🕒 Sessões Recentes & Favoritos:    │
│  [ Permissões Padrão: 🖱️ 📋 📁 🔊 ]   │  ⭐ Servidor Contabilidade (123...)  │
│                                      │  ⭐ Estação Design (987...)          │
└──────────────────────────────────────┴──────────────────────────────────────┘
```
*[Local para print de tela: Dashboard Principal Dual-Pane]*

#### Elementos da Coluna Esquerda ("Este Dispositivo"):
| Campo / Botão | O que faz | Regras / Comportamento |
| :--- | :--- | :--- |
| **Seu ID de Acesso** | Exibe o número único de 9 dígitos gerado para o seu computador. | Formato `XXX XXX XXX`. Identificador único persistido localmente. |
| **Botão "Copiar ID"** | Copia o código de 9 dígitos para a Área de Transferência. | Exibe confirmação visual verde *"Copiado!"* por 2 segundos. |
| **Indicador de Status** | Mostra se você está conectado ao servidor de sinalização. | 🟢 Verde: Conectado e pronto. 🔴 Vermelho: Desconectado. |
| **Campo "Acesso Desassistido"** | Permite cadastrar uma senha mestra para permitir conexões sem clique manual no local. | Protegido por criptografia PBKDF2. Possui botão de olho para mostrar/ocultar senha. |
| **Checkboxes de Permissões (ACL)** | Define quais recursos remotos são liberados por padrão ao aceitar conexões. | Opções: `Mouse/Teclado`, `Área de Transferência`, `Arquivos` e `Áudio`. |

#### Elementos da Coluna Direita ("Conectar a Outro Dispositivo"):
| Campo / Botão | O que faz | Regras / Comportamento |
| :--- | :--- | :--- |
| **Campo de ID Remoto** | Entrada onde você digita o ID do computador que quer controlar. | Máximo de 9 dígitos numéricos. Espaçamento automático `XXX XXX XXX`. |
| **Botão "Conectar"** | Inicia a solicitação de acesso remoto ao dispositivo de destino. | Habilitado apenas quando o ID possui 9 dígitos completos. |
| **Grid de Sessões Recentes** | Lista os últimos dispositivos conectados para reconexão rápida com 1 clique. | Exibe nome, ID formatado, botão de favorito (estrela) e exclusão (lixeira). |

---

### 5.2. Modal de Solicitação de Conexão (Lado do Host)

Quando um operador remoto tenta se conectar ao seu computador e você não configurou senha desassistida, uma janela modal de segurança é exibida no centro da sua tela com alerta visual.

*[Local para print de tela: Modal de Solicitação de Conexão com Countdown]*

#### Elementos do Modal:
| Elemento | Função e Comportamento |
| :--- | :--- |
| **Nome do Solicitante** | Exibe o nome do computador ou dispositivo que está pedindo acesso. |
| **ID de Origem** | Exibe os 9 dígitos de quem está chamando para você confirmar a identidade. |
| **Toggles de Permissões em Tempo Real** | Permite desmarcar privilégios específicos (ex.: desativar transferência de arquivos ou mouse) apenas para esta sessão. |
| **Contador Regressivo (30s)** | Cronômetro de segurança de 30 segundos. Se ninguém responder no local, a chamada é recusada automaticamente. |
| **Botão "Recusar"** | Rejeita a conexão imediatamente e notifica o solicitante. |
| **Botão "Aceitar"** | Estabelece o túnel criptografado WebRTC e inicia o compartilhamento da tela. |

---

### 5.3. Viewport de Sessão Ativa & Barra HUD Superior

Assim que a conexão é aceita, você entra na visualização de tela cheia do computador remoto. No topo da tela, uma barra flutuante translúcida (**HUD**) permite monitorar e controlar todos os aspectos da sessão:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ [🟢 18ms | 60 FPS | 2400 kbps]  [🎛️ Qualidade]  [🛡️ Input]  [CAD]  [💬]  [📁]  [❌ Desconectar] │
└─────────────────────────────────────────────────────────────────────────────────┘
```
*[Local para print de tela: Viewport com HUD Superior Ativo]*

#### Funções da Barra Superior (HUD):
- **Badge de Telemetria:**
  - 🟢 **Verde (< 30ms):** Conexão perfeita, latência imperceptível para trabalho e jogos.
  - 🟡 **Amarelo (30 - 80ms):** Conexão aceitável para suporte e rotinas administrativas.
  - 🔴 **Vermelho (> 80ms):** Conexão com lentidão ou oscilação de rede.
  - Exibe também a taxa real de quadros por segundo (**FPS**) e o consumo de banda em **kbps**.
- **Seletor de Qualidade (`Qualidade`):** permite alternar em tempo real entre:
  - *Performance (720p)*: prioriza velocidade em conexões fracas ou Wi-Fi instável.
  - *Equilibrado (1080p)*: equilíbrio ideal entre nitidez de texto e velocidade.
  - *Qualidade Original*: nitidez máxima sem perda de fidelidade de cor.
- **Botão Bloquear/Liberar Input (`Escudo`):** permite suspender temporariamente o controle do mouse e teclado do usuário remoto com 1 clique.
- **Botão CAD (`Ctrl+Alt+Del`):** envia o atalho nativo de segurança do sistema operacional para desbloquear telas de login no Windows.
- **Botão Chat (`Balão de Mensagem`):** abre a gaveta lateral de conversa instantânea com indicador de mensagens não lidas.
- **Botão Arquivos (`Pasta`):** abre a gaveta de envio e recebimento de arquivos.
- **Botão Tela Cheia:** alterna entre janela e tela inteira do seu monitor.
- **Botão "Desconectar" (Vermelho):** finaliza a transmissão P2P e retorna à tela inicial.
- **Seta de Recolhimento:** oculta a barra em uma pílula compacta para não cobrir a visualização de abas no topo da tela remota.

---

### 5.4. Chat em Tempo Real

Durante o atendimento, você pode conversar com a pessoa do outro lado através da gaveta lateral de chat integrada.

*[Local para print de tela: Gaveta Lateral de Chat Aberta]*

#### Como Usar:
1. Clique no ícone de chat no HUD superior.
2. A gaveta abrirá no lado direito da tela sem interromper a visualização do monitor remoto.
3. Digite sua mensagem no campo inferior e pressione **Enter** ou clique no botão de envio.
4. As mensagens são sincronizadas instantaneamente via canal WebRTC com carimbo de hora.

---

### 5.5. Transferência Segura de Arquivos (Drag & Drop)

Envie arquivos de qualquer tamanho diretamente para o computador remoto com verificação de integridade criptográfica.

*[Local para print de tela: Gaveta de Transferência de Arquivos com Barra de Progresso]*

#### Como Enviar Arquivos:
1. Clique no ícone de **Pasta com Seta** no HUD superior.
2. Arraste qualquer arquivo do seu computador e solte dentro da área pontilhada da gaveta (ou clique para abrir a janela de seleção de arquivos).
3. O envio iniciará automaticamente em fatias seguras de 64 KB.
4. Acompanhe a barra de progresso em tempo real, informando **MB transferidos**, **Velocidade em MB/s** e **Tempo Restante Estimado (ETA)**.

#### Como Receber Arquivos:
- Quando o outro usuário enviar um arquivo para você, a gaveta exibirá o progresso da recepção.
- Ao finalizar, o sistema realiza a validação do hash **SHA-256** para garantir que o arquivo não sofreu corrupção.
- O arquivo aparecerá na lista de **"Arquivos Recebidos"** com um botão de download para salvá-lo na pasta desejada do seu computador.

---

## 6. Perguntas Frequentes (FAQ)

### 1. "Preciso de internet para usar o sistema?"
**Não obrigatoriamente.** Se ambos os computadores estiverem na mesma rede local (mesmo roteador Wi-Fi ou rede cabeada da empresa) e o servidor de sinalização estiver rodando na porta 4000 de uma máquina da rede, todo o acesso ocorre sem qualquer conexão com a internet externa. A internet só é necessária caso os dois computadores estejam em cidades ou redes diferentes.

### 2. "Se a energia cair ou a internet sumir, eu perco o que fiz?"
O OmniDesk Pro é apenas um visualizador e controlador remoto da máquina de destino. Tudo o que você salvou no computador remoto permanece salvo no disco rígido dele. Se a conexão cair, basta reabrir o OmniDesk Pro e reconectar; sua área de trabalho remota estará exatamente como você a deixou.

### 3. "Qual a diferença entre usar o programa instalado (.exe/.msi) e o PWA pelo navegador?"
- **Desktop Instalado (.exe / .msi):** oferece integração com injeção de teclas do sistema operacional de baixo nível (como atalhos de sistema) e acesso ao instalador corporativo silencioso.
- **Web PWA (Navegador):** não requer privilégios de instalação nem permissões de administrador. Pode ser aberto instantaneamente em computadores bloqueados ou com sistema operacional de terceiros.

### 4. "O Windows bloqueou a instalação dizendo que o arquivo é desconhecido, o que fazer?"
Trata-se de uma mensagem preventiva do Windows SmartScreen. Clique no link `"Mais informações"` e depois no botão `"Executar assim mesmo"`. O instalador é 100% livre de malwares e construído diretamente no código aberto do projeto.

### 5. "Como faço para levar meus dados para outro computador?"
O OmniDesk Pro armazena apenas seu ID de 9 dígitos e sua lista de sessões recentes. Se você formatar o computador ou trocar de máquina, um novo ID de 9 dígitos será gerado automaticamente no primeiro acesso. Basta informar esse novo ID para quem for se conectar a você.

### 6. "O que é o Acesso Desassistido e a minha senha é transmitida pela rede?"
O Acesso Desassistido permite acessar seu próprio computador (ex.: do trabalho) quando ninguém estiver lá para clicar em "Aceitar". **Sua senha NUNCA é enviada pela rede.** O OmniDesk Pro utiliza um desafio criptográfico (PBKDF2-SHA256 + HMAC com *nonce*): o computador remoto gera um enigma matemático aleatório e o seu cliente devolve apenas a prova matemática de que você conhece a senha, impedindo que interceptadores descubram suas credenciais.

### 7. "Como funciona o bloqueio de controle se a outra pessoa tentar mexer no meu computador?"
Você tem soberania absoluta na sua máquina: se alguém estiver conectado a você e você desejar impedir que essa pessoa movimente o mouse ou digite, basta clicar no botão de **Escudo** na barra HUD superior. O filtro Host Zero-Trust descartará todos os pacotes de teclado e mouse recebidos antes que eles alcancem o sistema operacional.

### 8. "Qual o limite de tamanho para transferência de arquivos e como garantir que o arquivo não veio corrompido?"
Não há limite imposto pelo protocolo: arquivos de gigabytes podem ser transferidos graças ao controle de fluxo (*backpressure*) que divide o arquivo em blocos de 64 KB e aguarda o esvaziamento do buffer de rede. Antes de disponibilizar o arquivo para download, o sistema calcula o hash criptográfico SHA-256 e só libera o arquivo se o checksum coincidir com o original.

### 9. "Como interpretar as cores do medidor de ping no topo da tela?"
- **Verde (até 30ms):** Excelente! Resposta instantânea de mouse e teclado.
- **Amarelo (30 a 80ms):** Bom. Resposta rápida para qualquer tarefa comum de escritório.
- **Vermelho (acima de 80ms):** Conexão lenta ou Wi-Fi com perda de sinal; pode haver pequeno atraso ao mover janelas pesadas.

---

## 7. Solução de Problemas (Troubleshooting)

| Sintoma / Problema | Causa Provável | Como Resolver |
| :--- | :--- | :--- |
| **Alerta do Windows SmartScreen ao abrir o instalador** | Falta de assinatura digital comercial paga da Microsoft no binário. | Clique em *"Mais informações"* e em seguida no botão *"Executar assim mesmo"*. |
| **Status exibe "Desconectado" em vermelho** | O servidor de sinalização WebSocket (porta 4000) não está acessível. | Verifique se o servidor de sinalização está rodando (`bun run server`) ou se a porta 4000 não está bloqueada pelo firewall local. |
| **Aparece a mensagem "Dispositivo remoto está offline ou ID não existe"** | O ID de 9 dígitos foi digitado incorretamente ou a outra máquina está fechada/desligada. | Confirme os 9 dígitos com o usuário remoto e certifique-se de que o OmniDesk Pro dele está aberto e com status online verde. |
| **Conexão desassistida rejeitada ("Senha incorreta")** | A senha informada no cliente não corresponde à cadastrada no Host. | Redigite a senha de acesso desassistido no Host e tente novamente a partir do cliente. |
| **O mouse mexe na tela, mas os cliques não surtem efeito** | A permissão de Mouse/Teclado foi desativada pelo Host. | Solicite ao usuário do computador remoto para clicar no botão de Escudo no HUD para liberar o controle de input. |
| **Tela preta ao conectar no modo navegador** | Permissão de captura de tela (`getDisplayMedia`) foi negada no navegador. | Clique no ícone de permissões ao lado da URL no navegador e conceda acesso ao compartilhamento de tela. |
| **Transferência de arquivos falha com erro de "checksum mismatch"** | Ocorreu perda severa de pacotes de rede corrompendo blocos do arquivo. | Cancele a transferência e inicie novamente; certifique-se de que a conexão não está sofrendo quedas constantes. |

---

## 8. Boas Práticas e Recomendações Finais

1. **Defina Senhas Fortes:** caso utilize o Acesso Desassistido, utilize senhas de pelo menos 10 caracteres misturando números, letras e símbolos.
2. **Utilize Rede Cabeada (Ethernet) quando Possível:** conexões cabeadas oferecem estabilidade absoluta e garantem os menores pings (<15ms) e 60 FPS estáveis.
3. **Atalhos Rápidos Úteis:**
   - `Ctrl + Alt + Del`: utilize o botão dedicado **CAD** no HUD superior para acionar essa combinação com segurança na máquina remota.
   - `Tela Cheia`: utilize o botão de maximizar no HUD para que o cursor do seu mouse fique travado dentro do monitor remoto, proporcionando sensação 100% nativa.
