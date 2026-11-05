# Avatar: prévia, aprovação e entrada — Fase 4.2

O fluxo móvel descrito nesta entrega foi substituído pelo [crachá como credencial](credential-flow.md). A entrada, o agendador, a persistência e o LPC continuam preservados; a aprovação agora acontece no botão do crachá, sem prévia isolada.

O cadastro deixa de publicar um personagem provisório no telão. Primeiro salva a foto privada, gera o sprite e apresenta uma prévia animada no celular. O visitante pode aprovar ou gerar uma segunda versão. Somente a versão aprovada entra pela porta da Sala 5, após o atraso controlado pelo servidor. Mapa, câmera, HUD, compositor LPC e análise Gemini foram preservados.

## Estados e persistência

```text
AVATAR_PROCESSING → AVATAR_REVIEW → AVATAR_APPROVED → ENTERING → ACTIVE
                         ↓
                  AVATAR_PROCESSING (segunda versão)
```

`REGISTERED` também é aceito pelo schema como estado inicial conceitual; o cadastro normal grava diretamente `AVATAR_PROCESSING` ou `AVATAR_REVIEW`, pois registro e definição da próxima etapa são atômicos. `avatarStatus` continua separado: `PENDING`, `READY` ou `FALLBACK`. Um fallback chega à revisão e exige aprovação como qualquer outro avatar.

A migração aditiva do SQLite, versão 5, inclui `experience_status`, `review_token`, `avatar_versions`, `approved_at`, `scheduled_entry_at` e `entered_at`. O antigo `status` (`CHECKED_IN`/`INACTIVE`) permanece para compatibilidade. APIs do mundo usam o estado da experiência: somente `ENTERING` e `ACTIVE` são restaurados no telão. Cadastros antigos já publicados são migrados para `ACTIVE`, preservando identidade, aparência e circulação; registros inativos continuam ocultos.

## Celular e prévia

`public/js/avatar/avatarPreview.js` desenha o spritesheet existente em Canvas, sem iniciar outro Phaser. Usa frames de 64×64, caminhada lateral para a direita a 10 fps, canvas de 128×128 e apresentação de 192×192 com pixels nítidos. O LPC atual tem quatro direções, sem frames diagonais. Com preferência por movimento reduzido, apresenta o frame parado.

O formulário apresenta envio, processamento, revisão com nome e “Está parecido com você?”, e aprovação com “Olhe para a TV 👀”. Não mostra contagem regressiva nem dados técnicos da análise. O botão de aprovação só fica disponível após carregar a prévia. O fluxo existente de câmera e seleção de foto permanece.

UUID e token privado ficam no armazenamento local do navegador. A recuperação consulta o servidor a cada segundo enquanto processa ou aguarda entrada. Refresh recupera processamento, revisão, aprovação ou entrada concluída. Fechar o celular depois da aprovação não cancela a entrada. Se o navegador fechar antes de receber a resposta do cadastro, enviar novamente o mesmo e-mail recupera o registro; sem armazenamento local, essa também é a recuperação disponível no protótipo.

As rotas privadas usam `Authorization: Bearer <reviewToken>`:

| Rota | Operação |
| --- | --- |
| `GET /api/participants/:uuid/avatar-status` | Recupera prévia, versões e estado |
| `POST /api/participants/:uuid/approve-avatar` | Aprova e agenda entrada |
| `POST /api/participants/:uuid/regenerate-avatar` | Gera uma variação antes de aprovar |

O token não é publicado nos eventos ou na listagem do mundo. O protótipo mantém a recuperação por e-mail existente, sem verificar propriedade do endereço; autenticação por e-mail não foi implementada nesta fase.

## Aprovação, agendamento e entrada

`lib/entryScheduler.js` concentra os temporizadores. A aprovação condicional no banco é idempotente: repetir a requisição não altera o horário, não adiciona outro temporizador e não cria outro personagem. O horário é persistido antes do agendamento. Reiniciar Node recria os temporizadores com o tempo restante; entradas vencidas são retomadas com espaçamento.

Configuração no `.env` (reinicie o servidor após editar):

```dotenv
WORLD_ENTRY_DELAY_MS=8000
WORLD_ENTRY_SPACING_MS=1000
AVATAR_MAX_ATTEMPTS=2
```

O atraso aceita 0–60000 ms; o espaçamento, 0–5000 ms; o limite de versões, 1–5. Valores inválidos usam os padrões acima. O espaçamento pode aumentar a espera de aprovações simultâneas: o atraso é mínimo, não uma promessa de entrada simultânea de todos aos oito segundos. Testes sintéticos usam atrasos menores onde a espera real não é o objeto do teste.

