# Fase 8.3 — encontros visuais leves nos POIs

Esta camada representa comportamentos de jogo entre visitantes que compartilham um local. Não infere amizade, interesse, emoção, personalidade ou qualquer relacionamento entre as pessoas. Não usa APIs, IA, diálogos, dados da selfie ou nomes para decidir encontros. Não implementa a Fase 9.

## Escopo e integração

A implementação prioriza **visitantes parados no mesmo POI**. Não interrompe caminhadas nem modifica movement, grafos, destinos, portais, slots, pesos, capacidade, câmera, busca ou rastreador. A formação visual dos grupos já vem dos slots ocupados ao mesmo tempo: dois ou três visitantes em equipamentos técnicos; mais visitantes podem compartilhar a Praça Cívica conforme sua capacidade existente. Não há um identificador de grupo persistente ou seleção de pessoas como destinos.

`public/js/socialBehavior.js` contém configuração, amostragem visual e controller efêmero. Ele é filho do `createVisitController()` existente em `macroNavigation.js`. Recebe uma visão somente de leitura da reserva, slot, permanência e plano visual da Fase 8.2. O servidor executa `visitController.social.update(walkers, delta)` no loop central de 100 ms já existente.

O participante permanece em `VISITING`. Há somente um plano visual temporário, sem nova máquina de estados de navegação. O tempo de permanência continua diminuindo durante a interação. Não há extensão de visita, sincronização das saídas, slot adicional, teleport, pausa na rota ou nova escrita SQLite.

## Elegibilidade e prioridades

Os dois participantes precisam:

- Estar `ACTIVE`/`VISITING`, com reserva válida, no mesmo bloco, área e POI.
- Ter chegado ao slot há pelo menos 1.500 ms, com pelo menos 3.200 ms restantes.
- Estar em observação simples (`observe`) da Fase 8.2. Planos `curious`, `lookAround` e `machineDemo` são preservados integralmente e não disputam espaço com a camada social.
- Estar a até 2,6 tiles de distância, sem lock e fora do cooldown.

Assim, entrada, espera inicial na Sala de Acesso, caminhada, portal e comportamento principal do equipamento têm prioridade. Avatares `ENTERING` não participam. A Sala de Acesso passa a permitir encontros somente depois da entrada, espera inicial, caminhada para um POI e estabilização no slot.

## Configuração central

`SOCIAL_BEHAVIOR` fica no novo módulo, sem variáveis `.env`:

| Parâmetro | Padrão |
| --- | --- |
| enabled | true |
| checkIntervalMs | 1500 |
| interactionChance | 0.08 |
| plazaInteractionChance | 0.16 |
| minCooldownMs / maxCooldownMs | 10000 / 30000 |
| minInteractionMs / maxInteractionMs | 800 / 2600 |
| minEmoteInteractionMs | 2000 |
| minSettleMs | 1500 |
| minAttemptGapMs / maxAttemptGapMs | 5000 / 9000 |
| maxDistance | 2.6 tiles |
| maxGroupSize | 3 |
| maxActiveInteractions | 3 no mundo |
| maxInteractionsPerBlock | 1 |
| minStaggerMs / maxStaggerMs | 300 / 800 |

As probabilidades são **por oferta elegível**, não por frame ou encontro físico. Uma oferta rejeitada pelo sorteio não repete o sorteio internamente. Os dois candidatos recebem um novo intervalo de consideração de 5–9 s, mesmo sem interação. Após terminar ou cancelar, cada participante recebe seu próprio cooldown aleatório de 10–30 s. A Praça Cívica tem chance maior, preservando os mesmos limites de efeitos e locks.

`createVisitController({ socialConfig })` e a opção equivalente de `createApplication` permitem testes determinísticos e medições. Não criam uma configuração de infraestrutura ou alteração de produção automática.

## Detecção limitada, sem O(n²) por frame

Somente a cada 1.500 ms o controller monta buckets por **bloco + área + POI**, incluindo quem efetivamente chegou. Visitantes ainda a caminho não formam grupos.

Cada bucket é embaralhado uma vez e cada participante examina no máximo `maxGroupSize - 1` candidatos (dois por padrão). Após uma oferta probabilística, encerra a procura daquele participante. Há no máximo `2 × N` verificações de distância por rodada, mesmo em um POI sintético com muitos visitantes. A rotina normal é O(N) por rodada; não existe busca global de pares a 60 FPS.

Nos ticks intermediários, o controller apenas avança o relógio e valida até três pares ativos. A apresentação resolve o outro avatar por Map/UUID em O(1). Não há setInterval, TimerEvent ou tween por participante.

`maxGroupSize` limita a janela de candidatos e as pequenas listagens de clusters no debug. Não muda a capacidade dos POIs nem comanda pessoas para formar grupos. Ocupação, geografia e permanências coincidentes continuam criando os grupos visuais.

