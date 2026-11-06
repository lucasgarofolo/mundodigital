# Preparação final A — publicação do Mundo // Digital

O projeto inicia com `npm start`, equivalente a `node --use-system-ca server.js`. A porta é `PORT` do host ou 3000; o servidor escuta em `0.0.0.0`. A versão utilizada e fixada em `.node-version` é **Node 24.13.0**; `package.json` já exige Node 24 ou superior. Se a hospedagem não reconhecer `.node-version`, selecione explicitamente Node 24.13.0/24 na configuração do serviço. O frontend é servido diretamente; não existe build de frontend.

Esta etapa prepara o código e verifica a operação local em configuração de produção. Não cria repositório, commit, remote, push, serviço, domínio ou deploy. O teste online depende da próxima etapa.

## Resultado da auditoria e correções necessárias

| Risco de publicação | Situação / tratamento |
| --- | --- |
| Perder SQLite, sessões e imagens no redeploy | Todos já usam DATA_DIR. Produção agora recusa inicialização sem DATA_DIR explícito. O diretório deve ser um volume real da hospedagem; o código não consegue provar durabilidade do disco. |
| Expor SQLite/sessões/selfies por uma configuração errada | Startup recusa DATA_DIR dentro de `public`, inclusive via symlink, antes de abrir os bancos. Static permanece limitado à pasta pública; as rotas de assets gerados continuam específicas. |
| Story falhar em Linux por ausência do Chrome local | O renderer existente já aceita `STORY_BROWSER_CHANNEL=chromium`. Documentada instalação do Chromium e bibliotecas no build, com o mesmo cache acessível no runtime. Nenhuma alteração no renderer ou na arte. |
| Segundo sinal encerrar o Node durante o fechamento | Encerramento por SIGTERM/SIGINT agora tem trava única e saída controlada em falha. Mantém fechamento das filas, checkpoint, Socket.IO e dois bancos. Health passa a 503/{ok:false} durante encerramento. |
| Criar primeiro administrador no banco errado | CLI em production também exige DATA_DIR explícito. Usar o mesmo volume e ambiente do serviço. |
| Enviar dados locais ao primeiro Git | `.gitignore` ampliado para logs, SQLite/WAL/SHM, uploads, temporários e chaves de certificado. `.env.example` permanece incluído. Nenhum segredo real encontrado nos candidatos examinados. |
| Cookie Secure não funcionar ou confiar em headers falsos | Proteção da Fase 9A já existe. APP_ORIGIN HTTPS é obrigatório; TRUST_PROXY deve refletir apenas o proxy real, com acesso direto ao Node isolado. Não foi relaxada a segurança. |
| Mais de uma réplica usando simulações/filas locais | Publicar **uma instância e um processo Node**, sem cluster/autoscaling nesta entrega. SQLite, simulação e filas atuais foram preservados. |

Porta, bind cloud, migrations, WAL, session store persistente, health mínimo, CSRF, login rate limit, Helmet, limites de upload, autorização HTTP/Socket.IO e debug desativado em produção já estavam implementados e foram preservados.

## Serviço Node e navegador para Story

No ambiente de build **e** de execução do host, configure `PLAYWRIGHT_BROWSERS_PATH=0` e `STORY_BROWSER_CHANNEL=chromium`. O primeiro guarda o navegador junto à instalação do Playwright em `node_modules/playwright-core/.local-browsers`; esse diretório faz parte do artefato de runtime, não do Git nem do volume de participantes.

Comandos de instalação em um host Linux compatível:

```sh
npm ci --omit=dev
npx playwright install --with-deps chromium
```

O segundo comando instala binário e bibliotecas do sistema; pode precisar de privilégios no ambiente de build. O serviço escolhido precisa suportar Chromium headless e essas bibliotecas. Se elas já vierem na imagem do host e não houver permissão para instalar pacotes de SO, instalar apenas o navegador com `npx playwright install chromium` é suficiente **somente depois de verificar as bibliotecas**. Não executar a instalação a cada requisição ou download de Story. Reinstalar após cada `npm ci`/novo artefato de build.

