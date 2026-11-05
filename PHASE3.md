# Fase 3 — Persistência, identidade e estado

> Atualiza??o de privacidade: a selfie privada agora ? tempor?ria e ? apagada ap?s ambos os consumidores encerrarem. Consulte a [pol?tica atual](docs/selfie-privacy.md). Assets gerados e metadados permanecem; descri??es de reten??o permanente abaixo s?o hist?ricas.

Esta fase complementa a Fase 2 existente. Não adiciona IA, escola, busca ou saída automática. Mapa, entrada pela porta, placeholder, navegação e câmera foram preservados.

## Executar e inspecionar

Requer Node.js 24 ou superior. No PowerShell:

```powershell
npm.cmd install
npm.cmd start
npm.cmd run inspect:participants
```

- Telão: http://localhost:3000/tela
- Formulário: http://localhost:3000/check-in
- Demo: http://localhost:3000/tela?demo=1
- Saúde: http://localhost:3000/health
- Mundo ativo: http://localhost:3000/api/world
- Lista ativa compatível com a Fase 2: http://localhost:3000/api/participants
- Detalhes: `/api/participants/<uuid>`
- Confirmação no telão: `/api/participants/<uuid>/status`

Configuração opcional em `.env`, a partir de `.env.example`: `PORT=3000`, `AVATAR_PROVIDER=local`, `DATA_DIR=data`. Nenhuma chave ou chamada externa é utilizada.

`inspect:participants` abre o SQLite em modo somente leitura e lista inclusive inativos, sem divulgar e-mail/foto. Aceita outra pasta: `npm.cmd run inspect:participants -- .test-data/load-EXEMPLO`. Também é possível abrir o arquivo em um visualizador SQLite. A API de detalhe e o índice de nome preparam a busca futura; não há busca textual nem interface nesta fase.

## Banco e migração

SQLite: `data/participants.sqlite`, ou no `DATA_DIR`. Continua usando `node:sqlite`, sem ORM ou dependência nova. A inicialização cria pastas, tabelas e índices automaticamente. A migração é aditiva, transacional e idempotente (`PRAGMA user_version=3`).

| Coluna | Uso |
| --- | --- |
| `id`, `uuid` | Mesmo UUID da Fase 2; `id` continua chave primária por compatibilidade, `uuid` tem índice único |
| `name`, `email` | Nome e e-mail normalizado, único sem distinguir maiúsculas |
| `photo_path` | Caminho relativo privado; nulo para registros antigos sem foto |
| `avatar`, `avatar_kind` | URL persistida e tipo do avatar; `avatar` equivale ao campo desejado `avatar_path` |
| `status` | `CHECKED_IN` ou `INACTIVE`, com constraint |
| `created_at`, `checkin_at`, `updated_at` | Criação, conclusão do check-in e último checkpoint |
| `current_floor`, `current_room` | Textos livres, sem enum restritivo de salas/pavimentos |
| `position_x`, `position_y` | Coordenadas lógicas, independentes da tela |
| `cycle_id` | Referência à tabela `cycles` (ID, início, fim dos ciclos globais de 15 minutos) |
| `simulation` | JSON de estado, rota, velocidade, destino e pausas para retomar a navegação |

Cadastros existentes recebem `uuid=id`, status ativo e datas a partir de `created_at`; as posições vêm do JSON anterior. Identidade, avatar e ciclo não são recriados. Antes da migração do banco principal nesta sessão, o servidor anterior foi encerrado normalmente e foi salva uma cópia em `data/backups/participants-before-phase3-*.sqlite`.

Nome não é chave nem critério de deduplicação. Nomes iguais com e-mails diferentes são permitidos. E-mail ativo já cadastrado recupera o participante, sem substituir foto/avatar. E-mail inativo retorna 409, sem reativação implícita. O e-mail só recebe validação de formato, sem comprovação de titularidade. Não há administração de status; inativos persistidos são excluídos da restauração na inicialização.

## Fotos e avatares

