# Fase 7 — Controle do operador e rastreamento da câmera

## Operação

Abra `/tela` e utilize a barra compacta sobre o mundo para pesquisar participantes e retornar à Sala de Acesso. `/operator` permanece disponível como alternativa para controlar a TV por notebook, tablet ou celular. Digite pelo menos dois caracteres do nome e clique em **ENCONTRAR** no resultado correto. A busca não muda a câmera sozinha; somente a seleção executa o foco.

**Recolher controles** oculta a busca e as informações de operação, mantendo **IR PARA SALA DE ACESSO** visível. Recolher, expandir, fechar os resultados com Escape ou clicar fora da barra não envia comandos de câmera e não interrompe o acompanhamento. A escolha de recolher fica em `sessionStorage`, apenas como preferência da aba, e sobrevive ao F5. Ao selecionar uma pessoa, a lista de resultados fecha para liberar a visualização; focar novamente o campo reabre os resultados existentes. A lista tem rolagem própria, sem acionar o zoom do Phaser.

A barra reutiliza `public/js/operator.js`, as mesmas rotas de busca e autorização e os mesmos eventos Socket.IO da página dedicada. A conexão de movimento da TV continua `live`, somente leitura para comandos; os controles utilizam uma conexão `operator` autorizada separada. Não foi criado outro controlador de câmera, outra Scene ou outro fluxo de busca. O botão de limpeza local de desenvolvimento foi acomodado dentro dos controles expandidos. A barra não aparece nos modos fictícios `?demo=1` e `?lpcTest=true`.

As duas interfaces mostram nome completo, bloco, área e status. Nomes iguais continuam em linhas separadas, com um sufixo do UUID para desambiguação. Pessoas ainda preparando a credencial ou aguardando entrada aparecem com **Ainda não entrou no Mundo // Digital** e botão desabilitado. `ENTERING` e `ACTIVE` podem ser encontrados. Na página dedicada `/operator`, o celular/tablet mantém o status da câmera e HOME fixos na parte inferior; no desktop ficam ao lado da busca. Em `/tela`, ficam na barra sobre o mundo, com HOME também disponível quando recolhida.

O botão HOME afeta somente a apresentação da TV. Não move participantes, não reinicia Phaser, não altera circulação e não apaga dados. Uma nova busca pode trocar diretamente de pessoa, sem visitar HOME no meio.

Atualização de 24/10/2026: a integração em `/tela` foi validada em nove cenários distintos de Chrome, reunindo os dois novos casos da barra e regressões de câmera/zoom, LPC, check-in, limpeza local e os três casos anteriores do operador. Foram verificados nomes duplicados por UUID, autorização por chave, recolhimento sem cancelar foco, preferência após F5, sincronia com `/operator`, HOME acessível no celular e rolagem dos resultados sem zoom no mundo. Na página remota móvel, a lista agora tem espaço de rolagem separado do painel inferior, evitando que HOME cubra botões dos resultados. Nenhum fluxo de IA, avatar, banco ou movimento foi alterado nesta integração.

## Acesso do operador

A Fase 9A substituiu a chave compartilhada e a liberação por localhost por login de administrador, sessão SQLite e CSRF. TV e operador exigem autenticação tanto no HTTP quanto no Socket.IO. Sockets `live` continuam sem comandos de câmera. Consulte o [inventário e as regras atuais de autenticação](authentication.md). O foco não muda por expiração da sessão; a tela deixa de operar até novo login.

## Busca e privacidade

`GET /api/participants/search?q=luc` é protegido pelo acesso do operador e retorna:

```json
{
  "participants": [
    {
      "uuid": "uuid-do-participante",
      "name": "Lucas Garofolo",
      "status": "ACTIVE",
      "currentBlock": "blockC_lower",
      "currentArea": "area_cnc",
      "available": true
    }
  ]
}
```

Não retorna e-mail, selfie, portrait, tokens, appearance, posição x/y, caminhos de arquivos ou registro completo. Os nomes dos blocos e áreas são resolvidos no painel a partir da configuração já existente do mundo. O operador não envia coordenadas.

A consulta é parametrizada, faz correspondência parcial literal com `instr`, ignora maiúsculas e acentos por normalização Unicode NFD e retorna no máximo **20** resultados. `Joao` encontra `João`. Termos menores que 2 ou maiores que 80 caracteres retornam uma lista vazia. O navegador aguarda **300 ms** após digitação e cancela requisições anteriores para evitar resultados fora de ordem.

