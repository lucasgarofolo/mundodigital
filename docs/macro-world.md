# Fase 6 — Geografia do Mundo // Digital

## Abrir e explorar

Execute `npm.cmd start` e abra `/tela`. O seletor **Explorar**, fixo na tela, alterna o bloco apresentado. Ele não move participantes. A seleção fica no parâmetro `block` da URL e sobrevive ao F5. Exemplos:

- `/tela?block=blockA_upper`
- `/tela?block=blockB_upper`
- `/tela?block=blockB_lower`
- `/tela?block=blockC_upper`
- `/tela?block=blockC_lower`
- `/tela?debugWorld=true&block=blockC_lower`

Sem parâmetros, abre o Bloco B Superior, com a Sala de Acesso existente. `?demo=1` e `?lpcTest=true` conservam as demonstrações anteriores na Sala 5. Esses visitantes fictícios não aparecem no modo normal.

## Configuração central e áreas

`public/js/world-config.js` exporta `WORLD`, que agora inclui `blocks`. A fábrica e as definições dos blocos estão em `public/js/macroWorldConfig.js`. O recorte legado de `WORLD.floors.ground_floor` continua disponível para compatibilidade; a navegação expandida utiliza `WORLD.blocks`. Os dois portais antigos desativados permanecem como referência histórica. Os portais funcionais ficam em cada bloco.

| Bloco | Áreas e IDs |
| --- | --- |
| `blockA_upper` | Praça Cívica (`area_praca_civica`); Setor de Inovação (`area_inovacao`), com Braço Robótico (`area_robot_arm`), Impressão 3D (`area_3d_printing`) e Corte a Laser (`area_laser_cutting`) |
| `blockB_upper` | Sala de Acesso (`area_access`); Almoxarife (`area_almoxarife`); Assistente Administrativo (`area_assistente_administrativo`); Culinária (`area_culinaria`); Ar-Condicionado (`area_ar_condicionado`); Corte e Costura (`area_corte_costura`) |
| `blockB_lower` | Pneumática (`area_pneumatica`); Hidráulica (`area_hidraulica`); Metrologia (`area_metrologia`); Manutenção Mecânica (`area_manutencao_mecanica`) |
| `blockC_upper` | Elétrica (`area_eletrica`); Solda (`area_solda`) |
| `blockC_lower` | Tornearia (`area_tornearia`); Fresadora (`area_fresadora`); CNC (`area_cnc`); Ajustagem (`area_ajustagem`); Injetora Plástica (`area_injetora_plastica`); Ponte Rolante (`area_ponte_rolante`) |

Todos também possuem `area_circulation` para representar os corredores. Inovação é uma área agrupadora com `children`; os três setores têm `parentArea: 'area_inovacao'`. Cada área possui `agents: []`, reservado e sem comportamento implementado.

Os blocos possuem `id`, `name`, `floor`, `areas`, `navigationNodes`, `connections`, `portals`, `bounds`, `spawnPoints`, `pointsOfInterest`, `layout` e `defaultZoom`. `navigationEdges` referencia as mesmas conexões para reutilizar o algoritmo de rotas anterior. Coordenadas são unidades lógicas de piso, convertidas para isometria somente na renderização.

Exemplo de consulta no navegador ou servidor:

```js
import { WORLD } from './world-config.js';
const cnc = WORLD.blocks.blockC_lower.areas.area_cnc;
// { id, name, theme, color, bounds, obstacles, agents: [] }
const visits = WORLD.blocks.blockC_lower.pointsOfInterest;
```

## Sala de Acesso preservada

O desenho original de `drawWorld`, móveis, paredes, porta, escada de contexto, `spawn_sala5`, waypoints e percurso de entrada continuam nas mesmas coordenadas. A entrada segue o agendamento anterior, a caminhada externa e a passagem pela porta original. Nenhum participante novo começa em outro bloco.

O novo caminho sai de `porta_sala5`, passa por `access_threshold`, `access_corridor`, `access_turn`, `access_exit` e alcança a circulação do bloco. A extensão começa depois do corredor, evitando atravessar paredes ou a escada decorativa original. A escada decorativa continua sendo cenário; a passagem vertical funcional tem identificação própria no bloco.

## Participantes, destinos e caminhos

`movement.js` continua sendo o simulador compartilhado e mantém `ENTERING`, `IDLE`, `WALKING` e `VISITING`. O servidor habilita `allowExploration`; a demonstração antiga permanece restrita à Sala 5. `macroNavigation.js` acrescenta a escolha de destinos e a chegada aos portais usando o mesmo `routeBetween` por busca em largura.

