# Fase 8.2 — comportamentos visuais de visita

Esta fase responde ao que o visitante faz no POI. As reservas, slots, grafo, tempos de permanência, memória de destinos e portais da Fase 8.1 continuam sendo os mesmos. Não há novas chamadas de IA, animações LPC, spritesheets, variáveis de ambiente ou migrations.

## Inventário LPC verificado antes da implementação

Fontes: `public/js/avatar/avatarLpc.js`, `lpcConfig.js`, `lib/lpcCompositor.js` e os PNGs locais. A composição oficial tem 576 × 256 pixels, com 36 células de 64 × 64. Phaser também conta o frame interno `__BASE`, portanto informa `frameTotal = 37`.

| Chave real (prefixo = textura do participante) | Direção | Frames | Uso |
| --- | --- | --- | --- |
| `${texture}-walk-up` | cima / north | 1–8 | Caminhada, 10 fps, repetição |
| `${texture}-walk-left` | esquerda / west | 10–17 | Caminhada, 10 fps, repetição |
| `${texture}-walk-down` | baixo / south | 19–26 | Caminhada, 10 fps, repetição |
| `${texture}-walk-right` | direita / east | 28–35 | Caminhada, 10 fps, repetição |
| Idle, sem animationKey | up / left / down / right | 0 / 9 / 18 / 27 | Frame parado da respectiva direção |

`sit`, `hurt`, `slash`, `thrust`, `shoot`, `spellcast` e gestos de inspeção não estão carregados no recorte usado pelo projeto. Nenhum ataque foi reaproveitado. A visita reutiliza somente os quatro idles; a caminhada existente permanece intacta. `inspect` degrada para `observe`.

## Configuração e execução

`public/js/visitVisualBehavior.js` centraliza perfis, sorteio e amostragem temporal. `macroWorldConfig.js` aplica os perfis por tema aos POIs existentes. Um POI sem declaração usa `observe`.

| Perfil | observe | lookAround | curious | machineDemo |
| --- | --- | --- | --- | --- |
| Sala de Acesso | 85% | 15% | — | — |
| Praça Cívica | 65% | 25% | 10% | — |
| Robô / Impressora 3D | 60% | — | 25% | 15% |
| CNC / Ponte Rolante | 70% | — | 20% | 10% |
| Torno / Fresadora / Injetora / Ajustagem e manutenção | 80% + fallback de inspect (20%) | — | — | — |
| Outros sem perfil | 100% | — | — | — |

Laser compartilha o perfil de inovação, mas ainda não possui demo: os 15% de `machineDemo` degradam para `observe`, resultando em 75% observe / 25% curious. Pesos podem ser ajustados em `behaviorWeights` de um POI, sem lógica condicional no loop.

O controller da Fase 8.1 cria um plano efêmero **depois da chegada exata ao slot**. O plano é filho da visita e não constitui uma segunda navegação ou uma nova máquina de estados do participante. Permanecem `ENTERING`, `IDLE`, `WALKING` e `VISITING`. A apresentação usa fases internas `WAITING → PLAYING → DONE`; observe usa `IDLE`.

- `observe`: idle orientado para o equipamento; sempre disponível.
- `lookAround`: após uma pausa, vira para uma direção cardinal adjacente e retorna à principal aos 70% da janela. Não muda posição nem toca o caminho.
- `curious`: um único emote curto, depois idle.
- `inspect`: fallback para observe, por ausência de gesto LPC apropriado.
- `machineDemo`: somente nos equipamentos configurados e suportados; o visitante observa parado.

O início varia entre 20% e 45% da permanência. A janela dura 1.400–2.400 ms, limitada a 40% da permanência, preservando idle antes/depois. A permanência total da Fase 8.1 não é ampliada. Direção lateral, símbolo, momento e duração são sorteados uma vez; o resultado e sua evolução são locais e determinísticos a partir desse plano.

`visualVisit` é um getter não enumerável do walker. O plano fica no WeakMap do controller, aparece explicitamente nos snapshots/eventos públicos necessários à apresentação e **não** no JSON de simulação salvo pelo SQLite. Os eventos existentes também notificam mudança de fase ou facing, mesmo sem deslocamento. A TV avança o relógio no update central; nenhum setInterval, TimerEvent ou tween novo é criado por avatar.

## Emotes, máquinas e profundidade

`public/js/visitVisualEffects.js` desenha quatro símbolos locais com retângulos de pixels: attention (`!`), curious (`?`), thinking (`...`) e sparkle (cruz/estrela). São comportamentos do jogo, sem inferência sobre a pessoa. Não há emoji nativo, fonte nova, download ou persistência de emoção.

O emote fica 38 pixels à direita e 70 pixels acima dos pés e acompanha a projeção do avatar a cada frame. Sua profundidade usa o maior valor entre 1600 e avatar + 0,5, acima dos equipamentos atuais. O nome de tracking fica acima dele, em pelo menos 1602. O deslocamento deixa livre o nome normal em y − 82, o nome de tracking em y − 104 e o marcador nos pés. A única alteração em `cameraController.js` é a profundidade desse texto: modos, foco, zoom, movimento e seleção permanecem iguais. HUD HTML continua fixo e fora da câmera do mundo.