`lib/store.js` acrescenta consultas de projeção mínima e a função SQLite `senai_fold`; não adiciona tabelas, colunas ou migração. A localização retornada usa o walker atual, evitando depender do último checkpoint do banco. A implementação faz uma varredura dos nomes normalizados, adequada a algumas centenas de pessoas; não pretende ser um índice de busca para milhões de registros.

## Estado operacional e UUID

`lib/operatorControl.js` mantém em memória uma câmera global para a instalação:

```js
{
  cameraMode: 'HOME', // ou 'FOCUS_PARTICIPANT'
  focusedParticipantUuid: null, // ou o UUID selecionado
  participant: null, // projeção mínima da pessoa selecionada
  available: false,
  revision: 0,
  commandId: 0,
  instanceId: 'identificador operacional desta execução do servidor'
}
```

O UUID é a identidade final em todas as operações. Nomes servem apenas para encontrar candidatos. O estado nunca guarda um nome como chave de seleção.

Eventos Socket.IO:

- Operador → servidor: `camera:focusParticipant`, payload `{ participantUuid }`.
- Operador → servidor: `camera:goHome`, payload `{}`.
- Servidor → TVs e operadores: `camera:state`, com o estado operacional e confirmação de comando por acknowledgement.

O servidor resolve o participante no banco e no mapa de walkers, rejeita pessoas indisponíveis e distribui o estado. Metadata do alvo é verificada a cada **500 ms**, com emissão somente quando muda. O operador não recebe o fluxo de posições do mundo; a TV continua usando o Socket.IO de movimento já existente. `revision` evita aplicar snapshots HTTP antigos sobre comandos novos; `commandId` distingue uma nova ordem de uma simples atualização de área. `instanceId` permite reconhecer um restart, em vez de ignorar uma revisão que voltou a zero.

`GET /api/operator/camera` fornece o mesmo estado para uma sessão autorizada. `/api/world` inclui o estado operacional necessário para recuperar a TV, sem credenciais do operador.

## HOME centralizada

`public/js/cameraConfig.js` define a única configuração HOME:

```js
HOME_CAMERA = {
  blockId: 'blockB_upper',
  areaId: 'area_access',
  bounds: WORLD.bounds,
  center: { x: -20, y: 147.5 },
  zoom: 1
}
```

Os valores de centro são calculados dos limites originais da Sala 5, não repetidos literalmente em outros arquivos. Isso restaura o enquadramento anterior à expansão macro, incluindo a porta e a entrada. O bloco permanece o Bloco B Superior completo; só a câmera enquadra a Sala de Acesso.

`/tela` normal abre nesse HOME e apresenta a barra recolhível de busca/retorno. O seletor de blocos da Fase 6 continua disponível em previews explícitos (`?block=...`, `?demo=1`, `?lpcTest=true` ou `?debugWorld=true`). Esses previews podem manter o enquadramento integral do bloco até o primeiro comando do operador. Durante o foco, o seletor fica desabilitado e uma chamada manual de troca de bloco é ignorada. O botão local de limpeza de participantes, anterior a esta fase e restrito ao desenvolvimento, foi preservado dentro dos controles.

## Um único CameraController

`public/js/cameraController.js` foi expandido; não existe controlador concorrente. Suas operações incluem:

- `applyState(state)`: aceita o estado mais recente e distingue comando novo de metadata.
- `focusOnParticipant(uuid)` / `followParticipant(uuid)`: seleciona o alvo, restaura o zoom de foco e inicia acompanhamento.
- `transitionToBlock(blockId)`: reaproveita a troca de bloco da Scene, preserva a continuidade visual da câmera e aplica fade curto.
- `stopFollowing()`: congela o último foco válido e remove o marcador, sem enviar HOME e sem apagar o UUID operacional.
- `goHome()`: encerra o acompanhamento, limpa o UUID, exibe o Bloco B Superior e faz a transição ao HOME.

Os métodos locais consomem o estado recebido; os comandos globais partem do painel e são resolvidos pelo servidor. `setZoom`, `zoomIn`, `zoomOut`, `resetView` e `focusOn` anteriores continuam disponíveis. Durante o acompanhamento, um `focusOn` genérico é ignorado para evitar pan concorrente.

## Animação, zoom e destaque