## Tipos e fallback LPC

| Tipo | Comportamento |
| --- | --- |
| ACKNOWLEDGE | Ambos olham brevemente um para o outro e voltam a observar o POI. |
| LOOK_AT | Variante discreta de orientação, sem emote. |
| WAVE | Fallback para facing e emotes pixelados existentes, sem gesto LPC novo. |
| SHARED_REACTION | Mantém o facing do equipamento e mostra duas pequenas reações com atraso. |

O LPC continua oferecendo caminhada em `up`, `left`, `down`, `right` e os quatro frames idle. Não possui animação de aceno apropriada neste recorte. Nenhum ataque foi reutilizado e nenhum sprite, frame ou compositor foi alterado.

As reações usam `attention` e `sparkle`, desenhados pelo **mesmo renderer de emotes da Fase 8.2**. O segundo emote começa 300–800 ms depois do primeiro; há jitter inicial de 100–250 ms e duração visual de 500–800 ms. Interações com emote têm duração total de 2.000–2.600 ms. Reconhecimento e olhar usam 800–2.600 ms, com pequeno atraso diferente para o segundo facing.

Cada participante pode emitir no máximo um emote social por visita. Depois desse orçamento, apenas os tipos sem emote permanecem possíveis, respeitando cooldown. Como a camada social só usa planos `observe`, não soma emotes aos de uma visita `curious`.

## Locks, alvos e cancelamento

Uma interação aceita adquire os dois locks de maneira síncrona no loop autoritativo. A não pode participar simultaneamente de A↔B e A↔C. O terceiro visitante do equipamento continua observando normalmente.

`socialTargetUuid` e `socialInteraction` são getters não enumeráveis no walker. O alvo usa UUID, nunca nome. Os planos, relógios, cooldowns e orçamento visual ficam em WeakMaps/Maps efêmeros do controller. Nenhuma coluna ou migration foi adicionada. O snapshot público envia explicitamente somente o plano necessário à apresentação.

Terminar ou cancelar remove os dois locks e os dois alvos. Remoção, reset, invalidação da reserva, nova visita, portal, mudança de bloco/área/estado, inatividade ou substituição da instância de um UUID cancelam o par inteiro. O visitante restante continua seu próprio tempo de permanência e retorna ao facing do POI. As reservas continuam sendo liberadas pela Fase 8.1, sem liberar indevidamente o slot do outro visitante.

Perder um sprite em uma TV remove imediatamente o efeito social da contraparte nessa TV. Enquanto o outro sprite estiver ausente ou incompatível, ambos não são apresentados como um encontro unilateral. Isso não muda o estado global do servidor por causa do culling de uma única tela.

Refresh da TV recupera o plano em memória e seu tempo decorrido. Restart do servidor descarta todo o estado social, mantendo apenas a recuperação espacial existente. Não há memória de amizade ou encontros anteriores.

## Câmera, efeitos e depth

O tracking continua no mesmo UUID e não troca para o outro participante. HOME continua na Sala de Acesso. Nenhum arquivo do controlador de câmera ou busca foi modificado nesta fase.

Os emotes sociais reutilizam offsets, acompanhamento da projeção, alpha e profundidade da Fase 8.2. Permanecem fora do nome focado e do marcador, abaixo da camada do nome de tracking; HUD continua fixo. O teto existente de oito emotes por bloco visível vale para efeitos sociais e individuais juntos. Como existe um par social por bloco, há no máximo dois emissores sociais locais.

Em slots próximos, a bolha social também evita os retângulos dos nomes vizinhos e de outras bolhas. O renderer tenta poucas posições laterais/acima, conserva a posição escolhida enquanto ela continuar livre e omite a bolha se não houver espaço seguro, mantendo o facing. Essa checagem visual usa no máximo duas bolhas sociais locais contra os nomes visíveis, somente durante o efeito; não é uma detecção global de pares e não altera a movimentação.

## Debug e teste manual

Em desenvolvimento, abra `/tela?debugWorld=true`. O painel inclui `socialState`, alvo abreviado, cooldown e `nearbyParticipants` (candidatos próximos avaliados na última rodada, limitado pela janela). POIs ocupados em conjunto mostram seus visitantes; o snapshot debug também possui grupos/pequenas listagens de clusters e contadores de scans, comparações e interações.

O debug pode forçar um tipo **sem ignorar cooldown, locks, distância, reservas ou prioridades**. Em uma TV local com debug ativo, use no console, substituindo os UUIDs por visitantes elegíveis do mesmo POI:

```javascript
const {game}=await import('/js/game.js');
const scene=game.scene.getScene('WorldScene');
scene.participantsClient.socket.emit('world:social-force', {
  a:'UUID-DO-PRIMEIRO', b:'UUID-DO-SEGUNDO', type:'ACKNOWLEDGE'
}, console.log);
```

