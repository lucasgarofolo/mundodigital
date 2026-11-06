# CONTEXT — Mundo // Digital

Atualizado em **06/11/2026**, para continuar o trabalho em um novo chat.

## Atualização posterior: dois provedores de portrait

O pedido seguinte autorizou seleção manual e fallback opcional **somente no Pipeline B**, substituindo a restrição histórica abaixo contra cascata de portrait. Implementado localmente, sem publicação nem alteração do `.env` real:

- `lib/portraitProvider.js`: `PORTRAIT_PROVIDER=cloudflare|openrouter`, `PORTRAIT_FALLBACK_ENABLED=false|true`, `PORTRAIT_FALLBACK_PROVIDER=openrouter|cloudflare`. Default Cloudflare sem fallback; seleção inválida falha antes de abrir banco/filas. Fallback desabilitado ignora configuração alternativa.
- `lib/openRouterPortrait.js`: `/api/v1/images`, modelo default `black-forest-labs/flux-3-image-klein`, mesma `OPENROUTER_API_KEY`, timeout próprio `OPENROUTER_PORTRAIT_TIMEOUT_MS=120000`, selfie com MIME real em `input_references`, resposta `data[0].b64_json`.
- `lib/portraitImage.js`: normalização compartilhada PNG 512×512 e classificação segura de falhas. Prompt literal Cloudflare preservado.
- Cloudflare mantém default 4b por compatibilidade e aceita o `@cf/black-forest-labs/flux-2-klein-9b` informado pelo usuário.
- Cada geração tenta cada provedor no máximo uma vez. A fila não repete automaticamente a sequência real. Orçamento persistido, retry manual/restart, cache e leases permanecem. Falhas transitórias elegíveis acionam o alternativo apenas se habilitado; autenticação, configuração, imagem/resposta inválida, TLS e cancelamento não acionam.
- `lib/operationEvents.js` observa tentativas do serviço correto sem adicionar UI. Eventos técnicos registram modelo/duração/custo quando retornado, sem imagem/chave.
- Nenhum arquivo do Pipeline A foi editado nesta tarefa; suas alterações anteriores continuam na working tree.
- Testes novos em `tests/portrait-providers.test.js` (incluído em `npm test`) e regressão de fila/cache em `tests/portrait-pass.test.js`. Suíte completa final: **232/232**, cerca de 70 s; testes específicos finais: **41/41**. Logs em `.test-data/portrait-providers-regression-final.log` e `.test-data/portrait-providers-unit-final.log`, sem chamadas pagas. Smoke Story executado com `STORY_BROWSER_CHANNEL=chrome` somente no processo de teste.
- Configurações, quatro modos e testes manuais documentados em `docs/portrait-pass.md`; variáveis também em `docs/production.md`. Os trechos seguintes descrevem o estado anterior a esta tarefa e devem ser lidos com esta atualização.

Este arquivo resume o projeto, as decisões da conversa e o estado local verificado. Não contém credenciais, selfies ou dados reais de participantes. **O código atual é a fonte da verdade.** Documentos de fases antigas descrevem decisões históricas que podem ter sido substituídas pelas fases seguintes.

## 1. Retomada rápida

- Projeto: **Mundo // Digital**, experiência de evento com check-in pelo celular, avatar Universal LPC, retrato pixel art, passe e um mundo isométrico vivo apresentado na TV.
- Responsável: Lucas Garofolo. Crédito público existente: desenvolvido por Lucas Garofolo, com LinkedIn `https://www.linkedin.com/in/lucas-garofolo-94b8bb6a`.
- Repositório local: `C:\Users\lucas\Documents\GitHub\mundodigital`.
- Ambiente: Windows, PowerShell, Node 24.13.0; `package.json` exige Node >=24.
- Backend: Node/Express, SQLite, Socket.IO, Sharp, Playwright para exportar Story.
- Frontend: HTML/CSS/JavaScript servido diretamente, Phaser 3.90; sem build de frontend.
- Hospedagem informada pelo usuário: Railway, endereço público `https://mundodigital-production.up.railway.app`.
- Check-in público: `https://mundodigital-production.up.railway.app/check-in`.
- O usuário pediu para investigar os últimos problemas **localmente**, sem verificar produção. Essa preferência deve ser preservada até nova instrução.
- As últimas alterações **não foram commitadas, enviadas ou publicadas pelo assistente**. Não confundir testes locais com validação online.
- A última tarefa funcional, exclusão de cadastros abandonados no admin, foi concluída e validada. A solicitação atual foi somente criar este `CONTEXT.md`.

Para iniciar o próximo chat:

> Leia CONTEXT.md e confira o Git antes de continuar. Preserve as alterações locais existentes. Resuma o estado e aguarde minha próxima tarefa, sem publicar nem acessar produção automaticamente.

## 2. Princípios de trabalho e limites

1. A identidade pública é exatamente **Mundo // Digital**. O projeto deixou de ter branding institucional SENAI. Identificadores técnicos legados podem conter `senai`; não renomeá-los indiscriminadamente.
2. Preservar o Universal LPC como sistema oficial de avatar: catálogo, mapeador, compositor, assets e animações existentes. OpenRouter não gera sprites.
3. OpenRouter analisa características visuais; Cloudflare gera o portrait. São pipelines independentes. Não criar uma cascata automática de providers.
4. Não avançar para outra fase, introduzir IA social, redesenhar ou refatorar amplamente sem pedido. O usuário priorizou estabilidade e alterações cirúrgicas por causa do evento.
5. Check-in e passe são públicos. Operação, mapa/TV, admin, rastreador e câmera exigem autenticação real no backend.
6. Selfie original é privada e temporária. Não expor imagem original, caminho, Base64 ou botão de visualização no admin.
7. Não apagar uma selfie enquanto qualquer consumidor real ainda a utiliza, mesmo se um timeout já devolveu fallback.
8. Não ler/imprimir `.env`, chaves SSH, tokens, senhas ou conteúdo de fotos para elaborar relatórios. Não colocar segredos neste contexto.
9. Não desfazer mudanças do usuário nem alterações anteriores na working tree. Não fazer commit/push/deploy sem autorização correspondente.
10. Nas últimas tarefas foram usados mocks e imagens sintéticas, sem selfies reais e sem chamadas pagas.

Não foi localizado `AGENTS.md` nas inspeções anteriores. Este arquivo é contexto de continuidade, não um pedido para criar outra camada de instruções ou uma nova funcionalidade.