A configuração `FOCUS_CAMERA` usa zoom relativo **1,5**, transição de **1.200 ms**, fade entre blocos de **180 ms**, suavização de acompanhamento de **240 ms** e compensação vertical de **38 unidades projetadas**, centralizando o corpo acima dos pés. Limites do zoom manual continuam **0,65–1,8**. O zoom é relativo ao enquadramento responsivo do bloco, e o tamanho aparente varia com a tela.

A transição inicial usa interpolação cúbica; depois a câmera segue a posição visual interpolada do sprite com suavização independente do FPS. Não fica rigidamente presa ao pixel central. Resize mantém o alvo e o zoom relativo. Roda e `+`/`-` ajustam o zoom sem cancelar o rastreamento. Durante o foco, `0` restaura apenas o zoom de foco **1,5** e continua seguindo o mesmo UUID; não é um atalho para HOME.

Um anel discreto pulsa sob o avatar existente e um label mostra o nome completo. O nome curto original é ocultado somente enquanto o destaque daquele sprite está ativo, sendo restaurado ao encerrar o foco. São objetos de apresentação da câmera, separados da sprite sheet. Uma legenda fixa discreta na TV informa nome, bloco e área. HUD e legenda não recebem o zoom do mundo.

Não há `setTimeout` para retorno, expiração do alvo, retorno por entrada, por área ou por portal. O prazo de confirmação de um comando no painel é somente tratamento de rede; não redefine a câmera. O destaque usa o update do Phaser, sem timer de retorno.

## Movimento, áreas e blocos

Dentro do bloco, a câmera acompanha o sprite identificado pelo UUID. Mudanças em `currentArea` atualizam o painel sem nova busca e sem reiniciar a transição ou o zoom manual.

Quando o alvo usa um portal, a TV detecta `currentBlock` no dado autoritativo, troca o cenário pela mesma `WorldScene`, recria somente os sprites visíveis e continua com o mesmo UUID. O cache de textura/versão LPC é reutilizado. A troca preserva a aproximação solicitada e tem fade curto; não cria outro participante nem outra Scene.

`CharacterManager` agora respeita imediatamente a posição exata do snapshot autoritativo, mesmo sem receber os nós internos da simulação. Isso evita um deslocamento inicial para o POI ao reconstruir um sprite em outro bloco. O simulador, sua escolha de destinos e seus percursos não foram modificados.

Novas entradas continuam com agendamento, porta, animação e estado `ACTIVE` anteriores. O evento de entrada acrescenta dados e, se o bloco estiver visível, o sprite. Não emite comando de câmera e não possui prioridade sobre o alvo selecionado. Em HOME, a entrada aparece normalmente na Sala de Acesso.

## Indisponibilidade e falhas de conexão

Se o alvo for removido ou ficar inativo/sem walker válido, o estado permanece `FOCUS_PARTICIPANT` e mantém o UUID. A câmera para no ponto visual atual, remove o destaque e o operador vê **Participante não está mais disponível no mundo.** Não muda de bloco nem volta à Sala 5. HOME e outra busca continuam disponíveis. Se o registro voltar a ficar disponível, é necessário um novo comando ENCONTRAR para retomar o acompanhamento interrompido.

Enquanto a textura inicial carrega, o controlador pode usar a posição autoritativa como destino e espera o sprite para exibir o anel/nome. Não inventa um avatar. A recuperação de texturas e o fallback LPC já existentes permanecem no cliente de participantes. A disponibilidade operacional representa a existência do participante no servidor; falhas locais de renderização/rede em uma TV continuam usando a recuperação anterior e não geram telemetria individual de cada display.

Numa desconexão, a TV mantém seu estado e último dado conhecido, sem voltar a HOME. Ao reconectar, recebe o estado e recupera o snapshot. Comandos não confirmados mostram erro no painel e podem ser reenviados. A busca e a UI usam `textContent` para nomes, sem inserir HTML recebido.

## Refresh e restart

F5 na TV recupera `cameraMode` e `focusedParticipantUuid` do servidor e volta a acompanhar a pessoa no bloco atual. F5 no operador também recupera o estado operacional. Não grava foco no SQLite nem muda a persistência dos participantes.

Após restart total do servidor, a câmera operacional começa em HOME, como permitido nesta fase. `instanceId` permite que as TVs e operadores já conectados aceitem esse novo estado, mesmo tendo visto revisões maiores na execução anterior. Pessoas continuam nos blocos persistidos; não refazem entrada, avatar ou análise. As sessões por chave também são efêmeras e exigem novo login após restart.

