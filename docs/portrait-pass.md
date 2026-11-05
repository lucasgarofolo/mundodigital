# Fase 5 — portrait e crachá compartilhável

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

`lib/cloudflarePortrait.js` concentra o modelo fixo, o prompt aprovado e a chamada:

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

Há no máximo **duas tentativas totais por participante**, persistidas. HTTP 429/500/502/503/504 e falha de transporte permitem uma repetição após um segundo. Falhas permanentes ficam em `FAILED`; o dono pode usar uma tentativa restante depois de corrigir a configuração. Sem credenciais, o crachá abre com fallback e o LPC segue normal. Após clicar em entrar, o Story pode usar placeholder enquanto aguarda o portrait e ser atualizado depois. Não existe repetição infinita.

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