Também são aceitos `LOOK_AT`, `WAVE` e `SHARED_REACTION`. Retornos como `INELIGIBLE`, `LOCKED`, `COOLDOWN`, `DISTANCE`, `LIMIT` e `EMOTE_BUDGET` explicam por que o teste não começou. O comando existe somente em conexão debug, local, da mesma origem e fora de produção. Não existe nova interface de operação ou alteração de foco.

## Validação e limites

```powershell
npm.cmd test
npx.cmd playwright test
```

Os novos testes estão em `tests/social-behavior.test.js` e `tests/browser/social-behavior.spec.js`. Cobrem participação simétrica, tipos, fallback, jitter, cooldown, orçamento de emote, terceiro participante, capacidade, estados críticos, cancelamento, SQLite/restore, probabilidades, complexidade limitada, sprite ausente, tracking, portal, debug e produção.

As simulações com 10, 50 e 100 participantes percorrem cinco minutos simulados de visitas reais no grafo existente. O caso de 10 começa no Bloco A para criar oportunidades de encontro; os outros começam distribuídos entre os cinco blocos. Os testes de navegador fazem amostras curtas com participantes autoritativos reais, carregamento LPC e Socket.IO. A medição de CPU do processo de teste inclui o servidor e a condução do Playwright, não somente a camada social.

Na suíte Node completa de 02/11/2026, os **142 testes passaram**, incluindo os 11 novos testes sociais. Resultado das simulações com os parâmetros de produção e RNG fixo:

| Participantes | Tempo simulado | Rodadas sociais | Comparações de distância | Encontros iniciados/concluídos | Pico de pares ativos | Tempo de execução |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 5 min | 200 | 53 | 1 / 1 | 1 | 290 ms |
| 50 | 5 min | 200 | 713 | 2 / 2 | 1 | 1673 ms |
| 100 | 5 min | 200 | 1704 | 15 / 15 | 2 | 2776 ms |

Todos mantiveram os limites de slots e posições válidas; após cleanup, zero locks e zero alvos sociais. Os tempos incluem movimento, validações e assertions; essa execução ocorreu junto da regressão de navegador. Não medem isoladamente o custo da camada social. Os números de encontros são resultados desse cenário e não uma frequência prometida para o evento.

A suíte completa do Chrome passou com **31 testes**. Após o ajuste final de posicionamento das bolhas para proteger nomes vizinhos, os **cinco testes relacionados** (social e efeitos da Fase 8.2) passaram novamente, incluindo uma verificação dos retângulos dos nomes. Não houve erros de página/console nos cenários sociais. As quatro peças móveis da Fase 8.2 continuam retornando exatamente ao desenho original.

Última amostra Chrome, com 120 frames por tamanho e participantes reais distribuídos pelo mundo:

| Participantes no mundo | Visíveis no bloco observado | FPS | Heap JS do browser | CPU do processo Node de teste | Timers/tweens de efeitos novos |
| --- | --- | --- | --- | --- | --- |
| 10 | 3 | 144 | 16 MB | 2% | 0 / 0 |
| 50 | 11 | 143 | 30 MB | 6% | 0 / 0 |
| 100 | 21 | 142 | 17 MB | 45% | 0 / 0 |

A CPU oscilou bastante nas amostras curtas: na execução completa anterior, o caso de 100 participantes registrou 140 FPS e 11% de CPU; na primeira execução isolada, 142 FPS e 37%. As amostras incluem carregamento/sincronização e o driver de teste. Não permitem atribuir esse percentual à detecção social, que fez somente três comparações em cinco rodadas na última amostra curta. A simulação longa acima verifica sua carga com mais oportunidades de encontro. Não foi feito um benchmark A/B isolado nem um ensaio prolongado na TV do evento.

As capturas ficam em `test-results/social-83-wave-tracking.png`, `social-83-shared-reaction.png` e `social-83-100-live.png`. Um conjunto de 58 arquivos protegidos foi comparado por SHA-256 antes/depois, sem mudanças, incluindo LPC/assets, mapa/configuração de blocos, movement, câmera, operadores, APIs, Cloudflare, store e `.env`.

Não foram adicionados encontros durante caminhada, avoidance dinâmico ou novo pathfinding. Offsets de circulação e visitorSlots existentes continuam sendo a proteção disponível contra sobreposição. Avatares caminhando ainda podem se cruzar ou ocluir parcialmente outros. Em um mundo pouco ocupado e distribuído entre muitos POIs, encontros sociais podem ser raros; não há sincronização ou agrupamento artificial para garantir um acontecimento a cada poucos segundos.

Universal LPC, APIs de análise, OpenRouter, Cloudflare, check-in, crachá, banco, capacidades e sistema de câmera foram preservados. Nenhuma IA nova foi adicionada.