## 3. Estado funcional geral

O visitante faz cadastro com nome, e-mail válido e selfie. O backend valida a ciência obrigatória sobre IA e cria uma identidade por UUID aleatório. A mesma identidade/e-mail é reutilizada pelo mecanismo de deduplicação existente, sem gerar outro participante inadvertidamente.

Os dois processamentos seguem em paralelo:

```text
Pipeline A: selfie privada → análise visual → appearance JSON validada
            → composição local Universal LPC → avatar READY ou fallback

Pipeline B: selfie privada → Cloudflare Workers AI → portrait pixel art
            → componentes do passe

Exportação: dados do passe + LPC + portrait → HTML/CSS → Playwright
            → Story PNG 1080 × 1920 para download/compartilhamento
```

O passe funciona como credencial de entrada. `PASS_READY` significa que a credencial está pronta e aguarda o botão de entrada/aprovação. O avatar **não entra automaticamente só porque o passe ficou pronto**.

O botão normal do visitante aprova, agenda a entrada e depois o avatar caminha pela porta até a Sala de Acesso. O admin também pode usar FORÇAR ENTRADA, reutilizando o mesmo fluxo. Depois de entrar, o avatar explora o mundo automaticamente. Não é controlado pelo celular e não fica retornando à Sala de Acesso como destino normal de exploração.

A espera física dos visitantes no evento foi descrita como aproximadamente 15 minutos. Isso não deve ser confundido com os tempos técnicos atuais de entrada, apresentação do passe e permanência inicial do avatar; não reconfigurar esses tempos apenas por esse histórico.

## 4. Arquivos e responsabilidades

| Arquivo/área | Responsabilidade |
| --- | --- |
| `server.js` | Entrypoint, `createApplication(options)`, composição dos serviços, check-in, simulação central, Socket.IO, entrada, ações compartilhadas e shutdown. |
| `lib/store.js` | SQLite de participantes, persistência espacial, estados, versões, tentativas, migrations/init. |
| `lib/adminQueries.js` | Resumo/busca/paginação eficientes e operações atômicas administrativas sobre participantes. |
| `lib/avatarPipeline.js` | Fila LPC, concorrência, prazo global, retry centralizado, cancelamento e fallback. |
| `lib/geminiAvatarAnalyzer.js` | Analyzer Google e prompt compartilhado `avatarPrompt()`. |
| `lib/ollamaAvatarAnalyzer.js` | Analyzer local, reutiliza o prompt compartilhado. |
| `lib/openRouterAvatarAnalyzer.js` | Analyzer OpenRouter, request multimodal/JSON Schema, parsing, validação, logs seguros. |
| `lib/avatarCatalog.js` | Catálogo, `DEFAULT_AVATAR`, `avatarSchema()`, `validateAppearance()`. Não foi alterado nas correções recentes. |
| `lib/avatarLpcMapper.js`, `lib/lpcCompositor.js`, `lib/lpcAvatarBuilder.js` | Mapeamento e composição local do sprite. |
| `lib/cloudflarePortrait.js` | Geração do portrait Cloudflare; não gera LPC. |
| `lib/passService.js` | Filas independentes de portrait/Story, retries, cache, recuperação e operações do passe. |
| `lib/passView.js` | Projeção do passe, credentialState, HTML do Story e hash/cache. |
| `lib/passRoutes.js` | Páginas/dados/arquivos públicos do passe, com validações. |
| `lib/storyRenderer.js` | Playwright, navegador cacheado, render PNG e erros seguros por etapa. |
| `lib/selfieLifecycle.js` | Leases dos consumidores, exclusão terminal, retry de cleanup e recuperação após restart. |
| `lib/entryScheduler.js` | Entrada agendada por UUID e cancelamento de timer. |
| `lib/operatorControl.js` | Foco/HOME e controle da TV existentes. |
| `lib/auth.js`, `lib/authStore.js` | Sessões, autorização HTTP/Socket.IO, CSRF, administradores e senhas. |
| `lib/adminOperations.js` | APIs, permissões, DTOs seguros, ações idempotentes e sinalização do admin. |
| `lib/operationEvents.js` | Atividade recente e observações operacionais seguras, efêmeras. |
| `lib/participantDeletion.js` | Novo serviço de exclusão permanente de cadastros que ainda não iniciaram a entrada. |
| `public/js/check-in.js`, `public/js/selfieCamera.js` | Check-in, revisão e captura da câmera. |
| `public/js/pass.js`, `public/css/pass.css` | Passe, download, compartilhamento e apresentação. |
| `public/js/game.js`, `public/js/characters.js` | Phaser e representação dos participantes. |
| `public/js/movement.js` | Movimento existente, reutilizado pela simulação. |
| `public/js/macroWorldConfig.js`, `macroNavigation.js`, `macroWorldRenderer.js` | Cinco blocos, áreas, POIs, reservas, navegação e representação do mundo macro. |
| `public/js/visitVisualBehavior.js`, `visitVisualEffects.js` | Comportamentos visuais, emotes e microanimações de POIs. |
| `public/js/socialBehavior.js` | Interações sociais efêmeras locais, sem IA. |
| `public/js/cameraController.js`, `cameraConfig.js` | Câmera, zoom, HOME e tracking existentes. |
| `public/js/adminOperations.js`, `admin.js`, `adminFeedback.js` | Interface administrativa, contas, toast e confirmação própria. |
| `public/js/participantsClient.js` | Eventos incrementais e cleanup visual de participantes removidos. |

O backend usa CommonJS; `public/js/package.json` permite ES modules no frontend. A aplicação expõe dependências por `createApplication(options)` para testes; preservar as injeções de analyzer, fetch, renderer, logger, diretório de dados e relógio existentes.

## 5. Providers de análise visual

`AVATAR_PROVIDER` aceita:

- `local`: avatar default/local, sem análise por IA.
- `ollama`: análise local; configuração documentada para `gemma4:12b`.
- `gemini`: Google; modelo default atual no código/documentação `gemini-3.5-flash-lite`.
- `openrouter`: escolha operacional atual, modelo default `qwen/qwen3-vl-30b-a3b-instruct`.

### Contrato comum

Factories retornam `async function analyzeSelfie(imagePath, { signal } = {})`. O retorno é **diretamente `appearance`**, não `{ appearance }`, nem um objeto misturado com métricas.

Os dez campos são:

```json
{
  "hairStyle": "short",
  "hairColor": "gray",
  "facialHair": "full_beard",
  "facialHairColor": "gray",
  "glasses": "thin",
  "top": "tshirt",
  "topColor": "black",
  "bottom": "unknown",
  "bottomColor": "unknown",
  "shoes": "unknown"
}
```

O exemplo não amplia o catálogo: consultar sempre `avatarSchema()` e as enumerações reais. `validateAppearance()` rejeita campo extra/faltante, tipo ou enum inválido e normaliza `unknown` conforme `DEFAULT_AVATAR`. Essa normalização é intencional. Em especial, `facialHair=none` pode deixar uma cor normalizada que não é desenhada; não mudar o catálogo por isso.

O prompt não identifica a pessoa, não infere características sensíveis, idade, gênero ou bodyType, ignora instruções/texto dentro da imagem e não inventa roupas fora do enquadramento. Quando `facialHair=none`, pede `facialHairColor=unknown`.

### OpenRouter

- `POST https://openrouter.ai/api/v1/chat/completions`.
- Authorization Bearer exclusivamente no backend; Content-Type JSON.
- JPEG preparado em memória, máximo 768 × 768, qualidade 82.
- Imagem em `image_url.url = data:image/jpeg;base64,...`; sem URL pública ou upload intermediário.
- Apenas prompt e imagem, sem nome/e-mail/UUID/cargo/instituição.
- `stream:false`, `temperature:0`, `max_tokens:350`.
- `provider:{ require_parameters:true }`; não fixa DeepInfra ou outro fornecedor do roteamento.
- `response_format.type='json_schema'`, nome `avatar_appearance`, `strict:true`, schema vindo de `avatarSchema()`.
- Não usa `usage.include`.
- Lê e verifica o envelope `choices[0].message.content`, recusa, content filter, finish reason, truncamento e JSON inválido.
- Faz validação local estrita mesmo com Structured Outputs. O pipeline valida outra vez.
- Analyzer não contém retry interno. Retry fica no pipeline.
- Concorrência LPC inicial: OpenRouter/Gemini 2; Ollama 1.
- HTTP 500/502/503/504 permitem uma repetição central com intervalo padrão 1000 ms, dentro do orçamento persistido de até duas tentativas.
- HTTP 429 não recebe retry automático nessa política. 401/403 são configuração/autorização. Falhas seguem o fallback LPC existente.
- `OPENROUTER_AVATAR_TIMEOUT_MS=30000` é o orçamento global de análise do pipeline, incluindo retry/intervalo; não deve virar 30 segundos adicionais por tentativa.
- `AbortSignal` cancela a chamada HTTP real; leases protegem a selfie se alguma implementação/teste demorar a obedecer ao cancelamento.
- Avatares READY não são reanalisados por troca de provider ou restart.
- GERAR OUTRA VERSÃO continua sendo variação local, não uma segunda chamada à IA.

Códigos seguros incluem `OPENROUTER_NOT_CONFIGURED`, `OPENROUTER_TIMEOUT`, `OPENROUTER_AUTH_ERROR`, `OPENROUTER_QUOTA`, `OPENROUTER_UNAVAILABLE`, `OPENROUTER_API_ERROR`, `OPENROUTER_INVALID_RESPONSE`, `OPENROUTER_REFUSED`, `OPENROUTER_TRUNCATED`, `INVALID_JSON`, `INVALID_APPEARANCE`.

Logs podem incluir modelo, HTTP status, duração, tokens e `usage.cost` quando vierem na resposta. Não inventar custo/tokens zero quando ausentes e não persistir custo no SQLite nesta fase. Nunca imprimir token, Authorization, imagem/data URI, request/response completos ou conteúdo bruto da IA em produção.

### TLS corporativo

O usuário observou `OPENROUTER_UNAVAILABLE` com causa `SELF_SIGNED_CERT_IN_CHAIN`. Isso é falha de confiança TLS do Node, não prova de indisponibilidade da API nem de modelo inválido. `npm start` usa `node --use-system-ca server.js`. Quando necessário, usar CA corporativa verificada via `NODE_EXTRA_CA_CERTS` no lançamento. Não desativar a validação TLS. Quebra visual de linha no terminal não prova que o nome do modelo contém uma quebra real.

## 6. Cloudflare, Story, óculos e latência: últimas correções

### Portrait

Cloudflare Workers AI continua responsável exclusivamente pelo portrait, modelo `@cf/black-forest-labs/flux-2-klein-4b`. Sua fila é independente da LPC, concorrência 1. O fallback de portrait/passe não deve quebrar LPC ou entrada.

### Download/compartilhamento

O usuário relatou “A imagem para compartilhar está temporariamente indisponível” e `STORY_RENDER_FAILED` no admin. Story é uma exportação Playwright separada da Cloudflare/OpenRouter. Uma foto pixelada gerada corretamente não garante que o PNG do Story foi renderizado.

As correções locais adicionaram diagnóstico seguro por etapa e recuperação do navegador cacheado quando ele fecha. O canal padrão é `chrome` local e `chromium` em production, com prioridade para `STORY_BROWSER_CHANNEL` explícito. **Instalar o pacote Playwright não basta para instalar o navegador e suas bibliotecas.**

Configurações orientadas ao usuário para Railway/Railpack:

```dotenv
RAILPACK_NODE_PLAYWRIGHT_INSTALL=1
STORY_BROWSER_CHANNEL=chromium
PLAYWRIGHT_BROWSERS_PATH=0
```

São variáveis do serviço/build/runtime, não linhas de código JavaScript. Um novo build/redeploy precisa carregar o navegador. A instalação manual em Linux compatível, quando aplicável, é `npx playwright install --with-deps chromium`. Não instalar a cada download. Esta orientação foi documentada, mas o ambiente real Railway não foi auditado nesta etapa.

Após corrigir o ambiente, REGERAR STORY usa LPC/portrait existentes e não chama IA, mesmo que a selfie já tenha sido apagada. Não é necessário reanalisar a pessoa para gerar outra imagem do crachá.

Códigos do renderer: `STORY_RENDER_FAILED`, `STORY_BROWSER_MISSING`, `STORY_BROWSER_DEPENDENCIES`, `STORY_BROWSER_LAUNCH_FAILED`, `STORY_BROWSER_CLOSED`, `STORY_RENDER_TIMEOUT`, `STORY_ASSET_MISSING`, `STORY_STORAGE_ERROR`, `STORY_ABORTED`.

