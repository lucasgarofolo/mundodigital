# Fase 5 — portrait e crachá compartilhável

## Seleção de provedor e fallback opcional (06/11/2026)

Configure somente no backend e reinicie o Node. Não há seletor administrativo. `AVATAR_PROVIDER`, o modelo Qwen e o Pipeline A permanecem independentes.

```dotenv
PORTRAIT_PROVIDER=cloudflare
PORTRAIT_FALLBACK_ENABLED=false
PORTRAIT_FALLBACK_PROVIDER=openrouter
OPENROUTER_PORTRAIT_MODEL=black-forest-labs/flux-3-image-klein
OPENROUTER_PORTRAIT_TIMEOUT_MS=120000
```

| Variável | Regra/default |
| --- | --- |
| `PORTRAIT_PROVIDER` | `cloudflare` (default) ou `openrouter`. |
| `PORTRAIT_FALLBACK_ENABLED` | Exatamente `true` ou `false`; default `false`. |
| `PORTRAIT_FALLBACK_PROVIDER` | `cloudflare` ou `openrouter`; default `openrouter`. Ignorada quando desabilitado. Quando habilitado, deve diferir do principal. |
| `OPENROUTER_PORTRAIT_API_KEY` | Chave exclusiva para portraits, permitindo separar gastos. Se definida mas vazia, bloqueia a chamada até ser preenchida. |
| `OPENROUTER_API_KEY` | Chave do Pipeline A. Usada por compatibilidade nos portraits somente se `OPENROUTER_PORTRAIT_API_KEY` não estiver definida. |
| `OPENROUTER_PORTRAIT_MODEL` | Default `black-forest-labs/flux-3-image-klein`; independente de `OPENROUTER_AVATAR_MODEL`. |
| `OPENROUTER_PORTRAIT_TIMEOUT_MS` | Inteiro de 1 a 600000 ms; default 120000 por chamada. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Credenciais existentes, necessárias se Cloudflare participar. |
| `CLOUDFLARE_PORTRAIT_MODEL` | Default histórico `@cf/black-forest-labs/flux-2-klein-4b` preservado; também aceita `@cf/black-forest-labs/flux-2-klein-9b`, informado para a operação atual. |
| `CLOUDFLARE_PORTRAIT_TIMEOUT_MS` | Configuração existente; default 120000 ms. |

Valores inválidos da seleção impedem a inicialização com mensagem indicando a variável. Configuração do provedor não utilizado não interfere. A ausência de credenciais mantém o erro seguro `PORTRAIT_NOT_CONFIGURED`, sem fallback automático.

| Modo | `PORTRAIT_PROVIDER` | `PORTRAIT_FALLBACK_ENABLED` | `PORTRAIT_FALLBACK_PROVIDER` | Chamadas |
| --- | --- | --- | --- | --- |
| A | `cloudflare` | `false` | ignorada | Cloudflare somente |
| B | `openrouter` | `false` | ignorada | OpenRouter somente |
| C | `cloudflare` | `true` | `openrouter` | Cloudflare; OpenRouter apenas após falha elegível |
| D | `openrouter` | `true` | `cloudflare` | OpenRouter; Cloudflare apenas após falha elegível |

`lib/portraitProvider.js` escolhe os dois serviços diretamente, sem novas filas. Cada geração tenta cada provedor no máximo uma vez. Não há retry automático da sequência pelo `passService`, inclusive nos modos exclusivos. Isso substitui a repetição automática antiga para os provedores reais, evitando novas cobranças; a política antiga permanece apenas para geradores injetados que não sinalizam `retryable=false`. O orçamento persistido de duas gerações por participante e as regras de retry manual/restart permanecem; uma geração com fallback pode conter duas chamadas remotas.