Cada bloco tem uma circulação principal com três nós (`aisle_0` a `aisle_2`), ramificações para os POIs e ramificações de passagem. Os novos móveis ocupam footprints separados das rotas. Os testes amostram todos os segmentos com os oito offsets usados pelos participantes. Não há caminhada livre nem desvio arbitrário fora do grafo.

Cada área temática tem ao menos um POI com `blockId`, `areaId`, `nodeId` e nome. Os POIs novos declaram oito `visitorSlots`, equivalentes aos offsets de faixa já usados pelo simulador. O índice do participante distribui as paradas entre essas posições. Inovação também oferece um POI associado ao setor robótico. Áreas são abertas, diferenciadas por pisos, placas e equipamentos simples; a Sala 5 conserva suas paredes existentes.

`EXPLORATION`, em `macroWorldConfig.js`, configura a chance de escolher um portal: **16% por escolha de destino**; as demais escolhas são POIs locais. Na Sala de Acesso o visitante completa **três visitas iniciais** antes de explorar. Isso é um critério simples por visitas, não um temporizador de 15 minutos. Ao sair, `hasLeftAccess` impede escolher novamente os POIs da Sala de Acesso, inclusive depois de restart. O ajuste do tempo operacional do evento fica separado desta geografia.

`currentBlock` identifica o bloco; `currentArea` identifica o setor do último nó alcançado, ou `area_circulation` durante a circulação. Durante um segmento, mantém-se a área do nó anterior até alcançar o próximo. `currentFloor` permanece compatível: `ground_floor` corresponde ao superior nesta topologia e `lower_floor` ao inferior. `currentRoom` continua `sala5_acesso` na Sala 5; nas novas áreas usa o ID da área e, nos corredores, `circulation`.

## Portais e pavimentos

```text
Bloco A Superior ↔ Bloco B Superior ↔ Bloco C Superior
                         ↕                    ↕
                  Bloco B Inferior     Bloco C Inferior
```

Cada conexão tem dois portais pareados, com `nodeId`, `targetBlock` e `targetNode`. O participante caminha até o nó de saída escolhido, muda de bloco e reaparece no nó correspondente da outra extremidade, com o mesmo offset. A rota termina, entra em `IDLE` por um segundo e depois escolhe outro destino. Passar perto de um portal sem tê-lo escolhido não provoca transição.

Conexões entre pavimentos têm `type: 'stairs'`. As demais usam `passage`. Não há sobreposição de pavimentos nem transições de Scene para áreas internas. UUID, nome, avatar e versão LPC são mantidos.

## Phaser, renderização e câmera

Foi mantida **uma única `WorldScene`**, porque a arquitetura anterior já separa simulação, apresentação e sincronização. `macroWorldRenderer.js` destrói somente os objetos do cenário anterior e desenha o bloco selecionado, reutilizando `box`, `floorTiles` e a projeção existentes. Os equipamentos são placeholders vetoriais locais: robô, impressora, laser, fogão, máquinas, painéis, instrumentos e ponte rolante elevada. Nenhum pacote externo foi baixado.

`ParticipantsClient.latest` mantém os dados recebidos de todos os participantes. O `CharacterManager` contém somente avatares do bloco exibido. Eventos de outros blocos atualizam dados, sem criar sprites nem carregar suas texturas antecipadamente. Ao trocar o bloco, os avatares anteriores são destruídos e os correspondentes são recriados; texturas e animações permanecem no cache global do Phaser. A simulação lógica de todos continua no servidor, necessária para que explorem mesmo sem uma TV observando aquele bloco.

`cameraController.js` enquadra os limites projetados de cada bloco, incluindo margem para objetos altos. A mudança de bloco troca foco e enquadramento, preservando o zoom relativo atual. Resize mantém foco e zoom. Roda, `+`, `-`, `0` e `focusOn` continuam disponíveis. Zoom relativo: mínimo **0,65**, máximo **1,8**, padrão **1**. `0` restaura a visão do bloco atual. HUD e seletor são HTML fixo e não recebem zoom do mundo.

`debugWorld=true` exibe conexões, IDs dos nós e áreas, portais, POIs e bounds. No modo normal permanecem as placas temáticas e os nomes das passagens.

## Persistência, F5 e restart