Novas fotos: `data/photos/<uuid>.png`. Avatares: `data/avatars/<uuid>.png`. A foto mantém as regras anteriores: JPEG/PNG/WebP, até 5 MB e 20 megapixels, mínimo 32×32, sem múltiplos frames. É orientada, normalizada para até 512×512 e salva sem metadados. Nomes originais de arquivos nunca compõem caminhos finais.

**Mudança solicitada nesta fase:** a foto normalizada passa a ser persistida privadamente. O aviso do formulário foi atualizado. Original e buffers da solicitação são descartados/zerados; a cópia normalizada permanece no disco. As fotos antigas foram descartadas pela Fase 2 e não podem ser recuperadas: nesses registros, `photo_path` fica nulo. Duplicatas não sobrescrevem fotos. Em falha de arquivo/banco, os arquivos que aquela solicitação criou são removidos.

Somente avatares são servidos por `/avatars/<uuid>.png`. Fotos ficam acessíveis ao operador pelo caminho registrado no banco, inclusive depois do restart, sem rota pública nem envio ao Phaser. Isso preserva a privacidade do telão numa aplicação sem autenticação. Banco, fotos e cópias não estão em `public/`. A API pública exclui e-mail, foto, caminhos privados e detalhes internos da simulação.

## API, restauração e Socket.IO

1. O servidor inicia e reconstrói walkers ativos a partir do SQLite.
2. O Phaser desenha a sala e consulta `GET /api/world` ao carregar `/tela`.
3. A API consulta o conjunto ativo no banco e usa coordenadas/estado da simulação atual do servidor quando disponíveis, evitando devolver posições atrasadas dos checkpoints.
4. O cliente carrega texturas e cria personagens por UUID, sem repetir a entrada de quem já está dentro.
5. Eventos durante a consulta são guardados e aplicados após a resposta. A coleção `CharacterManager.participantsById` evita duplicação.

A restauração HTTP funciona mesmo sem transporte Socket ou sem seu script. Nesse caso, a TV representa o estado recuperado e indica reconexão; atualizações ao vivo dependem do Socket. Uma falha de API provoca nova tentativa. Reconectar faz nova sincronização HTTP idempotente e realinha posições. Não se transmite snapshot completo por Socket.

Eventos incrementais:

- `participant:joined`: novo cadastro, depois de persistir os arquivos e o registro.
- `participants:moved`: somente posições/estados que mudaram, em lotes a cada 100 ms; não repete fotos, nomes, e-mails ou texturas.
- `participant:displayed`: confirmação do cliente após carregar o avatar, preservando a confirmação do formulário.

Adicionar novamente um UUID devolve o personagem existente. A sincronização remove representações ausentes do conjunto ativo; isso não ativa saída automática dos ciclos.

## Posição e recuperação

A simulação lógica permanece no servidor para preservar a coerência dos dois telões. O Phaser interpola, projeta e anima visualmente. O modo demo continua local.

Checkpoint SQLite em lote a cada **5 segundos**, mais um no encerramento normal. Não há gravação por frame ou por evento Socket. O cadastro inicial é salvo antes do evento de entrada. Queda abrupta pode retornar ao último checkpoint, aproximadamente cinco segundos; encerramento normal salva posição, rota e pausas. O tempo offline não é simulado.

Spawn, offsets e entrada continuam em `world-config.js`, usado pelo módulo compartilhado de movimento. Não copiamos coordenadas de tela para o backend. Nenhum valor do mapa/câmera foi alterado.

## Logs e segurança básica

Logs: início do servidor, banco conectado, quantidade restaurada, UUID criado, conexão/desconexão Socket, erros de upload e banco. Sem logs por movimento, e-mail ou selfie. Falhas de checkpoint são tratadas e registradas com limitação de frequência. `/health` consulta o banco e retorna 503 em indisponibilidade.

Queries de dados usam parâmetros. Status tem constraint; UUID/e-mail têm unicidade; nome aceita homônimos. A migração usa nomes de colunas constantes. Limites de upload e processamento simultâneo foram preservados. Não há autenticação nem auditoria completa.

## Estrutura final

