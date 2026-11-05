# Fase 9A — Autenticação e controle de acesso

Check-in é público. Operação é privada. O inventário de `server.js`, `lib/passRoutes.js` e `lib/operatorControl.js` identificou acessos operacionais por HTML, APIs, aliases de arquivos estáticos e Socket.IO. Todos passam agora por sessão de administrador; não há exceção para localhost, TV, `?demo=1`, `?lpcTest=true` ou debug.

A Fase 9B reutiliza estas proteções na [central de operação](admin-operations.md): `/api/admin/operations`, busca/detalhes e ações de participantes, HOME e Socket.IO no modo `admin`. Esse modo recebe apenas avisos incrementais autenticados e não é contado como TV. As novas rotas não têm exceções de CSRF ou de sessão.

## Começar localmente

1. Instale as dependências: `npm install`.
2. Configure `SESSION_SECRET` no `.env`, com pelo menos 32 bytes aleatórios. Para gerar: `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Preserve o valor entre reinicializações e não o publique.
3. Execute `npm run admin:create` na pasta do projeto. O terminal solicita usuário, senha e confirmação; as senhas não aparecem e não são aceitas em argumentos. O script usa o mesmo `DATA_DIR` do servidor.
4. Execute `npm start`, abra `/login` e entre. `/world` é um alias novo da tela existente `/tela`. `/admin` gerencia as contas. Visitantes usam `/checkin` ou `/check-in` sem conta.

Na implementação local foi acrescentado um `SESSION_SECRET` aleatório ao `.env` somente porque estava ausente. As credenciais existentes foram preservadas; nenhum administrador real foi criado automaticamente. Escolha a primeira conta pelo CLI. Não existe senha padrão ou endpoint público de criação administrativa.

## Inventário e classificação das rotas

As ações de participante abaixo continuam exigindo o **Bearer de cadastro individual já existente**, independente da sessão administrativa. Ser público neste inventário significa não exigir conta de administrador, e não liberar ações sobre qualquer UUID.

| Método | Rota | Acesso e finalidade |
| --- | --- | --- |
| GET/HEAD | `/checkin`, `/check-in`, `/check-in.html` | Público: formulário/câmera/selfie. |
| POST | `/api/check-in` | Público: cadastro, ciência obrigatória da selfie e início dos dois pipelines. |
| GET/HEAD | `/api/config` | Público: somente tamanho máximo da imagem, versão do aviso e link opcional da política. |
| GET/HEAD | `/pass/:uuid` | Público por UUID aleatório: credencial usada pelo visitante. |
| GET/HEAD | `/api/pass/:uuid` | Público: apenas dados destinados ao passe, sem e-mail, reviewToken, caminhos privados ou segredos. |
| GET/HEAD | `/generated/participants/:uuid/portrait.png` | Público: portrait gerado quando READY. |
| GET/HEAD | `/generated/participants/:uuid/story.png` | Público: Story READY somente depois da entrada aprovada; download preservado. |
| GET/HEAD | `/avatars/:filename` | Público: somente sprites PNG com nomes UUID/versão validados. |
| GET | `/api/participants/:uuid/avatar-status` | Público com Bearer do próprio cadastro: recuperar processamento e passe. |
| POST | `/api/participants/:uuid/prepare-pass` | Público com Bearer do próprio cadastro: preparação inicial idempotente, sem reabrir retries. |
| POST | `/api/participants/:uuid/approve-avatar` | Público com Bearer do próprio cadastro: botão normal de entrada inicial; não é entrada forçada administrativa. |
| GET/HEAD | `/login`, `/login.html` | Público: login; usuário já autenticado retorna ao destino operacional permitido. |
| POST | `/login` | Público com sessão anônima/CSRF, Origin válido e rate limit. |
| GET/HEAD | `/api/auth/session` | Público: estado da própria sessão, projeção mínima do usuário e token CSRF. Não informa usuários cadastrados. |
| GET/HEAD | `/health` | Público: somente `{ "ok": true }`, como liveness do processo. |
| GET/HEAD | `/favicon.ico` | Público: resposta vazia. |
| GET/HEAD | `/css/check-in.css`, `/css/pass.css`, `/css/auth.css` | Estilos públicos necessários às páginas públicas. |
| GET/HEAD | `/js/check-in.js`, `/js/selfieCamera.js`, `/js/pass.js`, `/js/auth.js` | Scripts públicos sem segredos. |
| GET/HEAD | `/assets/avatars/lpc/*` | Assets e créditos públicos LPC. Caminhos com traversal/backslash são rejeitados antes do prefixo público. |
| GET | `/socket.io/socket.io.js` | Biblioteca cliente, sem dados do mundo. Não autoriza uma conexão operacional. |
| GET/HEAD | `/` | Protegido: redireciona à tela existente. |
| GET/HEAD | `/world`, `/tela`, `/tela.html` | Protegido: mapa/TV e seus modos de preview/debug. |
| GET/HEAD | `/operator`, `/operator.html` | Protegido: busca, tracking e câmera. |
| GET/HEAD | `/admin`, `/admin.html` | Protegido: gerenciamento de administradores. |
| POST | `/logout` | Protegido por sessão e CSRF: destrói a sessão e desconecta seus sockets. GET não faz logout. |
| GET | `/api/world` | Protegido: snapshot, câmera e debug permitido apenas em desenvolvimento. |
| GET | `/api/participants` | Protegido: listagem operacional. |
| GET | `/api/participants/search` | Protegido: busca operacional limitada. |
| GET | `/api/participants/:uuid` | Protegido: localização/estado no mundo. |
| GET | `/api/participants/:id/status` | Protegido: informação de exibição/entrada na TV. |
| GET | `/api/operator/session`, `/api/operator/camera` | Protegido: sessão operacional atual e estado de câmera. |
| GET | `/api/operation/config` | Protegido: provider, modo provisório, ciclo e disponibilidade da limpeza. |
| GET | `/api/health` | Protegido: estado do banco e contagem de participantes. |
| DELETE | `/api/participants` | Protegido: sessão, CSRF e confirmação administrativa existente. Agora utilizável por administrador também em produção. |
| POST | `/api/participants/:uuid/regenerate-avatar` | Protegido e ainda exige Bearer do cadastro: variação LPC local existente. |
| POST | `/api/participants/:uuid/retry-portrait` | Protegido por administrador, CSRF e Bearer do cadastro: política de retry/privacy preservada. O visitante sem login não vê esse botão. |
| PUT | `/api/participants/:uuid/pass-profile` | Protegido, CSRF e Bearer do cadastro: alterações da credencial. |
| GET | `/api/admin/users` | Administrador: lista projeção sem hashes. |
| POST | `/api/admin/users` | Administrador + CSRF: cria outro administrador. |
| POST | `/api/admin/users/:id/disable` | Administrador + CSRF: desativa e revoga sessões. Último ativo protegido em transação. |
| POST | `/api/admin/users/:id/password` | Administrador + CSRF: redefine senha de outra conta ativa e revoga sessões. |
| POST | `/api/admin/password` | Administrador + CSRF: senha atual, nova senha e confirmação; encerra todas as sessões da própria conta. |
| GET/HEAD | Outros scripts, estilos, referências do mapa e `/vendor/phaser.js` | Protegidos pelo gate padrão antes de `express.static`. |

`POST /api/operator/session` por chave foi retirado. `OPERATOR_KEY`, cookie antigo e permissão por loopback não concedem acesso. Não há rotas de entrada forçada ou novos endpoints de reprocessamento nesta fase. Endpoints operacionais futuros ficam privados por padrão, a menos que sejam incluídos explicitamente na allowlist pública.

## Sessão, cookies e persistência

`lib/auth.js` configura `express-session`. O cookie contém somente o identificador assinado da sessão. Os dados ficam no SQLite privado `DATA_DIR/auth.sqlite`, separado do banco de participantes:

- `admin_users`: `id`, `username`, `password_hash`, `role`, `active`, timestamps e `auth_version` para revogação.
- `admin_sessions`: identificador, JSON da sessão, expiração e usuário. Não usa MemoryStore em produção nem em desenvolvimento.

`session.user` contém exclusivamente `id`, `username`, `role`. CSRF, versão de autenticação e prazo absoluto ficam fora desse objeto. Nenhuma senha ou hash é guardado na sessão ou enviado ao navegador.

O ID é regenerado no login para evitar fixação. A validade padrão é **12 horas**, com prazo absoluto também conferido no servidor e sockets. A sessão sobrevive ao restart mantendo banco e `SESSION_SECRET`. Alterar o secret invalida os cookies existentes. O banco remove sessões expiradas periodicamente.

Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`; `Secure` obrigatório em produção. Em produção o nome é `__Host-world_session`; localmente é `world_session`. Senhas e sessão administrativa não usam localStorage/sessionStorage. O armazenamento de cadastro do visitante permanece independente.

`requireAuth` valida a sessão, expiração e conta ativa/versão atual a cada acesso operacional. `requireAdmin` verifica o papel atual. HTML sem login redireciona a `/login?next=…`; APIs devolvem 401 JSON e permissão/origem/CSRF inválidos devolvem 403. O retorno aceita somente destinos internos operacionais, bloqueando redirects externos.

## Senhas e administradores

Argon2id: **64 MiB**, **3 passagens**, paralelismo **1**, salt gerado pela biblioteca. São aceitas passphrases com **12 a 256 caracteres**. Usuário: 3–64 caracteres ASCII alfanuméricos, ponto, hífen e sublinhado; comparação sem distinção de caixa. O banco contém apenas `password_hash`.

O login responde sempre “Usuário ou senha inválidos.” para conta inexistente, desativada ou senha incorreta. Uma verificação Argon2 fictícia cobre contas inexistentes. Há limite padrão de **10 tentativas por IP em 15 minutos**, sem bloqueio permanente, além de no máximo quatro verificações simultâneas para limitar memória. A contagem é local ao processo.

Após o primeiro cadastro pelo CLI, `/admin` permite listar, criar, desativar e redefinir senha de outras contas. O próprio administrador troca sua senha informando a atual. Alteração de senha ou desativação incrementa `auth_version`, elimina sessões persistidas e desconecta imediatamente os sockets daquele usuário. O último administrador ativo não pode ser desativado; a verificação é transacional. Não existe exclusão de usuários nem reativação pelo painel nesta fase.

Logs de segurança incluem evento, timestamp, usuário/id quando disponível e IP pertinente. O CLI registra criação com origem `cli`. Nenhum log contém senha, hash, cookie, secret ou token CSRF.

## CSRF, CORS, headers e Socket.IO

Ações operacionais mutáveis e login exigem token CSRF aleatório associado à sessão no header `X-CSRF-Token`, além de validar Origin quando presente e rejeitar contexto cross-site. SameSite complementa a proteção. Os fluxos públicos de cadastro/entrada mantêm seu contrato; ações individuais exigem o Bearer próprio, que não é credencial administrativa. Não há `Access-Control-Allow-Origin: *` ou CORS liberado para operação autenticada.

Helmet adiciona headers de segurança. CSP permite scripts locais, imagens locais/data/blob, estilos locais/inline necessários ao passe e conexões ao próprio domínio. Sem scripts inline ou eval liberados. CSP/Phaser, Socket.IO, captura de câmera e exportação foram verificados no Chrome local. HSTS e upgrade de recursos são habilitados em produção.

Socket.IO compartilha o middleware de sessão HTTP. O handshake do namespace exige sessão válida e Origin coerente tanto em `live` quanto em `operator`. Não há stream público dos participantes. Antes de cada evento recebido, a sessão é recarregada e a conta revalidada. Sockets pertencem a rooms privadas por usuário e sessão para revogação; um timer encerra a conexão no prazo absoluto. Logout, desativação e redefinição de senha desconectam as conexões correspondentes. O cliente volta ao login quando a sessão termina. Sockets `live` continuam sem handlers de comando de câmera; apenas `operator` autenticado controla o foco.

Na TV: abra `/world`, faça login e mantenha o navegador aberto. Os participantes não criam contas. A sessão da TV não é eterna: depois do prazo, é necessário entrar novamente. Logout de um navegador encerra somente sua sessão; desativação ou alteração de senha encerra todas as sessões daquele usuário. Nenhuma interação muda automaticamente o foco para outro participante.

## Variáveis e publicação

| Variável | Uso |
| --- | --- |
| `SESSION_SECRET` | Obrigatória em todos os ambientes; mínimo 32 bytes aleatórios; backend apenas. |
| `SESSION_MAX_AGE_HOURS` | Padrão 12; maior que zero e até 168. |
| `APP_ORIGIN` | Obrigatória em produção: origem HTTPS exata, sem barra final, por exemplo `https://mundo.example`. |
| `TRUST_PROXY` | Opcional: proxy/CIDR ou quantidade de hops confiáveis, conforme a instalação. Padrão sem confiança em headers encaminhados. |
| `NODE_ENV=production` | Exige origem HTTPS e cookie Secure, desliga debug e ativa HSTS. |
| `DATA_DIR` | Diretório privado e persistente, já existente na arquitetura. Inclui participantes, auth e assets gerados. |

Produção precisa de HTTPS no reverse proxy/plataforma. Se o proxy estiver no mesmo servidor, `TRUST_PROXY=loopback` é uma opção; se estiver em outra rede, configure os endereços/hops exatos. O backend deve receber `X-Forwarded-Proto: https` somente do proxy confiável, e a porta direta do Node deve ficar isolada. Não foi criado certificado manual no Node. Segredos e arquivos SQLite não devem ficar no diretório público.

O comando `npm start` preserva `--use-system-ca`, adotado anteriormente para certificados da rede. O navegador permanece no mesmo domínio da aplicação; CORS entre sites não é necessário.

Na demonstração `npm run demo:world -- 100`, o banco continua isolado e também exige login. Use o `DATA_DIR` informado pelo script para criar a conta desse ambiente em outro terminal. Nenhum admin padrão foi adicionado. O CLI de carga usa conta aleatória apenas no seu banco sintético e exercita o login HTTP normal, sem API externa.

## Arquivos e escopo

Criados: `lib/auth.js`, `lib/authStore.js`, `scripts/create-admin.js`, `public/login.html`, `public/admin.html`, `public/css/auth.css`, `public/css/account.css`, `public/js/auth.js`, `public/js/admin.js`, `public/js/account.js`, `tests/auth.test.js`, `tests/browser/auth.spec.js` e helpers de fixtures autenticadas.

Integração: `server.js`, `lib/operatorControl.js`, `lib/passRoutes.js`, clientes operacionais/participantes/passe, HTML de TV/operador, `package.json`/lockfile, `.env.example`, novo secret no `.env`, CLI de demonstração/carga e documentação. Testes existentes passaram a efetuar login real por fixtures explícitas; nenhum parâmetro de produção desliga autenticação.

Não foram alterados análise OpenRouter, Cloudflare, catálogo/compositor/assets LPC, movimento, POIs, câmera, tracking ou schema do banco de participantes. A UI anterior foi preservada, com apenas os acessos à conta acrescentados. Express/Multer e dependências transitivas receberam atualizações compatíveis para as correções de segurança reportadas na instalação.

## Limitações

- Projeto preparado para um processo Node com SQLite persistente. Vários workers/réplicas exigirão coordenação do rate limit e revogação Socket.IO compartilhada; não foi introduzido Redis.
- Rate limit em memória reinicia com o processo. A sessão persiste em SQLite.
- Não há OAuth, MFA, recuperação por e-mail ou cadastro administrativo público. Recuperação operacional pode ser feita pelo CLI com acesso autorizado ao servidor.
- A segurança e a expiração foram testadas localmente, incluindo simulação dos headers de um proxy HTTPS confiável. O domínio, proxy e certificado reais ainda precisam ser validados na publicação.
- O passe é compartilhável por UUID aleatório. Quem recebe esse link pode ver os dados destinados à credencial; somente o token individual permite a entrada inicial do cadastro. E-mail do check-in não é uma conta de autenticação administrativa nem comprovação de identidade.
- Reprocessamento mantém as restrições anteriores: Bearer de cadastro adicional e necessidade de nova selfie quando a original já foi removida. Esta fase não cria um painel completo de manutenção de participantes.

## Resultados da validação

- `npm test`: **165 testes aprovados**, sem falhas. Oito cenários dedicados de autenticação cobrem rotas/aliases privadas, check-in/passe/entrada pública, traversal de assets, Argon2id, mensagens genéricas, rotação de sessão, restart, logout, CSRF/Origin, redirects, gestão de contas, último admin ativo, revogação, rate limit, expiração e configuração de produção.
- Socket.IO real, com cliente de teste: `live` e `operator` anônimos recusados; Origin incompatível recusado mesmo com cookie válido; socket `live` não executa câmera; logout, senha e desativação encerram conexões; prazo absoluto desconecta a TV e cookie expirado não reconecta.
- Chrome: **33 cenários anteriores aprovados**, preservando check-in, câmera, tracking, SQLite, LPC, portrait/passe/Story, privacidade e comportamentos com até 100 avatares. O cenário novo da administração foi ajustado para aguardar o carregamento do Phaser e validar a UI sem dependência de foco entre abas; revogação multicliente é coberta pelo teste Socket.IO. **Duas execuções independentes do cenário administrativo passaram**, incluindo login inválido/válido, criação, redefinição, desativação, troca própria de senha, mapa autenticado e logout com socket conectado. A validação final dos **dois novos cenários** também passou: o segundo confirma que o passe público oculta reprocessamento, que o proprietário autenticado envia CSRF e que o erro de selfie já removida continua sendo 409, sem reabrir processamento. Total: 35 cenários distintos verificados no Chrome.
- `node scripts/load-test.js 3`: três check-ins sintéticos, login operacional real, entradas ACTIVE e health detalhado autenticado, sem chamadas externas.
- `npm audit`: **zero vulnerabilidades reportadas** após atualizar as dependências compatíveis.
- Capturas `test-results/auth-login-mobile.png` e `auth-admin-mobile.png` conferidas visualmente: identidade mantida, formulário legível, sem overflow horizontal.
- CLI executado em terminal interativo com banco sintético isolado: usuário criado, senha e confirmação sem eco no terminal, somente hash no SQLite e evento de auditoria sem senha. Nenhuma conta do banco principal foi criada pelo agente.
- Nenhuma chamada real ao OpenRouter/Cloudflare foi necessária nesta fase. Os testes usam providers injetados e imagens sintéticas.

Referências: [express-session](https://expressjs.com/en/resources/middleware/session.html), [Socket.IO e sessões Express](https://socket.io/how-to/use-with-express-session), [Argon2 para Node](https://github.com/ranisalt/node-argon2), [express-rate-limit](https://express-rate-limit.mintlify.app/overview), [Helmet](https://helmetjs.github.io/).