Etapas: `browser_launch`, `page_create`, `asset_read`, `html_render`, `image_decode`, `screenshot`, `asset_write`. Erros brutos do Playwright podem conter HTML, caminhos e data URI; não devolvê-los ao cliente/log público.

### Óculos indevidos

- Prompt compartilhado LPC agora explicita: rosto visível sem óculos → `glasses=none`; não confundir sobrancelhas/sombras com armação.
- Prompt Cloudflare preserva óculos apenas quando claramente presentes na selfie.
- Havia um fallback de emergência que usava o sprite de demonstração `test-avatar.png`, com óculos.
- `server.js` agora usa `public/assets/avatars/lpc/default-avatar.png` como emergência se a composição padrão falhar.
- O novo PNG foi composto localmente com o mesmo `DEFAULT_AVATAR`, sem óculos; catálogo/mapeador/compositor não foram substituídos.
- **Esse novo PNG ainda está untracked e precisa acompanhar uma futura publicação.**
- Não se removeram óculos à força de todos. Não se alteraram registros READY existentes.
- Um portrait incorreto cuja selfie já foi removida exige nova captura; REGERAR STORY não corrige o portrait original.
- Não houve teste de precisão com selfies reais, portanto não prometer acurácia geral.

### Demora

Foram adicionadas métricas para separar fila, análise, composição e exportação:

- `avatar:analysis-started.queue_wait_ms`.
- OpenRouter `preparation_ms`, `http_ms`, `duration_ms`.
- `avatar:generation-completed.build_ms` e `duration_ms`.
- `portrait:ready.duration_ms` e falhas de tentativa.
- `story:generated.duration_ms` e falhas com etapa.

Não se mudou o modelo, concorrência ou orçamento para mascarar lentidão. Cloudflare executar mais rápido que OpenRouter não é, sozinho, sinal de bug: são serviços e tarefas diferentes. Nenhuma latência real dos provedores foi medida nos últimos testes; as APIs foram simuladas.

## 7. Selfie temporária e privacidade

O check-in exibe aviso antes do envio e exige confirmação de ciência. O backend exige `selfieAiAcknowledged=true` além do checkbox frontend. Metadados mínimos incluem ciência/data e versão do aviso `1.0`.

A foto é normalizada, sem metadados, salva em diretório privado e nunca exposta por static. Preparações JPEG dos analyzers usam buffers em memória; não criar cópias permanentes/thumbnail/backup/cache da selfie.

O arquivo só pode ser apagado quando:

1. Consumidor LPC terminou realmente (READY ou falha/fallback terminal, sem retry restante aplicável).
2. Consumidor portrait terminou realmente (READY ou falha terminal).
3. Não há jobs/leases reais ainda usando a entrada.

`lib/selfieLifecycle.js` mantém leases por UUID. A análise bruta possui lease própria, de modo que um timeout via `Promise.race` não autorize excluir uma imagem que uma chamada subjacente ainda usa. Essa proteção também foi mantida na exclusão administrativa nova.

Depois da exclusão, `photoPath=null`, estado `DELETED` e timestamp. Falha de unlink produz `DELETE_FAILED`, sem fingir sucesso; cleanup pode repetir. Startup e sweep conservador recuperam selfies terminais pendentes. Idade isolada nunca autoriza apagar um arquivo de job ativo.

Avatar, appearance JSON, portrait e Story gerados permanecem independentes da selfie. `/pass/:uuid` funciona sem ela. Reprocessar IA após a exclusão deve ser recusado com mensagem clara pedindo nova foto; não restaurar arquivo nem entrar em retry infinito.

O aviso promete exclusão **do servidor do Mundo // Digital**, sem prometer exclusão de todos os servidores dos provedores externos. Não transformar esta implementação técnica em afirmações jurídicas novas.

## 8. Mundo, POIs, visual, social e câmera

O mundo tem cinco blocos existentes:

- `blockA_upper`: Praça Cívica e Inovação, incluindo braço robótico, impressão 3D e corte a laser.
- `blockB_upper`: Sala de Acesso, almoxarife, administrativo, culinária, ar-condicionado e corte/costura.
- `blockB_lower`: pneumática, hidráulica, metrologia, manutenção mecânica.
- `blockC_upper`: elétrica e solda.
- `blockC_lower`: tornearia, fresadora, CNC, ajustagem, injetora e ponte rolante.

HOME continua sendo `blockB_upper` / `area_access`, Sala de Acesso/Sala 5. Não reconstruir mapa ou um segundo sistema de navegação.

### Visitas — Fase 8.1

- POIs reais possuem visitorSlots, facing, capacidade, peso e intervalo de permanência.
- O slot é reservado antes da caminhada e liberado na saída, remoção, reset ou interrupção.
- POI lotado leva a alternativa/espera existente, sem sobrepor visitantes no mesmo slot.
- Seleção favorece bloco atual: configuração central `WORLD_BEHAVIOR`, probabilidade local 0.85.
- Há histórico curto efêmero de POIs e jitter. Permanência inicial natural usa 4000–9000 ms na configuração atual.
- Trocas de bloco usam navigationNodes e portais existentes, sem teleporte direto ao equipamento.
- `currentBlock/currentArea` refletem transição/localização real, não a simples escolha antecipada de destino.
- Não persistir slot/timer/histórico a cada frame. Persistir a posição/estado espacial relevante já definido.

### Visual — Fase 8.2

- Behaviors pequenos/declarativos: observe, lookAround, curious, inspect com fallback adequado, machineDemo apenas onde configurado.
- Emotes pixelados próprios: attention, curious, sparkle, thinking; não emoji nativo.
- Robô, impressora 3D, CNC e ponte rolante têm microanimações simples documentadas.
- Não depender de animação LPC inexistente. O sprite oficial carregado tem 576×256, células 64×64 e caminhada em quatro direções, com frames idle existentes. Não presumir que sit/wave/slash/etc. estão disponíveis só porque o Universal LPC completo suporta outras ações.
- Inspect/aceno usam fallback discreto quando não há gesto apropriado. Não usar animação de combate contra máquinas.
- Efeitos acompanham avatar, preservam nomes/highlight/HUD e têm cleanup e limites globais por bloco visível.

### Social — Fase 8.3