O suporte a `channel: 'chromium'`, instalação das bibliotecas e localização dos binários constam na [documentação oficial do Playwright](https://playwright.dev/docs/browsers). Não foi criado Dockerfile. Localmente pode continuar usando `STORY_BROWSER_CHANNEL=chrome` com o Chrome já instalado.

No Railway com Railpack, a integração oficial pode ser habilitada com `RAILPACK_NODE_PLAYWRIGHT_INSTALL=1`, instalando navegadores e pacotes de runtime. Usar o canal `chromium` e cache coerente no build/runtime; sem override, o código agora escolhe `chromium` por padrão em production e `chrome` localmente. Não presumir que o pacote npm sozinho instala o navegador. Falhas de exportação agora têm [códigos seguros e diagnóstico por etapa](portrait-pass.md#diagnóstico-local-de-download-óculos-e-demora). [Referência do Railpack](https://railpack.com/languages/node/#playwright).

Comando de execução:

```sh
npm start
```

Executar como serviço contínuo. Não usar hospedagem somente estática ou função efêmera para este processo. Definir healthcheck HTTP `/health`. Não usar `/world` como healthcheck, pois exige login.

## Variáveis necessárias

Configuração principal da publicação, sem credenciais reais:

```dotenv
NODE_ENV=production
DATA_DIR=/data
APP_ORIGIN=https://seu-dominio.example
# Exemplo SOMENTE para exatamente um proxy confiável, com porta direta isolada:
TRUST_PROXY=1
SESSION_SECRET=
SESSION_MAX_AGE_HOURS=12
AVATAR_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_AVATAR_MODEL=qwen/qwen3-vl-30b-a3b-instruct
OPENROUTER_AVATAR_TIMEOUT_MS=30000
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_PORTRAIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b
CLOUDFLARE_PORTRAIT_TIMEOUT_MS=120000
PORTRAIT_PROVIDER=cloudflare
PORTRAIT_FALLBACK_ENABLED=false
PORTRAIT_FALLBACK_PROVIDER=openrouter
OPENROUTER_PORTRAIT_MODEL=black-forest-labs/flux-3-image-klein
OPENROUTER_PORTRAIT_TIMEOUT_MS=120000
STORY_BROWSER_CHANNEL=chromium
PLAYWRIGHT_BROWSERS_PATH=0
```

Preencher SESSION_SECRET e credenciais no gerenciador de variáveis/segredos do host. Não colocar `.env` no Git. Para gerar um secret, execute em terminal privado `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` e salve o resultado no host. Não trocar entre restarts/redeploys; isso invalidaria os cookies existentes. Sem chaves de IA válidas, os fallbacks existentes continuam possíveis, mas a personalização completa depende das duas credenciais e respectivas permissões/créditos.

`PORT` é fornecida pela hospedagem; se necessário definir manualmente, usar a porta exigida por ela. O padrão local é 3000. Não fixar outra porta no código.

Inventário completo, também documentado em `.env.example`:

| Variável | Uso / padrão |
| --- | --- |
| NODE_ENV | `production` no host; `development` no exemplo local. |
| PORT | Porta do host; padrão 3000. |
| DATA_DIR | Obrigatória e explícita em production; volume privado. Local padrão `data`. |
| APP_ORIGIN | Obrigatória em production: origem HTTPS exata, sem barra final nem subcaminho. |
| TRUST_PROXY | Proxy/CIDRs ou hops confiáveis reais; sem confiança por padrão. |
| SESSION_SECRET | Obrigatória, aleatória, mínimo 32 bytes, estável. |
| SESSION_MAX_AGE_HOURS | 12; maior que zero e até 168. |
| AVATAR_PROVIDER | `local`, `ollama`, `gemini` ou `openrouter`; utilizar `openrouter` para o fluxo atual. |
| OPENROUTER_API_KEY | Backend, obrigatória para análise OpenRouter. |
| OPENROUTER_AVATAR_MODEL | `qwen/qwen3-vl-30b-a3b-instruct`. |
| OPENROUTER_AVATAR_TIMEOUT_MS | 30000; orçamento global existente, não um timeout novo por tentativa. |
| CLOUDFLARE_ACCOUNT_ID | Identificador da conta autorizado para Workers AI. |
| CLOUDFLARE_API_TOKEN | Token de backend com permissões existentes para o portrait. |
| CLOUDFLARE_PORTRAIT_MODEL | Default `@cf/black-forest-labs/flux-2-klein-4b`; também aceita `@cf/black-forest-labs/flux-2-klein-9b`. |
| PORTRAIT_PROVIDER | `cloudflare` (default) ou `openrouter`, exclusivamente para portraits. |
| PORTRAIT_FALLBACK_ENABLED | `false` (default) ou `true`. |
| PORTRAIT_FALLBACK_PROVIDER | `openrouter` (default) ou `cloudflare`; deve diferir do principal quando habilitado, ignorado quando desabilitado. |
| OPENROUTER_PORTRAIT_API_KEY | Chave separada para portraits. Ausente: usa OPENROUTER_API_KEY por compatibilidade. Definida vazia: bloqueia geração até preencher. |
| OPENROUTER_PORTRAIT_MODEL | `black-forest-labs/flux-3-image-klein`. |
| OPENROUTER_PORTRAIT_TIMEOUT_MS | 120000 ms; inteiro entre 1 e 600000. |
| CLOUDFLARE_PORTRAIT_TIMEOUT_MS | 120000. |
| STORY_BROWSER_CHANNEL | `chromium` no host com binário instalado; `chrome` local. |
| PLAYWRIGHT_BROWSERS_PATH | `0` no build e runtime para manter binário no mesmo artefato; variável do Playwright. |
| WORLD_ENTRY_DELAY_MS | 8000. |
| WORLD_ENTRY_SPACING_MS | 1000. |
| AVATAR_MAX_ATTEMPTS | 2 versões locais do avatar na revisão. Não aumenta o orçamento persistido de análise IA. |
| PASS_PORTRAIT_WAIT_MS | 15000; espera de apresentação da credencial. |
| EVENT_EDITION | 2026. |
| EVENT_INSTAGRAM_HANDLE | Opcional; vazio não exibe perfil. |
| EVENT_HASHTAG | Opcional; exemplo `#MundoDigital`, com aspas em `.env`. |
| PASS_DEFAULT_ROLE | Texto opcional, vazio por padrão. |
| PASS_DEFAULT_ORGANIZATION | Texto opcional, vazio por padrão. |
| SELFIE_PRIVACY_POLICY_URL | Link opcional HTTPS ou caminho local da política. |
| GEMINI_API_KEY | Somente se escolher provider gemini. |
| GEMINI_MODEL | `gemini-3.5-flash-lite`, provider alternativo. |
| GEMINI_TIMEOUT_MS | Padrão 180000; `0` desativa prazo conforme contrato existente. |
| GEMINI_LOG_RESPONSE | Exemplo `false`; desabilitado por padrão em production. |
| OLLAMA_BASE_URL | Somente provider ollama; `http://127.0.0.1:11434`. |
| OLLAMA_MODEL | `gemma4:12b`, provider alternativo. |
| OLLAMA_TIMEOUT_MS | Padrão 0; contrato existente. |
| OLLAMA_LOG_RESPONSE | Exemplo `false`; desabilitado por padrão em production. |
| NODE_EXTRA_CA_CERTS | Opcional, somente caminho de uma CA corporativa verificada se a rede realmente exigir. Lido pelo Node no lançamento. |

Não há variável de senha padrão administrativa. Criar o primeiro administrador no terminal interativo do serviço, com o mesmo DATA_DIR montado:

```sh
npm run admin:create
```

O CLI solicita usuário/senha/confirmar sem eco da senha; guarda somente Argon2id em `/data/auth.sqlite`. Não passar senha por argumento nem incluí-la em um script versionado. As outras contas continuam sendo criadas em `/admin`.

## Volume e mapa exato dos arquivos

Escolha operacional para produção: **DATA_DIR=/data**, se esse for o mount real do host. Caso a plataforma forneça outro mount, usar o caminho dela. Montar e dar acesso de escrita ao usuário do processo **antes** de criar o administrador ou iniciar a aplicação. Declarar a variável não cria um volume persistente.

| Caminho com DATA_DIR=/data | Conteúdo / retenção |
| --- | --- |
| `/data/participants.sqlite` | Participantes, estado, appearance, dados do passe e metadados. Migrations existentes, schema versão 8. |
| `/data/auth.sqlite` | Administradores, hashes e sessões persistentes. |
| `/data/*-wal`, `/data/*-shm` | Arquivos auxiliares SQLite/WAL enquanto os bancos estão abertos; pertencem ao mesmo volume. |
| `/data/avatars/<uuid>.png` e `<uuid>-<versão>.png` | Sprites LPC gerados. |
| `/data/generated/participants/<uuid>/portrait.png` | Portrait gerado. |
| `/data/generated/participants/<uuid>/story.png` | Story gerado, 1080×1920. |
| `/data/photos/<uuid>.png` | Selfie normalizada privada e **temporária**, somente enquanto consumidores/retries precisam dela. |

Diretórios de dados, avatars e photos são criados automaticamente; diretórios por participante são criados quando usados. Não é necessário criá-los manualmente. Não mover assets para `public`. Arquivos `.tmp` de geração permanecem nos diretórios já usados pelos serviços existentes.

Selfie continua com ciência obrigatória no frontend/backend, leases, retry, estados terminais dos dois consumidores e exclusão automática. Referência é limpa e exclusão registrada; DELETE_FAILED e recuperação após restart continuam ativos. LPC/portrait/Story não são apagados junto com a selfie. Não configurar backup/snapshot que retenha cópias de `photos/` contrariando essa política. As políticas dos provedores externos permanecem próprias.

Os assets oficiais LPC, CSS, Phaser e mapa pertencem ao código/repositório. `node_modules` e Chromium são reinstaláveis e não substituem o volume de participantes. Não executar `demo:world` ou testes com DATA_DIR de produção.

## HTTPS, proxy, sessão e Socket.IO

HTTPS termina no proxy/plataforma; Node permanece HTTP privado. O proxy deve encaminhar Host, informação de protocolo HTTPS e conexão WebSocket/upgrade para o mesmo serviço. Manter polling e `/socket.io/` no mesmo domínio. Permitir body de pelo menos 6 MiB para uma selfie de até 5 MiB mais o envelope multipart; o backend mantém seu próprio limite de arquivo. A câmera do celular também depende do contexto HTTPS seguro.

TRUST_PROXY deve refletir a topologia verdadeira: `loopback` para proxy local; IP/CIDRs ou quantidade de hops exata quando o proxy estiver em outra rede. `1` só se realmente houver um hop confiável e nenhuma rota direta pública mais curta até o Node. O proxy deve sobrescrever headers encaminhados pelo visitante. Referência: [Express e proxies](https://expressjs.com/en/guide/behind-proxies/).

O cookie existente em production é `__Host-world_session`, HttpOnly, Secure, SameSite=Lax, path `/`, sem Domain e expiração de 12 horas por padrão. O session store é SQLite em DATA_DIR, não MemoryStore. Logout/revogação/expiração continuam sendo validados no servidor; manter o secret e o volume preserva sessões entre restarts.

Socket.IO autentica handshake e eventos operacionais com a mesma sessão; somente modo operator/admin autorizado executa ações correspondentes. Cliente live continua sem comandos de câmera. O proxy precisa tolerar os heartbeats; o timeout deve superar pingInterval + pingTimeout (45 s por padrão; 60 s de idle é um ponto inicial compatível). Não há CORS `*` com credenciais. Referência: [Socket.IO atrás de proxy](https://socket.io/docs/v4/reverse-proxy/).

## Acesso e health

Públicos: `/checkin`, `/check-in`, aliases necessários, `/api/check-in`, `/api/config`, `/login`, `/api/auth/session`, `/health`, `/pass/:uuid`, `/api/pass/:uuid`, assets públicos LPC/portrait/Story e arquivos de UI públicos necessários. As rotas individuais de status, preparação do passe e aprovação da entrada continuam exigindo o Bearer do próprio cadastro. UUIDs são aleatórios, não sequenciais; o passe expõe apenas os dados destinados à credencial, sem e-mail/selfie/segredos/caminhos privados.

Protegidos: `/world`, `/tela`, `/operator`, `/admin`, aliases HTML, tracking/câmera, debug, `/api/world`, `/api/participants` operacionais, `/api/operator/*`, `/api/admin/*`, `/api/operation/config`, `/api/health` e todas as mutações administrativas. APIs negam com 401/403; páginas retornam ao login. O [inventário detalhado da Fase 9A](authentication.md) e as [APIs da Fase 9B](admin-operations.md) permanecem válidos.

Em production o debug do mundo fica desativado, mesmo com query string e sessão válida. O handler de erros não envia stack/SQL/paths para o navegador; logs operacionais continuam no backend. Limites preservados: selfie até 5 MiB, um arquivo, poucos campos; imagem até 20 megapixels normalizada em 1024×1024; bodies JSON administrativos 2–4 KiB. Não foi adicionada CSP agressiva nova.

Verificar online na próxima etapa:

```sh
curl -i https://seu-dominio.example/health
```

Resposta operacional: HTTP 200 e `{"ok":true}`. Durante encerramento: 503 e `{"ok":false}`. Não consulta IA nem expõe banco, fila, TV ou participantes. `/api/health` e `/api/admin/operations` são detalhados e exigem login.

## Git, antes do primeiro push

Não havia `.git` nesta pasta durante a auditoria, logo não havia arquivos tracked/staged ou histórico local a examinar. Foram examinados candidatos do projeto, procurando credenciais reais do `.env` e padrões de chave privada/token sem imprimir os valores. Um repositório de auditoria isolado em `.test-data` foi usado somente para conferir os padrões reais de ignore e listar candidatos; não há repositório criado na raiz, commit ou staging do projeto. Pastas privadas de dados/teste, dependências e `.env` não são candidatas ao commit. Os dados e o `.env` reais foram preservados.

Comandos para o operador executar quando decidir registrar a entrega:

```sh
git init -b main
git status --short --untracked-files=all
git check-ignore .env .env.local .env.production data/participants.sqlite .test-data/ node_modules/
git add .
git diff --cached --stat
git diff --cached --name-only
git ls-files --cached -- .env .env.local .env.production data .test-data node_modules
```

A última consulta deve ficar vazia. `.env.example` deve aparecer no conjunto de arquivos preparados. Se aparecer credencial real, selfie ou banco privado entre os arquivos preparados, interromper o commit e corrigir antes de publicar. Confirmada a lista:

```sh
git commit -m "Prepare Mundo Digital for production"
```

Configuração posterior, substituindo usuário e repositório reais, sem token na URL:

```sh
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git remote -v
git push -u origin main
```

Nenhum desses comandos foi executado contra o projeto nesta etapa. Não houve push ou deploy automático.

## Validação e bloqueadores externos

O smoke test novo usa NODE_ENV=production real, diretório limpo isolado, credenciais administrativas sintéticas, proxy HTTPS simulado por headers confiáveis e mocks das duas IAs. Gera LPC real e Story real, valida sessão Secure, check-in/passe públicos, APIs privadas, entrada, Socket.IO, tracking, persistência dos assets por hash, exclusão da selfie e continuidade da sessão. Reinicia pelo entrypoint real com PORT do ambiente. Exercita SIGTERM/SIGINT e saída graciosa sem gerar chamada paga. Não cria dados ou conta no volume real.

O teste usa um preload de IPC somente dentro de `.test-data`: no Windows, kill(SIGTERM) terminaria o processo forçadamente, portanto o fixture emite os mesmos eventos Node para validar o handler real. O comportamento de sinais/proxy/certificado da hospedagem Linux ainda precisa de smoke test online após o deploy.

Resultados em 04/11/2026:

| Verificação | Resultado |
| --- | --- |
| Instalação limpa `npm ci --omit=dev` em pasta isolada | 164 pacotes instalados. Cache npm de teste dentro do workspace após a primeira tentativa não ter permissão para escrever no cache global. Nenhuma dependência alterada. |
| Runtime com somente essa instalação limpa | Servidor/health/bancos/Argon2 e Chromium iniciaram; `@playwright/test` ausente no runtime, como esperado. |
| `npm test` final | **179/179 aprovados**, sem falhas, aproximadamente 75 segundos. |
| Smoke de produção após revisão final do shutdown | **2/2 aprovados**: proteção do storage e fluxo completo/restart/sessão/assets/Story real/sinais. |
| Chrome: admin, autenticação, avatar-experience e selfie-camera | **10/10 aprovados**, aproximadamente 1,1 minuto, incluindo check-in/passe/entrada/TV/tracking/remoção/câmera da selfie. |
| `npm audit --omit=dev` | **Zero vulnerabilidades** reportadas. |
| Git/segredos | 188 arquivos candidatos; `.env.example` incluído; dez casos de ignore confirmados com Git; nenhum dado privado ou segredo real nos candidatos. Sem `.git` na raiz. |
| Variáveis | 34 variáveis de runtime encontradas no código, todas presentes no exemplo e neste inventário. |
| Integridade | SHA-256 preservado de auth, serviço portrait/Story, cleanup, catálogo/builder, providers, movimento/navegação, câmera e comportamentos visual/social. |

A primeira regressão expôs uma falha de fixture: o mock HTTP da Cloudflare reutilizou uma porta cujo arquivo de login sintético existia de uma execução anterior. Foi corrigido apenas o teste para usar fetch nativo nesse transporte; o teste isolado e a regressão final passaram. O código Cloudflare permaneceu idêntico. Não foram feitas chamadas reais/pagas nem utilizadas fotos de visitantes. O cenário usa imagens sintéticas.

Evidências locais, ignoradas pelo Git: `.test-data/final-a-regression-final.log`, `final-a-production-smoke-final.log`, `final-a-browser-smoke.log`, `final-a-clean-install-retry.log`, `final-a-npm-audit.json` e `final-a-final-audit.json`.

Antes de publicar restam decisões/configurações externas: serviço Node com volume durável gravável e Chromium/bibliotecas, domínio HTTPS, topologia de TRUST_PROXY, variáveis/credenciais válidas e primeira conta no volume montado. Uma instalação Linux e o domínio real não podem ser certificados por um teste local Windows. O código não cria esses recursos e esta etapa não avança para deploy.

Arquivos alterados nesta preparação: `server.js`, `scripts/create-admin.js`, `.gitignore`, `.env.example`, `package.json` (inclui smoke test na suíte), `README.md`, `tests/portrait-pass.test.js` (mock HTTP usa fetch nativo, sem a autenticação automática das fixtures e sem alterar Cloudflare). Criados: `.node-version`, `tests/production-readiness.test.js`, `docs/production.md`. Não houve alteração de dependências/lockfile, schema/migrations, autenticação, admin, renderer, providers, Universal LPC, Phaser, câmera, tracking, POIs ou comportamentos.
