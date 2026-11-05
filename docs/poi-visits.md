# Fase 8.1 — Visitas aos POIs

Os mesmos walkers, navigationNodes, rotas e portais continuam sendo usados. Não há outro motor de navegação, intervalos individuais, IA comportamental ou animações novas. Universal LPC, OpenRouter, Cloudflare e o fluxo de aprovação/entrada não foram modificados.

## Configuração

`public/js/macroWorldConfig.js` concentra os perfis de visita e `WORLD_BEHAVIOR`:

- 85% de preferência por um destino local; 15% de exploração entre blocos, quando há saída válida.
- Espera inicial de 4000–9000 ms na Sala de Acesso, com jitter por participante.
- Memória dos três últimos POIs; memórias mais antigas são relaxadas apenas quando faltam alternativas disponíveis.
- Nova tentativa após 1200–3000 ms quando não há vaga. O visitante sai da posição de observação e retorna ao seu waypoint antes de esperar.
- Permanência padrão de 5000–15000 ms. Sala de Acesso: 4000–9000 ms. Praça: 7000–18000 ms.
- Capacidade padrão: três. CNC: dois. Praça central: oito, com mais três posições no POI de exposição da Praça. Pontos de acesso internos: dois cada.
- Pesos: padrão 1; braço robótico 1,5; impressão 3D 1,3; laser 1,2; CNC 1,4.

Os IDs equivalentes existentes foram preservados, por exemplo `poi_area_cnc` e `poi_area_fresadora`. A Praça ganhou `poi_praca_display`. A área Inovação continua agrupando braço robótico, impressora 3D e laser; seu alias não reserva outra cópia dos slots do braço. A porta da Sala de Acesso não é destino de observação.

## Reserva e ciclo

Cada POI visitável tem `blockId`, `areaId`, `nodeId`, `visitorSlots`, `capacity`, `weight`, `minStayMs` e `maxStayMs`. Slots usam coordenadas absolutas do bloco, ID e uma das quatro direções LPC existentes. A orientação é calculada para o equipamento na projeção isométrica.

`createVisitController()` em `public/js/macroNavigation.js` mantém reservas e dados efêmeros em memória. Cada aplicação possui sua própria instância. A seleção/reserva síncrona acontece no loop autoritativo antes da caminhada, impedindo dois proprietários no mesmo slot. Um slot reservado durante o trajeto permanece indisponível até a partida.

Fluxo: `IDLE → WALKING → VISITING → WALKING`. Seleção, aproximação final e liberação são etapas dessas mesmas transições; `ENTERING` permanece separado. O grafo existente conduz até o node do POI, seguido de um pequeno segmento seguro até o slot. Durante a visita, o avatar fica no idle existente e olha para o equipamento.

Ao sair, o slot é liberado. Remoção lógica, remoção do Map de walkers, invalidação, troca de bloco, limpeza e encerramento liberam reservas. Uma reserva inválida cancela o destino e retorna o visitante ao grafo de forma segura. Lotação resulta em alternativa local disponível ou espera com jitter, sem loop de seleção no mesmo frame.

`currentArea` é atualizado nas chegadas aos nodes/slot, não na seleção. `currentBlock` e pavimento só mudam no portal pareado. Um objetivo explícito em outro bloco usa a pequena topologia existente para escolher o próximo portal; cada percurso interno continua passando por `routeBetween()`. Após a chegada ao novo bloco, um POI local tem prioridade.

Novos participantes completam a entrada original, permanecem inicialmente na Sala de Acesso e fazem as visitas iniciais já previstas antes de sair. Depois de sair, não escolhem novamente POIs da Sala de Acesso.

## Persistência e rastreamento

Reservas, destino de visita, slot, tempo de observação e histórico ficam em WeakMaps e não são serializados no SQLite. Não houve migração, coluna ou aumento da frequência de checkpoints. Posição, bloco, área e identidade continuam sendo salvos pelo mecanismo existente.

Refresh da TV não reinicia a simulação do servidor. O snapshot recupera localização e orientação atuais. Após restart do servidor, posição e área são preservadas, mas visitas sem reserva recuperada retornam ao waypoint e fazem uma nova decisão; não se tenta recuperar o antigo slot ou timer.

O Socket.IO existente transmite a orientação junto da posição/estado. `CharacterManager` usa essa orientação no idle existente; os arquivos LPC permanecem intactos. UUID, textura e campos de localização do rastreador não mudaram. A câmera existente acompanha visitas e portais sem receber um controlador novo.

## Debug

Abra `/tela?debugWorld=true`, selecione um bloco ou encontre um participante. O grafo original permanece e os slots aparecem como círculos vazios (livres) ou preenchidos (reservados, incluindo visitantes a caminho). As legendas mostram `poi_id` e `slots: ocupados/capacidade`.

O painel mostra até dez participantes do bloco: UUID curto, estado, POI/slot alvo e bloco/área atuais. A atualização reutiliza a cadência de 500 ms do operador e só monta o snapshot quando há um cliente debug. `GET /api/world?debugWorld=true` fornece o mesmo diagnóstico em desenvolvimento; os dados de ocupação são omitidos em produção e do snapshot normal. O modo normal de apresentação não exibe os marcadores.

Em `NODE_ENV=production`, o snapshot também desautoriza o debug solicitado e o cliente remove as sobreposições; os sockets não entram na sala de diagnóstico.

## Validação

`tests/poi-visits.test.js` cobre slots/conectores seguros, reserva/capacidade, tempo de observação, histórico, peso/probabilidade, entrada com jitter, invalidação, remoção/reset, portais múltiplos, persistência e simulações com 10/50/100 walkers. `tests/browser/poi-visits.spec.js` verifica o LPC idle, facing, ocupação debug, rastreamento CNC → Fresadora → Ponte Rolante, refresh e portais até o Bloco A.

```powershell
node --test tests/poi-visits.test.js
npm.cmd test
npm.cmd run test:browser -- tests/browser/poi-visits.spec.js
```

Limitações: as vagas evitam sobreposição nas posições reservadas, mas não introduzem desvio entre pedestres durante a caminhada ou controle de fila na entrada. Em lotação, a espera é aleatória, sem garantia de ordem. Blocos com poucos POIs podem repetir destinos após relaxar memórias antigas. A Fase 8.2 não está implementada.

### Amostra local de performance — 27/10/2026

Com walkers reais no servidor e posições transmitidas ao Chrome headless:

| Participantes | Visíveis no bloco amostrado | FPS | Heap do navegador | CPU Node amostrada | Reservas no instante |
| --- | --- | --- | --- | --- | --- |
| 10 | 2 | 144 | 16 MB | 2% | 9 |
| 50 | 10 | 144 | 28 MB | 7% | 42 |
| 100 | 22 | 142 | 34 MB | 20% | 68 |

São janelas curtas de 120 frames; CPU é do processo Node que hospeda a simulação/teste, não a utilização total do computador. Os números variam com hardware e carga e não equivalem a um ensaio prolongado no equipamento do evento. As simulações Node também verificam dez minutos de movimento com 10/50/100 participantes, distribuição em 22 destinos fora do acesso e ausência de reservas duplicadas.