No horário agendado, o servidor cria o walker fora da sala, em torno de `(1.9, 9.45)`, e publica `participant:enter`. A rota passa por `(1.9, 9.3)`, pelo limiar da porta `(1.9, 9)` e pelo waypoint interno `(1.9, 8.3)`, com os pequenos deslocamentos de entrada existentes. Esses pontos estão em `public/js/world-config.js`; a geometria do mapa não mudou.

O telão destaca “Nome chegou!” por três segundos. A caminhada continua usando o ciclo existente. Ao terminar a rota, o servidor grava `ACTIVE` e `entered_at` imediatamente, sem depender de confirmação do telão. Posição e simulação seguem os checkpoints existentes; uma interrupção abrupta pode retomar alguns segundos anteriores do percurso, sem duplicar o participante. TV recarregada durante a entrada restaura a posição persistida e prossegue. Não há som, mudança automática de câmera nem busca de participantes.

## Segunda versão e falhas

O limite padrão é **duas versões totais**, incluindo a primeira. A segunda é uma variação local de penteado, preservando as demais características; para cabelo ausente, muda uma tonalidade de roupa. `lib/avatarVariation.js` não faz nova chamada ao Gemini. A fila limita a concorrência, o banco impede ultrapassar o limite e o visitante aprova somente depois da nova prévia. Após aprovação, regeneração é bloqueada.

Tentativas de rede da análise inicial são independentes da contagem de versões. Erros temporários HTTP 500, 502, 503 ou 504 permitem uma repetição após um segundo, até duas chamadas totais por participante, contabilizadas no banco inclusive após restart. `GEMINI_TIMEOUT_MS` configura o prazo total e o timeout do SDK: padrão 180000 ms, ou 0 para aguardar sem timeout local. Erros de chave, cota ou resposta inválida não são repetidos automaticamente. Falha persistente gera fallback para revisão. Não aprovar mantém o cadastro invisível no mundo. A limpeza administrativa cancela tanto a geração quanto entradas agendadas, impedindo que registros apagados reapareçam.

## Arquivos desta fase

Criados:

- `lib/experienceConfig.js`, `lib/entryScheduler.js`, `lib/avatarVariation.js`.
- `public/js/avatar/avatarPreview.js`.
- `tests/avatar-experience.test.js`, `tests/helpers/experience.js`, `tests/browser/avatar-experience.spec.js`.
- `docs/avatar-experience.md`.

Modificados:

- `server.js`, `lib/store.js`, `lib/avatarPipeline.js`.
- `public/check-in.html`, `public/css/check-in.css`, `public/js/check-in.js`.
- `public/js/world-config.js`, `public/js/characters.js`, `public/js/participantsClient.js`.
- `.env.example`, `package.json`, `scripts/load-test.js`, `README.md`, `docs/avatar-pipeline.md`.
- `tests/checkin.test.js`, `tests/persistence.test.js`, `tests/avatar-pipeline.test.js`, `tests/fixtures/server-process.cjs`.
- `tests/browser/checkin.spec.js`, `tests/browser/avatar-pipeline.spec.js`, `tests/browser/participant-reset.spec.js`, `tests/browser/selfie-camera.spec.js`.

## Validação

Validação executada: `npm.cmd test` passou os **25 testes de servidor**; `npx.cmd playwright test` passou os **13 testes no Chrome**. Os testes cobrem invisibilidade antes da aprovação, autorização por token, prévia animada, segunda versão, limite, aprovação repetida, cinco pessoas com mesmo nome, espaçamento, fallback, limpeza e restart real do Node. Um teste de navegador aguarda os oito segundos reais e fecha o celular após aprovar. Também permanecem as verificações de câmera, HUD, sprites LPC, webcam simulada, duas TVs, reload, reconexão, persistência e dois minutos de estabilidade da Sala 5. As telas de revisão, aprovação e entrada pela porta também foram inspecionadas visualmente.

Os testes usam bancos separados e analisadores controlados; não apagam participantes reais nem enviam selfies ao Gemini. Qualidade da semelhança com uma selfie real continua sendo uma validação manual. Captura física em celular exige as permissões e a conexão segura já descritas na documentação da análise.

Após o ajuste para indisponibilidade temporária e prévia lateral, a suíte de servidor passou **26 testes** e os **dois testes de navegador do fluxo de avatar** passaram novamente. A nova cobertura verifica 503 seguido de sucesso, falha persistente, ausência de repetição para chave inválida e cancelamento durante a espera pelo prazo total. O navegador compara os pixels do Canvas com os frames laterais reais do spritesheet. Não foi feita chamada real ao Gemini para provocar ou reproduzir o 503.