Se o alvo já estiver indisponível no momento do F5, o modo e a mensagem continuam indisponíveis, mas o último ponto visual anterior do navegador não é persistido. Não há posição histórica de câmera no banco.

## Debug

Abra `/tela?debugWorld=true`. Além do grafo anterior, um texto fixo mostra `cameraMode`, UUID, bloco exibido e área atual. Sem esse parâmetro, esses detalhes de debug ficam ocultos.

## Validação

```sh
npm.cmd test
npx.cmd playwright test
```

Os testes novos são `tests/operator.test.js` e `tests/browser/operator.spec.js`:

**Resultado final em 23/10/2026:** `npm.cmd test` aprovou **45/45 testes Node** e a execução completa do Playwright aprovou **21/21 cenários no Chrome**, incluindo os três cenários novos de operador. A demonstração da Sala 5 completou dois minutos sem violações de percurso; os testes de câmera/zoom, LPC, cinco blocos, check-in, selfie, portrait/crachá, reset, persistência, restart e reconexão também passaram. As capturas do painel em celular/desktop e do destaque na TV foram inspecionadas visualmente. Não houve erros de JavaScript ou console nos cenários que os monitoram.

- Busca parcial, acentos, nomes completos repetidos com UUIDs distintos, entradas ainda indisponíveis e limite de 20 resultados.
- Consulta com 284 participantes, normalização e proteção contra consulta SQL como entrada; projeção mínima de campos e acesso por chave/cookie.
- Ausência de timeout, avanço de relógio de uma hora sem expirar o foco e HOME sem modificar walkers.
- Operador real → Socket.IO → Phaser, câmera suave, anel, nome, escala LPC preservada, zoom manual e resize.
- Permanência observada em 10 s, 30 s e 60 s, sem HOME automático.
- Caminhada real pelos waypoints, mudança de área, portal C inferior → C superior, mesmo UUID e textura, sem duplicação.
- Check-in sintético real, aprovação e entrada pela porta enquanto outro participante está focado.
- F5 durante foco, escolha de outra pessoa, remoção/inatividade, congelamento da câmera e HOME explícito.
- Socket da TV sem autoridade para comandar, debounce, limite visual de resultados, painel móvel com HOME visível e debug.
- Restart de servidor com TV e operador já abertos: novo estado HOME, mantendo participante no bloco persistido.

Na primeira medição local, a consulta entre 284 registros levou cerca de 9 ms. Esse valor é uma amostra da máquina de desenvolvimento, não garantia de latência em produção. As simulações usam dados e imagens sintéticas, provedor local e nenhum envio de selfie real a serviços externos.

## Limites de escopo

O controle é global: todas as TVs ao vivo recebem o mesmo foco; se houver dois operadores, prevalece o último comando aceito. Não foi implementada escolha de TV ou arbitragem entre operadores. A busca é limitada e faz normalização em uma varredura SQL, suficiente para o volume inicial; volumes muito maiores podem exigir índice específico. A camada de sessões é uma chave compartilhada simples, não um sistema completo de administração. Não há indicação de confirmação de renderização de cada TV no painel: o acknowledgement confirma aceitação do comando pelo servidor.

**Universal LPC não foi alterado.** Não foram modificados sprites, sprite sheets, composição, escala, catálogo, arquivos de `public/js/avatar` ou pipeline de geração. Check-in, portrait/Cloudflare, crachá, compartilhamento, entrada, circulação, POIs, portais e geometria dos cinco blocos permanecem como estavam. Não foram implementados agentes, missões, gamificação, QR ou busca no crachá.

## Arquivos criados

- `lib/operatorControl.js`
- `public/operator.html`
- `public/css/operator.css`
- `public/css/worldControls.css` (integração da barra na tela principal)
- `public/js/operator.js`
- `public/js/cameraConfig.js`
- `tests/operator.test.js`
- `tests/browser/operator.spec.js`
- `docs/operator-tracking.md`

## Arquivos modificados

- `server.js`
- `lib/store.js`
- `public/js/cameraController.js`
- `public/js/game.js`
- `public/js/participantsClient.js`
- `public/js/characters.js`
- `public/tela.html`
- `public/css/style.css`
- `.env.example`
- `package.json`
- `README.md`
- `tests/persistence.test.js` (limite de desvio calculado pela idade real do checkpoint e velocidade, substituindo uma distância fixa inadequada ao intervalo de cinco segundos)