- Interações são comportamentos visuais de jogo, sem inferir amizade, emoção ou personalidade das pessoas reais.
- Tipos iniciais: ACKNOWLEDGE, LOOK_AT, WAVE com fallback de emote e SHARED_REACTION.
- Proximidade/ocupação/geografia e timing formam pequenos grupos; não há grupo persistido ou grafo social.
- Detecção periódica limitada, não comparação global O(n²) a cada frame.
- `SOCIAL_BEHAVIOR` centraliza chance baixa, cooldown, duração curta, limite de grupos e jitter. Praça pode ser mais social, equipamentos priorizam visita.
- ENTERING/transições críticas não participam. Locks e socialTargetUuid são efêmeros; remoção/portal/reset cancela ambos os lados.

### Tracking e câmera

- Campo de busca, resultados e HOME ficam na própria `/tela`, com controles recolhíveis.
- `/operator` é opção remota autenticada, não uma interface obrigatória adicional.
- Câmera segue o UUID selecionado entre POIs/áreas/blocos, até outro comando; interação social não muda o alvo.
- Zoom roda do mouse, + e -, movimento suave, tecla 0/HOME, resize preservado e HUD fixo fora do zoom do mundo.
- O foco sobrevive ao refresh da TV, mas restart do servidor começa em HOME.
- DebugWorld é operacional/autenticado e não fica habilitado publicamente em production.

Há um script de demonstração com 100 avatares sintéticos, `npm run demo:world -- 100`, banco isolado em `.test-data`, sem IA. Não popular banco real automaticamente. A demonstração exige login da Fase 9A; consultar README para criar conta no DATA_DIR isolado e porta alternativa.

## 9. Estados e entrada

Não confundir estas dimensões:

- `status`: membership operacional, por exemplo CHECKED_IN/INACTIVE.
- `experienceStatus`: REGISTERED, AVATAR_PROCESSING, AVATAR_REVIEW, AVATAR_APPROVED, ENTERING, ACTIVE.
- `avatarStatus`: PENDING, READY, FALLBACK, FAILED.
- `portraitStatus`: PENDING, PROCESSING, READY, FAILED.
- `storyStatus`: estado da exportação, separado das IAs.
- `selfieStatus`: disponibilidade/processamento/remoção/falha de exclusão.
- `credentialState`: projeção para UI, como ASSETS_PROCESSING, PASS_READY e ENTRY_SCHEDULED.

`PASS_READY` não é um novo estado de banco. É derivado de revisão LPC pronta/fallback e portrait resolvido ou espera de apresentação vencida. `AVATAR_APPROVED` é exibido como ENTRY_SCHEDULED.

O fluxo compartilhado `approveEntry(uuid)` chama aprovação no store, agenda entrada e solicita Story/passe pelos serviços existentes. Tempos default: entrada 8000 ms, espaçamento 1000 ms. Cliques repetidos não devem criar dois timers ou personagens.

## 10. Autenticação e acesso

Fase 9A implementada:

- Sessão HTTP com `express-session` e store SQLite persistente, não MemoryStore de produção.
- `admin_users`, hashes Argon2, sem senha padrão/hardcoded.
- Conta inicial via `npm run admin:create` ou `scripts/create-admin.js`, usando o mesmo DATA_DIR do servidor.
- Sessão contém projeção mínima do admin, não hash/senha.
- Cookie HttpOnly, Secure em produção HTTPS, SameSite=Lax; duração padrão 12h.
- SESSION_SECRET externo/estável; APP_ORIGIN e TRUST_PROXY coerentes com reverse proxy real.
- Login genérico, rate limit, logout POST, revogação de sessões/sockets, último admin ativo protegido.
- CSRF/Origin nas mutações; same-origin, sem CORS administrativo aberto com credenciais.
- Socket.IO operacional autenticado por sessão; sessões revogadas não continuam comandando câmera.
- APIs negadas respondem 401/403, páginas operacionais redirecionam para login.
- Sem OAuth/JWT/MFA/RBAC complexo novo.

### Principais rotas públicas

- `/checkin`, `/check-in`, `/check-in.html`.
- `POST /api/check-in`, `GET /api/config`.
- `/pass/:uuid`, `/api/pass/:uuid` e arquivos de assets gerados autorizados para o passe.
- `/avatars/:filename` com nomes UUID/versão validados.
- `/login`, `/api/auth/session`, `/health` mínimo.
- Rotas estritamente públicas de CSS/JS/assets necessários.
- Status/revisão/entrada inicial do próprio cadastro continuam dependendo do **Bearer individual de review**, sem exigir conta administrativa. Público não significa permissão sobre qualquer participante.

### Principais rotas protegidas

- `/`, `/world`, `/tela`, `/operator`, `/admin` e aliases operacionais HTML.
- `/api/world`, `/api/participants` operacional, busca/localização, `/api/operator/*`, `/api/operation/config`, `/api/health` detalhado.
- `/api/admin/operations`, `/api/admin/participants`, detalhes e ações.
- `/api/admin/users` e mutações de contas/senhas.
- `/api/admin/camera/home`, controle de câmera via Socket.IO.
- DELETE global de participantes, retries operacionais e alterações de perfil conforme os gates existentes.
- `POST /logout` com CSRF.

Consultar `docs/authentication.md` para inventário exato. Ele foi escrito na 9A: descrições dizendo que certas ações ainda não existem são históricas; a 9B e a exclusão recente adicionaram APIs protegidas depois.

## 11. Central administrativa existente

`/admin` já contém:

- Contadores do SQLite, sem carregar todos os participantes para contar no frontend.
- Busca por nome parcial/UUID, tolerante a acentos e case; filtros, páginas de 25/50.
- Estados Server/Database/Socket.IO/TV/OpenRouter/Cloudflare/Selfie Cleanup e filas existentes.
- TV ONLINE apenas para sockets mode `live`; admin/operator não contam como TV.
- Status dos provedores é passivo, baseado em configuração e observações de tentativas/sucessos/erros. Não fazer chamadas pagas de healthcheck.
- Drawer VER com estados, tentativas, horários, localização, erro seguro e previews apenas de assets gerados.
- Selfie aparece apenas como estado, nunca como foto/path/thumbnail.
- LOCALIZAR NA TV e IR PARA SALA DE ACESSO reutilizam tracking/HOME.
- REPROCESSAR AVATAR/PORTRAIT respeitam orçamento original, fila, dedup e necessidade de selfie; ficam bloqueados depois de DELETED.
- REGERAR STORY usa assets existentes, sem IA.
- FORÇAR ENTRADA, CANCELAR ENTRADA e REMOVER DO MUNDO reutilizam fluxo e cleanup existentes.
- TENTAR REMOVER NOVAMENTE atua apenas no cleanup de selfie DELETE_FAILED terminal.
- Contas administrativas: listar/criar/desativar/resetar senha/própria senha/logout, reaproveitando a 9A.
- Atividade recente limitada a 50, observabilidade/auditoria efêmera. Não são histórico financeiro ou auditoria persistente nova.