A migração SQLite **7** adiciona `current_block` e `current_area` com valores padrão `blockB_upper` e `area_access` para os registros antigos. Nenhum cadastro, arquivo de avatar, portrait ou crachá é apagado. `simulation` continua armazenando posição exata, nó, rota, destino, visitas, offsets e estado, além dos novos campos espaciais.

O servidor salva lotes em mudanças de bloco/área e chegadas a POIs, mantendo também o checkpoint periódico de cinco segundos e o encerramento gracioso. Não grava a posição de cada pessoa a cada frame. Uma queda abrupta pode perder o trecho de caminhada desde o último checkpoint; o bloco/área de uma transição já concluída é salvo no próprio evento.

Após F5, `/api/world` fornece os participantes e seus blocos. Somente os correspondentes ao bloco da URL são apresentados. Após restart do Node, os walkers são reconstruídos do banco com a rota restante; não repetem check-in, análise ou entrada. Um registro incompleto sem posição/nó válido usa um POI da própria área ou o centro do próprio bloco, em vez de voltar à Sala 5. Registros legados sem localização macro pertencem à Sala de Acesso.

## Testes e limites

Comandos:

```sh
npm.cmd test
npx.cmd playwright test
```

Os testes novos estão em `tests/macro-world.test.js` e `tests/browser/macro-world.spec.js`. Cobrem conectividade, footprints dos equipamentos, margens dos percursos, oito transições direcionadas, identidade, persistência real em três blocos, recuperação de posição ausente, não retorno à Sala de Acesso, abertura dos cinco blocos, F5, câmera, resize, HUD fixo e repetidas trocas sem acumular objetos de cenário.

Validação em 22/10/2026: **41/41 testes Node aprovados**. A execução completa do Chrome aprovou 17 dos 18 cenários; o teste antigo de câmera exigia um centro renderizado sem arredondamento, embora o Phaser use `roundPixels`. O teste foi corrigido para verificar o foco lógico exato e uma tolerância de um pixel na imagem, e passou em duas repetições consecutivas. Os dois cenários novos de blocos/carga também passaram novamente, agora verificando erros de console e JavaScript. Assim, todos os 18 cenários foram validados, com a câmera reexecutada separadamente após o ajuste. A Sala 5 completou dois minutos de circulação segura, e os testes anteriores de check-in, câmera da selfie, portrait, crachá, reset administrativo, API, Socket.IO e restart continuaram aprovados.

A simulação exercita 10, 50 e 100 pessoas durante 20 minutos simulados, incluindo navegação e transições. No navegador, 10/50/100 LPCs são distribuídos pelos cinco blocos, exibindo 2/10/20 sprites por bloco. Na primeira amostra curta de Chrome headless, foram observados aproximadamente 144/144/141 FPS e 17/35/30 MB de heap JavaScript. Não são medições da TV nem da memória GPU; coleta de lixo e carga da máquina alteram os valores. O teste gráfico usa sprites de teste em visita, enquanto os percursos são exercitados pelo simulador. Não testa capacidade de geração de IA nem latência de provedores.

Há oito slots por POI; grupos maiores podem compartilhar um slot e nomes podem se sobrepor. Não há colisão entre pessoas nem desvio dinâmico. A geometria é conceitual, não uma planta precisa. Os equipamentos são ilustrativos e estáticos. O enquadramento integral reduz a legibilidade em celulares estreitos. O cache de texturas cresce conforme avatares distintos são vistos, preservando a estratégia anterior; não foi implementada política de descarte de participantes de um evento longo.

**Universal LPC não foi alterado:** nenhum arquivo de `public/js/avatar`, sprite sheet, composição, escala, catálogo ou pipeline de avatar foi modificado nesta fase. Check-in, portrait, crachá e compartilhamento permanecem no fluxo anterior. Não foram implementados rastreador, agentes, missões ou recursos de fases futuras.

## Arquivos

Criados: `public/js/macroWorldConfig.js`, `public/js/macroNavigation.js`, `public/js/macroWorldRenderer.js`, `tests/macro-world.test.js`, `tests/browser/macro-world.spec.js`, `docs/macro-world.md`.

Modificados: `public/js/world-config.js`, `public/js/world.js`, `public/js/movement.js`, `public/js/game.js`, `public/js/cameraController.js`, `public/js/characters.js`, `public/js/participantsClient.js`, `public/tela.html`, `public/css/style.css`, `server.js`, `lib/store.js`, `package.json`, `tests/world.test.js`, `tests/persistence.test.js`, `tests/browser/camera.spec.js`, `README.md`.