Fallback é elegível para HTTP 402 (saldo/cota), 408, 429, qualquer 5xx, timeout local, cota Cloudflare explícita (3036) e códigos conhecidos de falhas transitórias de rede. HTTP 401/403, outras requisições inválidas, imagem inválida, resposta inválida, configuração, falhas de certificado TLS e cancelamento por exclusão/shutdown nunca acionam fallback. Erros não reconhecidos são conservadoramente terminais. Se ambos falharem, o portrait fica `FAILED` e o crachá mantém o comportamento existente.

`lib/openRouterPortrait.js` envia a selfie privada armazenada, com MIME detectado nos bytes, para `POST https://openrouter.ai/api/v1/images`, usando `input_references` e `aspect_ratio: "1:1"`. Extrai `data[0].b64_json`, não o envelope Cloudflare. Ambos reutilizam o prompt literal existente e a normalização Sharp de `lib/portraitImage.js` para PNG 512×512. Não baixa URLs remotas arbitrárias. [Contrato oficial do OpenRouter](https://openrouter.ai/blog/tutorials/image-generation/), [erros oficiais Cloudflare](https://developers.cloudflare.com/workers-ai/platform/errors/).

O cache READY, recuperação do PNG gravado, caminhos, escrita atômica, banco e leases das selfies permanecem. Trocar provedor não regenera portraits existentes. Logs `portrait:provider-started/ready/failed` e `portrait:fallback` registram provedor, modelo, duração, código/status e custo numérico quando retornado, sem selfie/Base64/chave/resposta bruta. A observabilidade existente atribui a tentativa ao serviço correto; não há novo painel.

### Verificação manual dos quatro modos

1. Use ambiente local com DATA_DIR de teste, credenciais próprias e uma selfie autorizada. Ajuste a linha correspondente da tabela e reinicie `npm.cmd start`.
2. Faça um cadastro novo para cada modo. Confirme os eventos `portrait:provider-*`, a imagem no crachá e o PNG 512×512. Nos modos A/B nunca deve aparecer o outro provedor. Nos modos C/D, sucesso do principal não deve gerar `portrait:fallback`.
3. Para falhas elegíveis, execute `node --test tests/portrait-providers.test.js`: os mocks exercitam ambos os sentidos com 429, 5xx, timeout, rede e falhas permanentes. Não esgote créditos nem altere credenciais para simular quota: chave inválida deve bloquear fallback. Para conferir com API real, use somente uma indisponibilidade/cota já observada e veja uma tentativa de cada provedor.
4. Reinicie com outro provedor e abra novamente um passe READY: nenhuma chamada deve ocorrer. REGERAR STORY reutiliza a imagem salva.

Limites: testes usam mocks/imagens sintéticas, sem validar semelhança facial real ou consumir créditos. O prompt mantém identidade, fundo #D9D9D9, cabeça/ombros e RPG 16-bit; a obediência visual depende do modelo. Com fallback, os dois timeouts podem se somar (aproximadamente 240 s com defaults), e os dois provedores podem cobrar trabalho realizado. Uma queda do processo antes de persistir o PNG ainda pode causar nova chamada na recuperação, como antes. A franquia gratuita não é garantida pelo código.

Validação local final: `npm test` **232/232 aprovados** (aproximadamente 70 s), incluindo o Pipeline A, exclusão/leases, cache/restart e Story real com Chrome. Arquivo específico de provedores: **41/41 aprovados**. `git diff --check` e sintaxe dos três módulos novos sem erros. Logs ignorados: `.test-data/portrait-providers-regression-final.log` e `.test-data/portrait-providers-unit-final.log`. O canal Chrome foi definido somente no processo de teste, sem editar `.env` ou Railway.

## Diagnóstico local de download, óculos e demora

“A imagem para compartilhar está temporariamente indisponível” corresponde a `storyStatus=FAILED`: a exportação PNG falhou no servidor. Isso é separado do portrait Cloudflare e da análise OpenRouter. O renderer agora registra códigos seguros com etapa, sem HTML, paths, dados pessoais ou mensagens brutas do navegador:

- `STORY_BROWSER_MISSING`: o navegador escolhido não foi instalado ou não está acessível no runtime.
- `STORY_BROWSER_DEPENDENCIES`: faltam bibliotecas do sistema para o Chromium.
- `STORY_BROWSER_CLOSED`: o processo do navegador foi fechado; a próxima exportação abre um novo processo.
- `STORY_RENDER_TIMEOUT`: prazo de uma operação do navegador excedido.
- `STORY_ASSET_MISSING`: falta LPC, portrait ou CSS necessário à exportação.
- `STORY_STORAGE_ERROR`: falha de escrita/permissão/espaço no armazenamento.

O canal padrão é `chrome` localmente e `chromium` em `NODE_ENV=production`. `STORY_BROWSER_CHANNEL` explícito continua tendo prioridade. Instalar o pacote npm `playwright` não instala automaticamente o binário/bibliotecas necessários. No Railway com **Railpack**, a configuração oficial `RAILPACK_NODE_PLAYWRIGHT_INSTALL=1` habilita instalação dos navegadores e pacotes de runtime; manter `STORY_BROWSER_CHANNEL=chromium` e `PLAYWRIGHT_BROWSERS_PATH=0` coerentes entre build/runtime. Isso é orientação de configuração, não comprovação de que esse é o erro do serviço publicado. [Railpack: Playwright](https://railpack.com/languages/node/#playwright).

Depois de corrigir o ambiente, **REGERAR STORY** no admin usa somente LPC/portrait existentes. Não precisa recuperar a selfie nem pagar outra chamada de IA. O renderer reinicia também após um navegador cacheado se desconectar. O tamanho e layout do Story continuam 1080×1920.

Os prompts agora explicitam: preservar óculos somente se claramente presentes na foto; rosto visível sem óculos significa `glasses=none` na análise LPC. O catálogo e o mapeamento continuam iguais. O antigo sprite de demonstração possuía óculos e era usado em emergência quando o compositor padrão falhava. A emergência agora usa `default-avatar.png`, gerado pelo mesmo compositor com `DEFAULT_AVATAR` (sem óculos); `test-avatar.png` continua exclusivo da demonstração/prova de conceito. Não há remoção forçada de óculos de pessoas que realmente os usam.

Isso não reescreve portraits ou avatares READY já existentes. Retrato incorreto cuja selfie foi apagada exige nova captura; regenerar o Story recompõe o crachá com os assets atuais, sem corrigir automaticamente a foto.

Tempos disponíveis nos logs, todos em milissegundos:

- `avatar:analysis-started.queue_wait_ms`: espera na fila LPC, antes de começar a análise.
- `[OpenRouter] preparation_ms`: leitura e preparação da imagem antes do HTTP.
- `[OpenRouter] http_ms`: chamada HTTP e recebimento da resposta JSON.
- `[OpenRouter] duration_ms`: analisador completo, incluindo validação.
- `avatar:generation-completed.build_ms`: composição local LPC depois da análise.
- `portrait:ready.duration_ms`: tentativa Cloudflare e gravação do portrait.
- `story:generated.duration_ms` ou `story:generation-failed.duration_ms`: exportação do Story.

O Qwen continua sendo `qwen/qwen3-vl-30b-a3b-instruct`, com a mesma requisição, roteamento, concorrência 2, timeout e política de retry. Cloudflare continua em fila independente de concorrência 1. Não há chamada de healthcheck paga, troca automática de provider, aumento de concorrência ou custo para tentar esconder a espera. Preço de serviços diferentes não determina qual tarefa/modelo termina primeiro; medir fila e HTTP evita atribuir toda a espera à API. [OpenRouter: desempenho e latência](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/latency-and-performance.mdx).

Validação local de 05/11/2026: 182 testes Node e dois testes Chrome de crachá aprovados. Cobertura nova: fallback LPC neutro reproduzível, classificação segura de erros do Story, recuperação de navegador fechado e regeneração sem selfie/IA. A exportação real PNG e o download/compartilhamento em desktop/mobile também passaram. Não houve medição de latência real dos provedores nem teste de qualidade com fotos de pessoas; as IAs foram simuladas, sem custo. A instrução de óculos foi corrigida, mas não permite prometer precisão geral do modelo.

> Atualiza??o de privacidade: a selfie privada agora ? tempor?ria e ? apagada ap?s ambos os consumidores encerrarem. Consulte a [pol?tica atual](selfie-privacy.md). Assets gerados e metadados permanecem; descri??es de reten??o permanente abaixo s?o hist?ricas.

O portrait do crachá é independente do avatar Universal LPC. Nenhum arquivo de Phaser, sprite, catálogo, compositor ou analisador LPC foi alterado nesta fase. O fluxo foi atualizado para [crachá como credencial](credential-flow.md): o check-in inicia LPC e portrait em paralelo, e o botão de entrada do crachá representa a aprovação. A lentidão ou falha da Cloudflare não interfere nos oito segundos, na caminhada pela porta nem no estado `ACTIVE`.

## Configuração

Preencha somente no `.env` do backend e reinicie o Node:

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_PORTRAIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_PORTRAIT_TIMEOUT_MS=120000
PASS_PORTRAIT_WAIT_MS=15000
EVENT_EDITION=2026
EVENT_INSTAGRAM_HANDLE=
EVENT_HASHTAG="#MundoDigital"
PASS_DEFAULT_ROLE=
PASS_DEFAULT_ORGANIZATION=
STORY_BROWSER_CHANNEL=chrome
```

`CLOUDFLARE_ACCOUNT_ID` deve ser o identificador de conta de 32 caracteres hexadecimais. O token precisa permitir Workers AI nessa conta. Não coloque credenciais no navegador. Campos de função, instituição, Instagram e hashtag são opcionais; vazios não criam dados fictícios. `EVENT_HASHTAG` pode ser apagado se não quiser exibi-lo. A configuração antiga `AVATAR_PROVIDER=ollama`/`gemini`/`local` continua controlando somente o avatar do mundo.

`playwright` passou a ser dependência de execução, além de `@playwright/test` já existente nos testes. A exportação usa o Chrome instalado (`STORY_BROWSER_CHANNEL=chrome`). Em um servidor sem Chrome, instale o navegador do Playwright e configure o canal adequado antes de habilitar a exportação; o portrait e a entrada continuam independentes de falhas do navegador.

## Cloudflare e multipart

`lib/cloudflarePortrait.js` concentra os modelos Cloudflare permitidos, o prompt aprovado compartilhado e a chamada (exemplo com o default):

```text
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-klein-4b
Authorization: Bearer {CLOUDFLARE_API_TOKEN}
```

Usa `FormData` nativo com `prompt`, `width="512"`, `height="512"` e `input_image_0` como `Blob` binário PNG. Não define `Content-Type` manualmente: o cliente HTTP gera o boundary. O prompt base foi preservado, sem acrescentar descrições pessoais. Usa a selfie privada já armazenada pelo check-in, antes da análise e composição LPC. Essa foto já é normalizada pelo fluxo anterior para PNG, até 1024 pixels e sem metadados; não se guarda uma segunda cópia bruta do upload.

Valida `success === true`, `result.image`, Base64, limite de tamanho e decodificação de imagem. Sharp normaliza o resultado em PNG 512×512. O Base64 permanece no backend. Logs contêm somente etapa, referência curta do UUID e códigos/status de erro, sem mensagens remotas arbitrárias, chaves ou imagens.

Referência oficial: [Cloudflare FLUX.2 Klein 4B](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/).

## Persistência e filas

Migração aditiva SQLite versão 6 na tabela `participants`:

- `portrait_status`: `PENDING` → `PROCESSING` → `READY` ou `FAILED`.
- `portrait_path`, `portrait_generated_at`, `portrait_requested_at`, `portrait_attempts`.
- `pass_number`, `pass_role`, `pass_organization`, `pass_profile_tag`, `pass_highlight`.
- `story_status`, `story_hash`, `story_generated_at`.

`PENDING` inicia a preparação do portrait após o cadastro, em paralelo ao LPC e antes da entrada. `portrait_requested_at` distingue uma solicitação efetiva de registros antigos; migrar o banco não dispara portraits de todos os visitantes antigos. O passe recebe um número como `MS26-12AB34CD56EF`, com índice único, separado do UUID exibido na URL.

`lib/passService.js` tem filas independentes para portrait e Story, uma tarefa de cada tipo por vez. O registro da solicitação e o início da tentativa são condicionais no banco. Um conjunto por UUID evita duplicidade também em memória. Repetir aprovação, abrir o crachá, F5, reconectar a TV ou reiniciar o Node com `READY` não chama a Cloudflare novamente.

Há no máximo **duas gerações por participante**, persistidas. Cada geração usa a seleção/fallback descrita acima, sem repetir um provedor automaticamente. Falhas ficam em `FAILED`; uma tentativa manual restante depende da selfie ainda disponível e das regras existentes. Sem credenciais, o crachá abre com placeholder e o LPC segue normal. Após clicar em entrar, o Story pode usar placeholder enquanto aguarda o portrait e ser atualizado depois. Não existe repetição infinita.

No restart, uma tentativa interrompida é retomada dentro desse orçamento. Um `portrait.png` válido já gravado antes de uma interrupção no commit é recuperado sem nova chamada. Se o provedor concluiu a geração mas o processo caiu antes de salvar a imagem, não é possível provar conclusão remota; a retomada pode consumir a segunda tentativa. A proteção é para um servidor Node com este banco, não um sistema distribuído de múltiplas instâncias.

Arquivos ficam em:

```text
<DATA_DIR>/generated/participants/<uuid>/portrait.png
<DATA_DIR>/generated/participants/<uuid>/story.png
```

A escrita usa arquivo temporário e rename antes de marcar `READY`. A limpeza administrativa cancela trabalhos e remove esses arquivos junto aos cadastros, com validação do diretório de destino.

## Crachá e dados públicos

O cadastro abre diretamente `/pass/:uuid`, onde o dono confirma a entrada no próprio crachá. `/api/pass/:uuid` entrega somente dados destinados ao passe e o cartão HTML escapado. Não expõe e-mail, selfie, token de revisão, aparência JSON, caminhos privados ou campos administrativos. Arquivos públicos são limitados a `portrait.png` e `story.png`; o Story só fica acessível depois de solicitar entrada. A selfie continua privada.

`lib/passView.js` define o conjunto público e o cartão compartilhado entre web e exportação. `public/css/pass.css` adapta a composição:

- Cabeçalho Mundo // Digital e edição, selo e identidade do passe.
- Portrait à esquerda, nome e informações reais ao centro, LPC grande à direita.
- Número do passe e redes configuradas no rodapé.
- No celular, portrait e LPC ficam lado a lado e os textos abaixo.

A referência de imagem mencionada no pedido não estava anexada; o layout foi baseado na descrição e na identidade existente do projeto. Nenhuma marca Google Cloud foi copiada. O LPC é um frame estático do PNG já aprovado, exibido via CSS sprite e `image-rendering:pixelated`. Não há nova geração, modificação do spritesheet ou alteração no Phaser.

Função, instituição, tag e destaque não são inferidos. Podem vir dos defaults explícitos do evento ou ser informados pelo dono via `PUT /api/participants/:uuid/pass-profile`, com `Authorization: Bearer <reviewToken>`, corpo JSON contendo apenas `role`, `organization`, `profileTag`, `highlight` (até 80 caracteres por campo). Não foi redesenhado o formulário para exigir esses dados.

Durante processamento, o crachá mostra “Preparando seu portrait…” e consulta a API a cada dois segundos. Em falha, mantém o LPC e o restante do cartão. A opção de tentar novamente só aparece no navegador que possui a sessão do participante; o servidor valida o token e o limite. `POST /api/participants/:uuid/retry-portrait` é o retry protegido. Abrir esse link público em outro dispositivo não revela nem recupera o token do dono.

## Story e compartilhamento

`lib/storyRenderer.js` usa Playwright para renderizar HTML/CSS próprio em viewport **1080×1920**, escala 1, e exportar PNG. Os dois assets são carregados de arquivos locais; a página de renderização não busca recursos externos. A composição vertical reposiciona os blocos em vez de esticar o cartão horizontal.

O hash inclui nome, campos opcionais, número do passe, URLs dos assets, data do portrait e configuração visual relevante. Exportação pronta e hash igual reutilizam o PNG; mudanças de perfil/configuração geram outro Story, sem refazer o portrait. Falha de renderização marca `story_status=FAILED` sem invalidar o portrait ou o LPC. O restart permite tentar a exportação local novamente. GET comum nunca renderiza nem gera portrait.

Depois do clique em entrar, `public/js/pass.js` prepara um `File` PNG para compartilhamento. **COMPARTILHAR** verifica `navigator.canShare({files:[file]})` e usa `navigator.share` com o arquivo se disponível. Isso abre o compartilhamento nativo; não publica automaticamente no Instagram nem exige que o Instagram esteja instalado. **BAIXAR MEU CRACHÁ** baixa o PNG. Sem compartilhamento de arquivos, COMPARTILHAR também faz download. O texto orienta a publicar depois e marcar a escola, sem inventar um handle. Cancelar o share sheet não força download.

O suporte real ao share sheet depende do navegador, sistema e contexto seguro (HTTPS/localhost). Os testes de navegador simulam as funções nativas; a seleção real de Instagram/WhatsApp continua sendo validação manual no celular.

## Validação

Executados testes de multipart real com servidor HTTP local, prompt e bytes da selfie, validação Base64/imagem, persistência do PNG, aprovação repetida, falhas e orçamento de tentativas, portrait em paralelo com entrada, restart, recuperação de arquivo após interrupção, invalidação do Story, privacidade e cancelamento na limpeza. A exportação usa Chrome real e verifica PNG 1080×1920.

Resultado após a atualização para credencial: **36 testes de servidor e 16 testes de navegador passaram**. Confira os novos estados, testes de preparação paralela e espera limitada no [fluxo atual do crachá](credential-flow.md).

Os testes de navegador verificam processamento/refresh, página responsiva, campos ausentes e opcionais, nome longo, portrait e LPC simultâneos, ausência de overflow, Story sem cortes, `navigator.canShare`, compartilhamento do arquivo PNG correto, download e cache. As regressões anteriores da Sala 5, LPC, câmera/HUD, selfie e persistência continuam na suíte.

**Limite de validação:** a resposta Cloudflare e os portraits dos testes são simulados; não foi enviada selfie real ao serviço nem houve consumo de geração nesta validação. As credenciais agora foram detectadas configuradas, sem expor os valores. A semelhança, o estilo pixel art e a uniformidade do fundo do resultado real continuam sendo conferências manuais com selfie autorizada.

## Arquivos

Criados: `lib/cloudflarePortrait.js`, `lib/passService.js`, `lib/passView.js`, `lib/passRoutes.js`, `lib/storyRenderer.js`, `public/pass.html`, `public/css/pass.css`, `public/js/pass.js`, `tests/portrait-pass.test.js`, `tests/browser/pass.spec.js`, `docs/portrait-pass.md`.

Modificados: `server.js`, `lib/store.js`, `public/check-in.html`, `public/js/check-in.js`, `public/css/check-in.css`, `.env.example`, `.env` (somente novos campos, sem alterar chaves existentes), `package.json`, `package-lock.json`, `tests/persistence.test.js`, `tests/browser/avatar-pipeline.spec.js`, `tests/browser/checkin.spec.js`, `README.md`. Os dois testes antigos de navegador foram alinhados ao tamanho LPC de 1,5 já aprovado na fase anterior e à espera de oito segundos já existente; isso não alterou o LPC nem a duração da entrada.