As permissões e os motivos de bloqueio vêm do backend e são revalidados no POST. Há loading, confirmação própria para ações destrutivas, CSRF e `requestId` UUID. O cache de idempotência por admin/ação/alvo é efêmero, limitado e dura cinco minutos. F5 não inicia jobs/retries.

Socket.IO sinaliza `admin:updated` com revisão e até 50 UUIDs, coalescido em 500 ms; o navegador consulta novamente os dados visíveis. Não envia a lista inteira ou selfies a cada mudança. Há consulta periódica de segurança enquanto visível.

## 12. Última tarefa funcional: excluir cadastro abandonado

### Pedido e causa

O usuário relatou que visitantes refaziam uma selfie ruim com outro e-mail. O primeiro cadastro ficava em PASS_READY, não entrava e não podia ser apagado pelo painel.

Diagnóstico: PASS_READY aguarda confirmação, e a ação antiga REMOVER DO MUNDO só se aplica a ENTERING/ACTIVE. Na especificação original da 9B, não havia exclusão de cadastro. **O pedido novo autorizou explicitamente adicionar essa exclusão.** Não manter a proibição antiga como bloqueio a esta funcionalidade já concluída.

### Uso implementado

**`/admin → VER → EXCLUIR CADASTRO → confirmar`.**

- Exclusão definitiva de cadastros que ainda não iniciaram a entrada, incluindo PASS_READY e processamento inicial.
- Entrada agendada também pode ser excluída: o timer é cancelado antes de limpar os arquivos.
- ENTERING, ACTIVE ou participantes com `enteredAt` não podem ser apagados por essa ação. Para eles, permanece REMOVER DO MUNDO, preservando dados/assets/passe.
- Ao excluir, banco, foto temporária eventualmente restante, LPC provisório e versões, portrait, Story e temporários daquele UUID são removidos. Outros participantes/arquivos são preservados.
- O passe antigo passa a não existir e o e-mail fica livre para novo check-in.
- O drawer fecha e lista/contadores se atualizam sem F5.

### Backend e segurança

- Nova ação protegida: `POST /api/admin/participants/:uuid/actions/delete-registration`.
- Body: `{ "requestId": "<uuid aleatório>", "confirm": true }`.
- Mesma sessão/role admin/CSRF/validação de UUID/payload/idempotência das demais ações.
- Novo `lib/participantDeletion.js`, conectado em `server.js` e `lib/adminOperations.js`.
- `retireBeforeEntry()` no `lib/adminQueries.js` muda atomicamente o registro para INACTIVE antes de qualquer await, bloqueando nova aprovação/retry. Se estava agendado, volta à revisão ao encerrar o agendamento.
- Aposenta consumidores pendentes de forma terminal, sem liberar uma selfie com lease ativa.
- Cancela timer de entrada, job LPC via cancelamento existente e portrait/Story por UUID via novo `passService.cancel(uuid)`.
- Aguarda fila/job do participante e leases reais da selfie, incluindo análise que ignorou abort e composição/render em andamento.
- Só então usa cleanup da selfie, remove os assets e executa `deleteBeforeEntry()` guardado no banco.
- Caminhos de remoção são construídos pelo UUID validado dentro de DATA_DIR; remoção recursiva do diretório gerado verifica containment e parent real. Não aceitar path vindo do frontend.
- Se um consumidor não encerrar em dez segundos, retorna 409 seguro, mantém cadastro INACTIVE e a imagem que ainda estiver em uso, e permite tentar EXCLUIR CADASTRO novamente.
- Falha de disco não apaga o registro falsamente. Pode haver limpeza parcial de assets, mas a exclusão é repetível; mensagem não contém path/stack.
- Limpeza global não inicia enquanto houver exclusão individual; shutdown aguarda operações em curso antes de fechar o banco.
- Auditoria `DELETE_PARTICIPANT` mantém UUID/administrador mesmo depois da remoção do registro; não precisa guardar nome/e-mail no evento novo.
- Nenhuma migration, catálogo LPC, IA, câmera, mundo ou navegação foi alterada para esta tarefa.

### Arquivos desta tarefa

Criado: `lib/participantDeletion.js`.

Modificados: `server.js`, `lib/adminQueries.js`, `lib/adminOperations.js`, `lib/passService.js`, `lib/operationEvents.js`, `public/js/adminOperations.js`, `tests/admin-operations.test.js`, `tests/browser/admin-operations.spec.js`, `docs/admin-operations.md`.

Esses arquivos podem também conter mudanças de tarefas anteriores. Não substituir versões inteiras tentando isolar somente a exclusão.

## 13. Produção, persistência e variáveis

Entrypoint `server.js`; `npm start` executa `node --use-system-ca server.js`. O entrypoint carrega `.env` via `process.loadEnvFile()` quando presente. Não há build de frontend nem Docker obrigatório.

`PORT` vem do host, default local 3000; bind `0.0.0.0`. Produção requer `NODE_ENV=production` e DATA_DIR privado explícito, fora de `public`, incluindo proteção contra redirecionamento por symlink.

Estrutura persistente sob DATA_DIR (exemplo de host `/data`, não verificado como volume real do Railway):

```text
DATA_DIR/
  participants.sqlite       # participantes/mundo, WAL/SHM quando abertos
  auth.sqlite               # contas/sessões administrativas persistentes
  photos/<uuid>.png         # selfie PRIVADA e TEMPORÁRIA
  avatars/<uuid>.png        # sprite inicial
  avatars/<uuid>-<hash>.png # versões geradas
  generated/participants/<uuid>/portrait.png
  generated/participants/<uuid>/story.png
  generated/participants/<uuid>/*.tmp   # temporários de escrita, não assets finais
```

Startup cria diretórios necessários. Manter **uma instância e um processo Node**: simulação/filas e SQLite atuais não foram preparados para várias réplicas. Não migrar para Postgres/Redis apenas para esta publicação.