As máquinas reutilizam os traços e cores existentes, separando apenas a peça móvel do desenho estático:

- Braço Robótico: movimento pequeno dos segmentos e juntas.
- Impressora 3D: deslocamento curto do cabeçote sobre o trilho.
- CNC: alternância da luz de status.
- Ponte Rolante: deslocamento curto do carro/gancho.

Cada peça mantém a profundidade isométrica do equipamento. Fora da demo, seu desenho volta exatamente aos comandos gráficos originais. Não há movimento automático contínuo, partículas ou alteração dos obstáculos. Corte a Laser, costura e painel elétrico ficam para uma possível fase posterior.

Limites da apresentação: **oito emotes e duas demos simultâneas por bloco visível**. Efeitos excedentes são omitidos, sem fila e sem alongar a visita. Para o mesmo equipamento, o renderer apresenta um único visitante como origem da demo; outros slots continuam disponíveis. Não existe lock de navegação nem lock persistente. Televisões podem omitir efeitos diferentes devido à ordem de carregamento e aos limites locais; isso não afeta a simulação autoritativa.

## Interrupção, tracking e recuperação

Liberação/invalidação da reserva, saída, portal, inatividade, remoção e reset descartam o plano junto da reserva. O renderer remove os emotes, restaura as máquinas e elimina a referência ao dono. Mudança de bloco e shutdown também limpam a apresentação. Não há timers ou tweens da Fase 8.2 para cancelar.

A câmera, o UUID, o tracking e os nomes usam o fluxo existente. A escolha do comportamento independe de estar em foco. `currentArea` e `currentBlock` continuam sendo atualizados nos nós/portais pela Fase 8.1.

Refresh recupera o plano atualmente em memória do servidor e seu tempo decorrido. Reiniciar o servidor descarta planos e reservas; a recuperação espacial anterior inicia uma nova decisão. A criação de um personagem autoritativo agora respeita imediatamente seu estado/área recebidos, inclusive antes do próximo evento de movimento.

## Debug e validação

Use `/tela?debugWorld=true` em desenvolvimento. Além dos slots, o painel mostra estado, POI, slot, behavior, fase, emote e animação de máquina. Equipamentos suportados mostram `machine: IDLE` ou `PLAYING`. Diagnósticos continuam desabilitados em produção.

Comandos, sem serviços de IA reais:

```powershell
npm.cmd test
npx.cmd playwright test
```

Os testes novos estão em `tests/visit-visual-behavior.test.js` e `tests/browser/visit-visual-behavior.spec.js`: defaults, probabilidades, quatro direções/símbolos, tempos, imobilidade, cleanup, interrupções, não persistência, snapshot, refresh, portal, tracking, peças originais restauradas e limites com 10/50/100 avatares.

As medições de browser são amostras locais curtas; o teste controlado de efeitos coloca até 100 avatares visíveis, enquanto o teste da Fase 8.1 mede participantes reais distribuídos nos cinco blocos. Não equivalem a um ensaio prolongado na TV do evento. Não há nova colisão dinâmica entre pedestres, gesto manual de inspect ou sincronização global de demos entre TVs.

Última amostra de circulação real, Chrome local, 29/10/2026 (120 frames por tamanho):

| Participantes no mundo | Visíveis | FPS | Heap do browser | CPU do processo Node de teste | Reservas |
| --- | --- | --- | --- | --- | --- |
| 10 | 2 | 144 | 14 MB | 8% | 10 |
| 50 | 10 | 140 | 26 MB | 5% | 41 |
| 100 | 20 | 138 | 18 MB | 9% | 67 |

A CPU inclui o servidor e a condução do teste no mesmo processo; não é uma medição isolada do servidor. Heap e FPS oscilam entre execuções e coletas de lixo. Na execução completa anterior, a amostra de 100 participantes registrou 143 FPS, 40 MB e 13% de CPU. Os números não são garantias de capacidade.

A carga visual controlada (60 frames por tamanho, todos os avatares visíveis, janelas de efeito preparadas pelo teste) registrou:

| Avatares visíveis | FPS | Heap | Emotes ativos | Demos ativas | Tweens novos | Timers novos |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 133 | 16 MB | 6 | 1 | 0 | 0 |
| 50 | 144 | 18 MB | 8 | 1 | 0 | 0 |
| 100 | 144 | 23 MB | 8 | 1 | 0 | 0 |

Após clear: zero emotes e todas as máquinas IDLE. As quatro peças móveis tiveram comandos gráficos restaurados exatamente. Essa carga testa renderização, e não 100 participantes autoritativos visitando o mesmo bloco além da capacidade dos slots.

Validação concluída: **131 testes Node passaram**; **28 testes Chrome passaram na suíte completa**. Após o ajuste final de profundidade do nome/emote, os 131 testes Node foram executados novamente e uma regressão Chrome direcionada passou com **11 testes** (câmera, operador, POIs e efeitos). Os cenários novos não registraram erros de página/console. Capturas: `test-results/visual-82-emote-tracking.png`, `visual-82-cnc-demo.png` e `visual-82-100-visitors.png`.

Universal LPC, APIs de análise, Cloudflare, crachá, check-in, catálogo, composição e sistema de câmera não foram substituídos. A Fase 8.3 não foi implementada.