```text
server.js
lib/
  store.js
  avatarGenerator.js
public/
  tela.html
  check-in.html
  css/                           estilos preservados
  js/
    game.js
    world.js / world-config.js    mapa e entrada preservados
    movement.js                  navegação preservada
    cameraController.js          preservado
    characters.js
    participantsClient.js
    check-in.js                   fluxo preservado
scripts/
  load-test.js
  inspect-participants.js
tests/
  world.test.js / checkin.test.js
  persistence.test.js
  fixtures/server-process.cjs
  browser/
    world.spec.js / camera.spec.js / checkin.spec.js
    persistence.spec.js
data/                            privado, ignorado pelo Git
  participants.sqlite
  photos/<uuid>.png
  avatars/<uuid>.png
  backups/
.test-data/                       dados isolados de testes
PHASE3.md
```

Criados: `scripts/load-test.js`, `scripts/inspect-participants.js`, `tests/persistence.test.js`, `tests/fixtures/server-process.cjs`, `tests/browser/persistence.spec.js`, `PHASE3.md`.

Modificados: `server.js`, `lib/store.js`, `public/js/participantsClient.js`, `public/js/characters.js`, `public/check-in.html`, `package.json`, `README.md`, `PHASE2.md` (aviso histórico). Dependências e lockfile não mudaram.

## Testes e limitações

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:load -- 10
npm.cmd run test:load -- 50
```

O script de carga inicia seu próprio servidor local e SQLite isolado em `.test-data`, sempre com placeholder local e fotos sintéticas. Não há endpoint de criação massiva nem inserção nos dados do evento. Encerra ao terminar.

Os testes de navegador usam processos Node separados para validar encerramento/reinício com o mesmo banco, F5, reconexão, restauração sem script Socket.IO, dois telões e 10/50 avatares. Resultados finais abaixo.

No Windows, o encerramento automático do webServer do Playwright apresentou espera na fase anterior. Nesta sessão foi iniciado explicitamente um servidor de testes na porta 3010 e reaproveitado pelo executor. Se necessário, use `PORT=3010`, `AVATAR_PROVIDER=local` e `DATA_DIR=.test-data/manual` em sessão separada antes do comando de navegador.

Limitações: sem autenticação, comprovação de titularidade de e-mail, exclusão automática de fotos ou interface de inativação. Muitos avatares podem se sobrepor; carga não é benchmark de capacidade máxima ou medição de FPS na TV do evento. Não há geração por IA, expansão da escola, tour, rastreador ou saída automática.

## Resultados em 10/10/2026

- **11 testes Node passaram**, cobrindo upload, falha/retry, privacidade, deduplicação, ciclo, posição, migração repetida da Fase 2, schema, fotos no restart, inativos, UUID único e carga de 50.
- **Os quatro cenários de navegador passaram**: câmera/zoom/HUD/resize; check-in em dois telões; persistência; circulação demo por dois minutos (109 visitas).
- Na primeira suíte, os três cenários existentes passaram e o novo teste revelou que bloquear também o script Socket.IO impedia a chamada inicial à API. Foi corrigida a inicialização para permitir restauração sem o script; o cenário de persistência foi repetido e passou em 15,3 segundos, incluindo dois processos Node sucessivos, F5, 10/50 sprites, recuperação do cadastro feito durante desconexão e restauração de 51 sprites sem Socket. Não foi necessário repetir o teste de circulação após essa correção restrita à ausência do script.
- `test:load -- 10`: 10 cadastros em 117 ms. `test:load -- 50`: 50 em 500 ms. Valores locais, com placeholder e fotos sintéticas; não incluem IA nem representam performance no hardware do evento.
- `npm start`, `inspect:participants`, `/health` e `/api/world` foram verificados no servidor principal da porta 3000. O participante anterior foi recuperado com o mesmo UUID, nome, avatar e ciclo. Os testes de carga não alteraram esse banco.
- A captura com 51 avatares foi inspecionada visualmente: sala e HUD preservados, com sobreposição esperada de personagens e nomes em áreas próximas.
- Sem erros recorrentes de JavaScript nos cenários normais. Durante restart ou bloqueio deliberado do Socket podem ocorrer erros de transporte esperados. O Node instalado emite `ExperimentalWarning` para SQLite; Playwright avisa sobre `NO_COLOR`/`FORCE_COLOR`. Não são erros da aplicação.