Principais variáveis, sem valores secretos:

| Variável | Uso/default relevante |
| --- | --- |
| NODE_ENV | `production` no host. |
| PORT | Fornecida pelo host; local 3000. |
| DATA_DIR | Diretório privado em volume persistente; obrigatório em production. |
| APP_ORIGIN | Origem HTTPS exata da aplicação em produção. |
| TRUST_PROXY | Proxy/hops confiáveis reais; não aceitar headers falsos de conexão direta. |
| SESSION_SECRET | Segredo forte/estável externo, nunca versionado. |
| SESSION_MAX_AGE_HOURS | 12 por padrão, limites definidos na autenticação. |
| AVATAR_PROVIDER | `openrouter` para fluxo atual; alternativas preservadas. |
| OPENROUTER_API_KEY | Backend somente. |
| OPENROUTER_AVATAR_MODEL | `qwen/qwen3-vl-30b-a3b-instruct`. |
| OPENROUTER_AVATAR_TIMEOUT_MS | 30000. |
| CLOUDFLARE_ACCOUNT_ID | Conta Workers AI. |
| CLOUDFLARE_API_TOKEN | Backend somente. |
| CLOUDFLARE_PORTRAIT_MODEL | `@cf/black-forest-labs/flux-2-klein-4b`. |
| CLOUDFLARE_PORTRAIT_TIMEOUT_MS | 120000. |
| STORY_BROWSER_CHANNEL | `chromium` no host; `chrome` nesta máquina. |
| PLAYWRIGHT_BROWSERS_PATH | `0` orientado para build/runtime no Railway. |
| RAILPACK_NODE_PLAYWRIGHT_INSTALL | `1` orientado para instalar navegadores/runtime no Railpack. |
| WORLD_ENTRY_DELAY_MS | 8000. |
| WORLD_ENTRY_SPACING_MS | 1000. |
| AVATAR_MAX_ATTEMPTS | 2 versões locais na revisão; não confundir com tentativas pagas. |
| PASS_PORTRAIT_WAIT_MS | 15000, apresentação da credencial. |
| EVENT_EDITION | `2026` por padrão. |
| EVENT_INSTAGRAM_HANDLE | Opcional; vazio não inventa/exibe perfil institucional. |
| EVENT_HASHTAG | Opcional; se usar `#` em `.env`, colocar entre aspas. |
| PASS_DEFAULT_ROLE, PASS_DEFAULT_ORGANIZATION | Opcionais, neutros. |
| SELFIE_PRIVACY_POLICY_URL | Link HTTPS/caminho local opcional. |
| GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TIMEOUT_MS, GEMINI_LOG_RESPONSE | Somente provider alternativo Google; timeout default 180000, logs brutos desativados em production. |
| OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_MS, OLLAMA_LOG_RESPONSE | Provider local alternativo; base local 11434, timeout default 0 conforme contrato existente. |
| NODE_EXTRA_CA_CERTS | Opcional, CA corporativa verificada no lançamento. |

`GET /health` é público e mínimo, sem chamada paga. Status detalhado fica autenticado. HTTPS termina no proxy/plataforma; cookies Secure dependem de proxy/origem corretos. SIGTERM/SIGINT encerram com trava, filas, checkpoint e fechamento dos bancos.

**`.env.example` está ausente no checkout atual.** O usuário o removeu no commit `ff93a88`. Há referências antigas a ele em documentos; não presumir que o arquivo existe nem recriá-lo sem necessidade da tarefa.

## 14. Git e segurança: estado verificado nesta retomada

Últimos commits observados:

```text
0d3a66f Add QR Code to digital pass
ff93a88 Delete .env.example
5c54b47 Prepare Mundo Digital for production
```

O QR foi solicitado para `/tela` e aponta ao check-in Railway. O nome da mensagem de commit acima não deve ser tratado como especificação da posição do QR; conferir o código se for necessário alterá-lo.

Working tree observada antes de criar este CONTEXT.md:

```text
 M .gitignore
 M docs/admin-operations.md
 M docs/portrait-pass.md
 M docs/production.md
 M lib/adminOperations.js
 M lib/adminQueries.js
 M lib/avatarPipeline.js
 M lib/cloudflarePortrait.js
 M lib/geminiAvatarAnalyzer.js
 M lib/openRouterAvatarAnalyzer.js
 M lib/operationEvents.js
 M lib/passService.js
 M lib/storyRenderer.js
 M public/js/adminOperations.js
D  "railway ssh"
D  "railway ssh.pub"
 M server.js
 M tests/admin-operations.test.js
 M tests/avatar-pipeline.test.js
 M tests/browser/admin-operations.spec.js
 M tests/lpc.test.js
 M tests/openrouter-avatar-analyzer.test.js
 M tests/portrait-pass.test.js
?? lib/participantDeletion.js
?? public/assets/avatars/lpc/default-avatar.png
```

Este arquivo passa a ser outro arquivo novo. Conferir novamente `git status` ao retomar; não presumir que o usuário não fez commits depois.

### Chave Railway anteriormente versionada

O usuário pediu para ignorar a chave Railway. Foram adicionadas entradas exatas `/railway ssh` e `/railway ssh.pub` ao `.gitignore` e executado `git rm --cached` para retirar do índice **sem apagar os arquivos locais**. As duas remoções estão staged.

**A chave privada já esteve rastreada no histórico.** Ignorar e remover do índice não limpa commits anteriores. O usuário foi avisado para revogar/substituir a chave. Não há confirmação de rotação; não presumir que ocorreu. Não reabrir/imprimir a chave, não fazer `git diff --cached` integral que possa mostrar seu conteúdo e não reescrever histórico sem autorização.

O `.gitignore` também ignora `.env`/`.env.*` (com exceção para `.env.example`), node_modules, data, .test-data, bancos/WAL/SHM, logs, uploads, photos, temporários, relatórios de testes e formatos usuais de chaves. Se for preparar commit, revisar nomes/candidatos sem expor segredos. A permissão para a edição local não implica push/deploy.

## 15. Testes e execução local

Comandos principais no PowerShell:

```powershell
node --version
npm.cmd ci
npm.cmd start
npm.cmd run admin:create
npm.cmd test
npx.cmd playwright test tests/browser/admin-operations.spec.js --reporter=line
```

Não executar `npm ci` automaticamente só para reler o contexto; dependências já estavam instaladas. `npm test` enumera os arquivos de teste explicitamente em package.json; se criar um arquivo novo de testes, ele não entra automaticamente nessa suíte.

Fixtures usam bancos isolados em `.test-data`, imagens sintéticas, mocks e login HTTP real via `tests/helpers/authenticatedApplication.js` / `browserAuth.js`; não há bypass de autenticação de produção. Não usar banco/fotos reais para testes destrutivos.

### Última validação concluída, 05/11/2026

| Verificação | Resultado |
| --- | --- |
| Suíte Node completa final | **190/190 aprovados**, sem falhas, aproximadamente 60,1 s. |
| Arquivo administrativo | 20 cenários após a inclusão final do cancelamento de Story; fazem parte dos 190 testes. |
| Chrome, `tests/browser/admin-operations.spec.js` | **3/3 aprovados**, aproximadamente 17,5 s. |
| `git diff --check` nos arquivos da tarefa e `node --check lib/participantDeletion.js` | Sem erro; avisos normais de LF/CRLF no Windows. |

Logs locais ignorados:

- `.test-data/admin-deletion-regression-chrome.log`: execução final completa aprovada.
- `.test-data/admin-deletion-browser.log`: três testes Chrome aprovados.
- `.test-data/admin-deletion-tests.log`: execução administrativa intermediária com 19 testes, antes do último teste Story.
- `.test-data/admin-deletion-regression.log` e `admin-deletion-regression-final.log`: tentativas anteriores, com falha de Story no smoke de produção por ambiente de navegador. Não confundir com a execução final corrigida.

**Particularidade importante:** nesta máquina o Chrome está instalado, mas o Chromium do Playwright não. O smoke de produção real precisa de navegador e o código escolhe Chromium por default em production. A execução final passou configurando **somente o processo do teste** com `STORY_BROWSER_CHANNEL=chrome` e permitindo execução do Chrome fora das restrições do sandbox. Não foi alterado `.env` nem o Railway.

Exemplo equivalente para a suíte neste ambiente:

```powershell
$previousStoryChannel = $env:STORY_BROWSER_CHANNEL
try {
  $env:STORY_BROWSER_CHANNEL = 'chrome'
  npm.cmd test
} finally {
  if ($null -eq $previousStoryChannel) {
    Remove-Item Env:STORY_BROWSER_CHANNEL -ErrorAction SilentlyContinue
  } else {
    $env:STORY_BROWSER_CHANNEL = $previousStoryChannel
  }
}
```

Os testes novos cobrem confirmação, autenticação/CSRF, idempotência, PASS_READY, reutilização do e-mail, arquivos de outro participante preservados, proteção de ENTERING/ACTIVE, cancelamento de entrada agendada, portrait queued/running, analyzer que ignora abort, composição LPC em andamento, Story em andamento, falha de disco e retry após timeout.

Os testes Chrome conferem lista/drawer/câmera/TV, Story e remoção do mundo existentes, força/cancelamento de entrada e exclusão definitiva com cancelar/confirmar, contadores atualizados, proteção de participante ativo e refresh sem ressuscitar cadastro.

### Cuidados com o ambiente de ferramentas

- PowerShell: usar `Get-Content -Encoding UTF8` para arquivos de texto do projeto. Redirecionamento nativo `*>` pode criar logs UTF-16LE; lê-los com PowerShell se a decodificação estiver estranha.
- Evitar passar texto português literal para Node através de pipelines PowerShell que possam transformar Unicode em `?`; preferir edição por patch.
- O Playwright default usa porta 3010 e `test-results`; não iniciar várias execuções default em paralelo.
- Chrome/child processes e alterações no índice `.git` podem exigir aprovação/escalation no ambiente restrito. Isso não significa permissão para acessar produção.
- Um gerenciador de senhas externo já interceptou clique em teste de alteração de senha; foi contornado com Tab antes do clique real. Não atribuir automaticamente esse overlay ao aplicativo.

## 16. Documentação de apoio e próximos passos possíveis

Ler conforme a tarefa, sem reler tudo ou implementar uma nova fase por conta própria:

- `docs/admin-operations.md`: ações, exclusão recente, segurança e validações.
- `docs/authentication.md`: classificação de rotas, sessão, CSRF, contas e proxy.
- `docs/selfie-privacy.md`: estados/leases, exclusão terminal e recovery.
- `docs/portrait-pass.md`: diagnóstico de Story/óculos/latência, portrait e passe.
- `docs/production.md`: volume, variáveis, navegador no host, startup e smoke.
- `docs/credential-flow.md`, `docs/avatar-experience.md`: aprovação, passe e entrada.
- `docs/avatar-pipeline.md`, `docs/ollama-avatar.md`, `docs/lpc-avatar-options.md`, `CREDITS-LPC.md`: pipeline, alternativa local, assets/licenças.
- `docs/macro-world.md`, `docs/poi-visits.md`, `docs/visit-visual-behavior.md`, `docs/social-behavior.md`: mundo e fases 8.1/8.2/8.3.
- `docs/operator-tracking.md`: busca, HOME e tracking.
- `docs/branding.md`: neutralização textual preservando identidade visual e identificadores técnicos.

Há textos históricos/desatualizados em alguns documentos, incluindo referências a `.env.example` e frases de fases anteriores dizendo que exclusão de cadastro ainda não existe. As seções atualizadas e o código prevalecem. Não aproveitar a retomada para uma revisão geral de documentação ou encoding não solicitada.

**Não há tarefa funcional em aberto nesta conversa após a exclusão administrativa.** Os próximos passos operacionais possíveis, dependentes da próxima instrução, são revisar/commitar as alterações locais e publicar uma nova versão no Railway, conferir o ambiente do Story e concluir a rotação da chave SSH anteriormente versionada. Nenhum deles foi executado automaticamente.

A resposta final da última tarefa informou ao usuário que `PASS_READY` aguarda confirmação, que o novo botão é VER → EXCLUIR CADASTRO, que a exclusão libera o e-mail, que participantes já em entrada/mundo ficam protegidos e que a atualização ainda precisa ser publicada para aparecer no Railway.

## Dedicated portrait key update

`OPENROUTER_PORTRAIT_API_KEY` now takes priority for portrait requests. If absent, the shared key remains the compatibility default; if explicitly empty, portrait requests fail safely instead of charging the shared key. Pipeline A continues using only `OPENROUTER_API_KEY`. The dedicated variable was added to the local `.env` without copying or printing any secret; the user must fill it locally.
