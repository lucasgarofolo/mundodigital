# Mundo // Digital — Fase 9B

**Publicação:** preparação final de produção em [docs/production.md](docs/production.md), com configuração completa, volume, navegador do Story, proxy/HTTPS, smoke test e comandos Git. Use Node 24.13.0 (`.node-version`), `npm ci` e `npm start`. Em produção, `DATA_DIR` explícito e privado é obrigatório. Não há build de frontend nem Docker nesta etapa.

**Acesso atual:** check-in e passe continuam públicos. Mapa/TV, operador, câmera, rastreamento, debug e APIs operacionais exigem login. Configure `SESSION_SECRET`, crie a primeira conta com `npm run admin:create` e inicie com `npm start`. Use `/login`, `/world` e `/admin`. Consulte o [inventário de rotas, sessões, CSRF, Socket.IO, variáveis e publicação](docs/authentication.md).

**Central de operação:** `/admin` reúne contadores calculados no SQLite, status passivo dos serviços e da TV, busca com acentos, filtros, paginação, detalhes sem selfie e atividade recente. Permite localizar na TV, voltar à Sala de Acesso, recuperar LPC/portrait dentro das regras existentes, regenerar Story sem IA, agendar/cancelar entrada, remover somente o avatar do mundo e repetir uma exclusão de selfie que falhou. As contas administrativas continuam usando a autenticação da Fase 9A. Reinicie o servidor para carregar o painel; não há nova variável de ambiente, migration ou dependência. Consulte [ações, segurança, arquivos e validação da Fase 9B](docs/admin-operations.md).

**Política atual de selfie:** o check-in apresenta aviso e exige ciência do processamento por IA no frontend e backend. A imagem fica privada e temporária, é preservada durante os retries dos dois pipelines e apagada quando nenhum consumidor precisa mais dela. LPC, portrait, crachá e Story permanecem disponíveis. Consulte [ciclo de vida, recuperação após restart e testes](docs/selfie-privacy.md). Reinicie o servidor para aplicar a migração aditiva do banco para versão 8 e carregar os novos handlers.

Para visualizar 100 avatares fictícios com circulação, POIs e comportamentos sociais, execute `npm run demo:world -- 100` e abra [a demonstração local](http://127.0.0.1:3001/tela?block=blockA_upper). São 100 participantes distribuídos pelos cinco blocos, com 12 variações LPC compostas localmente. Use **Explorar** para trocar de bloco. O script usa um banco separado em `.test-data/demo-world-*`, carrega o secret do `.env` e exige login, sem chamar APIs de IA. Crie a conta no `DATA_DIR` isolado informado pelo script. Ctrl+C encerra essa instância. Uma porta alternativa pode ser passada como segundo argumento: `npm run demo:world -- 100 3002`.

A Fase 8.3 adiciona [encontros visuais ocasionais nos POIs](docs/social-behavior.md): reconhecimento por facing, aceno por emote e reações compartilhadas com atraso entre os visitantes. Usa as reservas e os efeitos existentes, com locks temporários, cooldown e seleção periódica limitada. Grupos surgem da ocupação dos slots; não há amizade, relacionamento, diálogo, persistência social ou IA nova. Câmera e navegação permanecem iguais.

A Fase 8.2 adiciona [comportamentos visuais nos POIs](docs/visit-visual-behavior.md): observação, olhar ao redor, emotes pixelados discretos e demos curtas no robô, impressora 3D, CNC e ponte rolante. Reutiliza as visitas da Fase 8.1 e os frames idle LPC existentes, sem novas chamadas de IA. Efeitos são efêmeros e limitados por bloco visível.

A Fase 8.1 adiciona [visitas aos POIs com posições reservadas](docs/poi-visits.md), capacidade, permanência variável, memória curta e preferência pelo bloco atual. O movimento reutiliza o grafo e os portais existentes. Use `/tela?debugWorld=true` para conferir slots e destinos em desenvolvimento. Universal LPC, análise visual, portrait, credencial e câmera foram preservados.

A Fase 7 adiciona o [controle do operador e rastreamento da câmera](docs/operator-tracking.md), agora também na própria tela do mundo. Abra `/tela`, pesquise o nome na barra compacta e clique **ENCONTRAR**. **Recolher controles** libera a visualização e mantém **IR PARA SALA DE ACESSO** acessível. `/operator` continua disponível para controle remoto. A TV acompanha o UUID escolhido até outro comando, sem timeout de retorno. HOME devolve a câmera ao enquadramento original da Sala 5. O foco sobrevive ao refresh da TV; um restart do servidor inicia em HOME. A Fase 9A substitui a chave compartilhada por conta e sessão administrativa, tanto localmente quanto em outros dispositivos.

A Fase 6 expande o mundo para cinco blocos temáticos conectados, com áreas, POIs, caminhos, portais e persistência espacial. Em previews com `?block=blockB_upper` ou `?debugWorld=true`, use **Explorar** para alternar entre blocos; o modo debug também mostra o grafo. A Sala 5, o check-in, o crachá e o Universal LPC foram preservados. Consulte a [arquitetura atual, áreas, configuração, navegação e testes](docs/macro-world.md).

## Providers de análise visual LPC

`AVATAR_PROVIDER` aceita `local` (LPC padrão, sem análise IA), `ollama` (análise local), `gemini` (Google) e `openrouter` (análise multimodal pelo OpenRouter). O OpenRouter classifica somente os dez atributos visuais: os sprites continuam sendo compostos localmente pelo Universal LPC. Cloudflare/FLUX.2 Klein 4B continua responsável pelo portrait do crachá, em paralelo e com fila/cache independentes.

Para ativar, ajuste apenas estas variáveis no `.env`, preservando as demais credenciais:

```dotenv
AVATAR_PROVIDER=openrouter
OPENROUTER_API_KEY=sua_chave_apenas_no_backend
OPENROUTER_AVATAR_MODEL=qwen/qwen3-vl-30b-a3b-instruct
OPENROUTER_AVATAR_TIMEOUT_MS=30000
```

O modelo acima é o padrão; somente `OPENROUTER_AVATAR_MODEL` o substitui. A configuração real existente não é alterada pela instalação desta integração. Não publique `.env` nem envie chaves ao navegador.

O analisador usa `POST https://openrouter.ai/api/v1/chat/completions`, prompt compartilhado e JPEG privado de até 768×768 (qualidade 82) como data URI, sem nome/e-mail/UUID. Envia `stream: false`, `temperature: 0`, `max_tokens: 350`, `provider: { require_parameters: true }` e `response_format: { type: 'json_schema', json_schema: { name: 'avatar_appearance', strict: true, schema: avatarSchema() } }`. Não fixa DeepInfra, não solicita `usage.include` e não gera sprites ou portraits. Structured Outputs seguem a [interface oficial do OpenRouter](https://openrouter.ai/docs/guides/features/structured-outputs).

Somente uma resposta com `finish_reason: 'stop'`, conteúdo JSON válido e aparência validada estritamente é aceita. Recusa, truncamento e envelope vazio/inválido são rejeitados. O retorno continua sendo apenas `appearance`, normalizada pelo catálogo atual e validada novamente pelo pipeline.

São dois trabalhos LPC simultâneos. Os 30000 ms são o prazo global de análise, incluindo chamadas e o intervalo de retry; o `AbortSignal` do pipeline cancela o HTTP. O analisador também respeita seu timeout, seguindo a convenção existente (`0` desativa o prazo local). A única repetição continua no pipeline: HTTP 500/502/503/504, intervalo de 1000 ms, até duas tentativas persistidas. 401/403, 429, rede, resposta inválida e timeout não criam retries adicionais. Falhas usam o LPC de fallback existente, sem chamar Gemini/Ollama automaticamente. `READY` não é reanalisado ao trocar provider; “Gerar outra versão” continua sendo variação local.

Logs `[OpenRouter]` registram modelo, HTTP, duração, fornecedor efetivo quando informado e métricas numéricas disponíveis (`prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`). Métricas ausentes são omitidas; não há persistência de custo nem logs de chave, imagem ou conteúdo bruto da resposta.

Em falhas, `stage` identifica a etapa (`image_read`, `image_prepare`, `http_request`, `http_response`, etc.) e `cause_code` mostra somente códigos técnicos conhecidos, como `ECONNRESET`, `ENOTFOUND` ou falha de certificado. `OPENROUTER_UNAVAILABLE` sem `http_status` não significa HTTP 503: a conexão pode ter sido interrompida antes da resposta. Se funcionar no Insomnia e falhar num processo iniciado por um ambiente restrito, execute `npm.cmd start` em um terminal PowerShell comum, na pasta do projeto, e compare. Não desative a validação TLS. Diagnóstico confirmado com a mesma requisição e imagem sintética: o ambiente restrito produziu `ECONNRESET`; fora dele houve HTTP 200. Timeout e política central de retry permanecem iguais.

`npm start` inicia o Node com `--use-system-ca`, incluindo as autoridades certificadoras já confiáveis no sistema operacional. Isso mantém a validação HTTPS ativa e permite usar uma CA corporativa/antivírus já instalada no Windows. `SELF_SIGNED_CERT_IN_CHAIN` significa que a cadeia recebida não é confiável para esse processo; pode ocorrer com inspeção HTTPS, independentemente da validade da chave da API. Consulte a [orientação oficial do Node](https://nodejs.org/learn/http/enterprise-network-configuration). Reinicie o servidor após atualizar o comando. Para executar diretamente, use `node --use-system-ca server.js`.

Se o erro persistir, a autoridade necessária pode não estar instalada no Windows. Solicite ao responsável pela rede o certificado CA correto em PEM e, antes de iniciar o Node, configure `$env:NODE_EXTRA_CA_CERTS = 'C:\caminho\ca-confiavel.pem'`. Use somente a CA verificada da sua rede; não importe certificados recebidos da conexão que falhou. Não use `NODE_TLS_REJECT_UNAUTHORIZED=0` nem `rejectUnauthorized: false`.

### Teste real controlado

Os testes automatizados usam mocks e não exigem chave. Para um teste real, use somente uma selfie de teste autorizada: configure as variáveis acima, reinicie `npm.cmd start` e faça **um novo check-in** em `/check-in`. Acompanhe `[OpenRouter] completed` no terminal e confira o LPC no crachá antes de aprovar a entrada. Uma única imagem não demonstra precisão geral. O portrait continuará sendo uma chamada independente à Cloudflare, caso configurada.

Para fazer **exatamente uma chamada de análise**, sem cadastro, banco, retry ou Cloudflare, execute na raiz do projeto, trocando o caminho pela selfie autorizada:

```powershell
node --use-system-ca --env-file=.env -e "const {createOpenRouterAvatarAnalyzer}=require('./lib/openRouterAvatarAnalyzer');createOpenRouterAvatarAnalyzer()(process.argv[1]).then(appearance=>console.log(JSON.stringify(appearance,null,2))).catch(error=>{console.error(error.code);process.exitCode=1})" "C:\caminho\selfie-autorizada.jpg"
```

Esse comando registra as métricas seguras e a aparência final. `npm.cmd run avatar:analyze -- <uuid>` permanece uma ferramenta de manutenção: pare o servidor antes de utilizá-la; ela reutiliza `READY` e respeita o orçamento persistido. Em modo `local`, não analisa nem altera participantes.

## Histórico das fases anteriores

As seções abaixo registram decisões e limitações das fases anteriores; a referência atual da geografia é o documento da Fase 6.

A Fase 5 usa o **crachá digital como credencial de entrada**. O check-in prepara LPC e portrait em paralelo e abre diretamente `/pass/:uuid`. O botão **ENTRAR NO MUNDO // DIGITAL** no próprio crachá aprova o avatar e agenda sua entrada; depois ficam disponíveis download e compartilhamento do Story 1080×1920. Consulte o [fluxo atual, estados, espera do portrait e testes](docs/credential-flow.md) e os [detalhes da Cloudflare e da exportação](docs/portrait-pass.md).

Para continuar o desenvolvimento com análise de selfie local, use `AVATAR_PROVIDER=ollama`. Consulte [configuração e teste real do Ollama](docs/ollama-avatar.md). O modo `local` continua sendo apenas o avatar padrão sem análise.

A entrada da Fase 4.2 foi preservada: “Olhe para a TV 👀”, espera de oito segundos e caminhada pela porta da Sala 5, com recuperação após restart. A aprovação agora ocorre no crachá; a prévia isolada daquela fase foi substituída. Consulte [avatar-experience.md](docs/avatar-experience.md) para o histórico da implementação.

A personalização continua usando **selfie → Gemini → composição LPC local** em background. Configure `.env` a partir de `.env.example` com `AVATAR_PROVIDER=gemini` e sua chave, ou use `local` para operação offline. Falhas também geram uma prévia que precisa de aprovação. Consulte [avatar-pipeline.md](docs/avatar-pipeline.md) para catálogo, fila e análise da selfie.

A prova de conceito LPC está disponível em **`/tela?lpcTest=true`**: sete avatares atuais e um LPC animado. Consulte [formato, assets, catálogo e integração](docs/lpc-avatar-options.md) e [créditos/licenças](CREDITS-LPC.md). Para regenerar o PNG offline: `npm.cmd run avatar:build`.

A Fase 3 complementa a persistência existente com migração automática, status, fotos privadas, restauração por API, eventos incrementais e testes de reinicialização/carga. Consulte [PHASE3.md](PHASE3.md) para comportamento atual, schema, APIs e resultados. Os registros da Fase 2 abaixo são históricos.

Pequena Sala 5 isométrica para televisão, agora com check-in pelo celular e participantes reais. Os oito participantes fictícios continuam disponíveis em `/tela?demo=1`. Consulte [a entrega da Fase 2](PHASE2.md) para API, SQLite, ciclos, selfies e limitações da geração local. O projeto da Fase 1 foi evoluído: servidor Express, cena Phaser, avatares, ciclo `IDLE → WALKING → VISITING`, nomes e HUD foram reaproveitados. A sala ocupa a maior parte de uma tela 16:9, com apenas um trecho de corredor e o núcleo de escada vizinho como contexto.

## Referência e interpretação arquitetônica

A referência utilizada é `public/assets/map/sc-site-13.jpg`, identificada na própria imagem como **PLANTA PAVIMENTO TÉRREO**. `sc-site-14.jpg` foi preservada, mas não fornece geometria para esta fase. Nenhuma planta é carregada pelo Phaser ou exibida como fundo.

A legenda indica que **5 é a categoria Salas de Aula**, repetida em vários ambientes. Foi interpretada como sala de acesso a primeira sala da fileira superior do bloco à direita da Área 34 (Praça Cívica), imediatamente à direita do núcleo de escada. Seu acesso ocorre pelo corredor abaixo da sala na imagem. A relação sala–escada–corredor foi preservada; a Praça Cívica não foi construída.

A planta não identifica exclusivamente qual ambiente da categoria 5 é a sala do evento. Essa escolha de sala precisa de confirmação operacional antes de ampliar o mapa. Dimensões, disposição dos móveis, janelas, abertura da folha da porta, cores e decoração são simplificações visuais, não detalhes arquitetônicos confirmados. “Direita/abaixo” descreve a imagem de referência, não uma orientação geográfica validada. As paredes da frente estão cortadas para tornar o interior legível.

## Executar

Requer Node.js 24 ou superior.

```sh
npm install
npm start
```

Abra **http://localhost:3000/tela**. `/` redireciona para `/tela`. Use F11 para exibir em tela cheia na TV. A porta padrão é 3000; pode ser alterada pela variável `PORT`. Phaser é servido localmente, sem CDN. Depois da instalação, a aplicação não depende de internet.

No PowerShell com scripts bloqueados, use `npm.cmd install`, `npm.cmd start` e `npm.cmd test`. Se a porta estiver ocupada por uma instância anterior, encerre essa instância antes de iniciar outra.

## Estrutura e arquivos alterados

```text
package.json / package-lock.json       preservados
server.js                             preservado
playwright.config.js                  preservado
README.md                             atualizado
public/
  tela.html                           atualizado
  css/style.css                       atualizado
  js/
    package.json                      preservado
    game.js                           integrado ao controlador de câmera
    cameraController.js               novo: zoom, foco, resize e reset
    world-config.js                   novo: dados da escola
    world.js                          atualizado: projeção, grafo e renderização
    characters.js                     adaptado: spawn, waypoints e identificação
  assets/
    map/sc-site-13.jpg                 preservado, referência do térreo
    map/sc-site-14.jpg                 preservado, não usado no mundo
    characters/.gitkeep               reservado para sprites futuros
tests/
  world.test.js                       atualizado
  browser/world.spec.js               atualizado
  browser/camera.spec.js              novo: controles e regressões da câmera
```

## Onde estão os dados

Tudo está centralizado em `public/js/world-config.js`, em `WORLD.floors.ground_floor`:

| Elemento | Localização |
| --- | --- |
| Sala | `rooms.sala5_acesso`, com `id: "sala5_acesso"`, `name: "Sala 5"`, `type: "access_room"` |
| Interior | `bounds`, `furniture`, `wallHeight`, `wallDecor` da sala |
| Spawn | `spawnPoints.sala5`, com `id: "spawn_sala5"`, região livre e oito offsets iniciais distintos |
| Waypoints | `navigationNodes` e `navigationEdges` |
| Locais de visita | `pointsOfInterest`, vinculados aos waypoints |
| Porta | `rooms.sala5_acesso.door` e `portals.sala5_corredor`, com `id: "portal_sala5_corredor"` |
| Escada | `context.stairs` e `portals.stairs_near_area34` |
| Corredor curto | `context.corridor`, apenas contexto visual |
| Segundo pavimento | `WORLD.floors.lower_floor`, definição vazia |

O grafo interno tem oito nós e conexões explícitas. Os seis locais de visita são duas bancadas, um terminal, duas mesas e a proximidade da porta. Porta e escada têm `enabled: false`; não há troca de mapas ou pavimentos. Não existem waypoints no corredor ou na escada.

`public/js/world.js` centraliza `project(x,y)`, a única conversão de coordenadas lógicas para a tela. Também contém os placeholders isométricos, `routeBetween(fromNodeId,toNodeId)` para o pequeno grafo e `isPositionWalkable(position)` para validar limites e espaços ocupados por móveis. O grafo permanece separado dos desenhos.

## Personagens e movimento

`FICTIONAL_PARTICIPANTS`, em `public/js/characters.js`, mantém Ana, Lucas, Bia, Pedro, Júlia, Rafa, Caio e Lara. `CharacterManager.addParticipant(data)` permanece como extensão local. Nesta fase todos usam `spawn_sala5`, com offsets definidos nos dados; posições arbitrárias de nascimento não são usadas.

Cada personagem expõe `id`, `name`, `currentFloor`, `currentRoom`, `x`, `y`, `position`, `state`, `speed` e `destination`. `x/y` são getters da posição lógica, sem uma segunda posição que possa ficar desatualizada. Nome e avatar pertencem ao mesmo container Phaser. Não foram criadas busca ou câmera de rastreamento.

A movimentação preserva velocidades e pausas variadas. Os personagens seguem as arestas do grafo interno, com pequenos offsets lógicos por participante, visitam um destino, aguardam e escolhem outro. O primeiro deslocamento conecta a posição espalhada do spawn ao grafo sem teletransporte. Os trajetos estão afastados dos móveis e limitados ao interior da Sala 5.

`game.js` preserva a inicialização Phaser e delega a câmera a `CameraController`. O enquadramento usa os mesmos limites da Fase 1.5 em `WORLD.bounds`; não inclui a escola inteira. Mapa, personagens e HUD não foram alterados na Fase 1.6.

## Câmera — Fase 1.6

O controle está em `public/js/cameraController.js`. A roda do mouse aproxima/afasta; `+` e `-` (incluindo teclado numérico) controlam o zoom; `0` retorna à visão inicial da Sala 5. O HUD permanece em HTML/CSS fixo, fora do canvas, e não recebe zoom. Atalhos com Ctrl/Command/Alt e eventos em campos de texto são preservados.

`CAMERA_SETTINGS` define **mínimo 0,65x, máximo 1,8x e padrão 1x**, relativos à visão que enquadra a sala. O valor absoluto do Phaser é `baseZoom × zoom`. Em 1920×1080, o padrão absoluto é aproximadamente **1,842**; os extremos absolutos são aproximadamente **1,197 e 3,315**. Os limites relativos permitem preservar a visão original em TVs e em telas estreitas.

`setZoom`, `zoomIn`, `zoomOut` e `resetView` alteram apenas os alvos. `update(delta)` interpola zoom e foco com suavização independente da taxa de frames (constante de tempo de 110 ms). Entradas consecutivas atualizam o mesmo alvo, sem empilhar tweens. O foco permanece no centro original do recorte; a posição do cursor não desloca a câmera. Resize recalcula apenas `baseZoom` e o viewport, preservando o fator atual, seu alvo e o foco.

`focusOn(x, y, { zoom })` recebe coordenadas **lógicas do mapa** e faz uma aproximação suave pontual. Não é utilizado pela interface e não segue um personagem automaticamente. Para o futuro rastreamento, o controlador poderá guardar um participante e atualizar `targetFocus` a cada frame com `project(participant.x, participant.y)`, reutilizando a interpolação. Pesquisa por nome e esse loop de rastreamento não foram implementados.

```js
scene.cameraController.focusOn(participant.x, participant.y, { zoom: 1.4 });
scene.cameraController.resetView();
```

Os listeners de roda, teclado e resize são removidos no encerramento da cena para evitar duplicação em reinicializações.

Validação da Fase 1.6: os três testes Node passaram; o cenário da Fase 1.5 passou por dois minutos (111 visitas, sem erros ou violações de circulação). O novo `tests/browser/camera.spec.js` passou após corrigir o processamento repetido de um mesmo evento de teclado enfileirado pelo Phaser. A correção usa um `WeakSet` no controlador; eventos novos de repetição de tecla continuam funcionando.

O cenário de câmera verificou roda nos dois sentidos, teclas `+`, `-`, teclado numérico e `0`, limites, amostras intermediárias de zoom suave, foco constante, HUD com dimensões fixas, resize com zoom ativo e durante interpolação, foco pontual seguido de reset, movimento dos personagens e nomes. Nenhum erro da aplicação foi capturado. A imagem `test-results/sala5-zoom-max.png` foi inspecionada visualmente; no máximo há recorte das bordas do ambiente, como esperado ao aproximar.

Para repetir somente o teste de câmera:

```sh
npm run test:browser -- tests/browser/camera.spec.js
```

## Como acrescentar uma sala futuramente

1. Cadastre a nova sala em `floors.ground_floor.rooms`, com ID próprio, limites e móveis em coordenadas lógicas.
2. Acrescente seus nós em `navigationNodes`, conexões em `navigationEdges`, pontos de interesse e spawn, se necessário.
3. Defina o destino do portal que fará a conexão. Implemente a transição apenas na fase correspondente; os atuais permanecem desativados.
4. Amplie a renderização e os limites de câmera para a região que deverá aparecer. O renderizador atual seleciona somente `WORLD.activeRoom`; a lógica de personagens usa o térreo nesta fase.
5. Rode os testes de segurança dos trajetos antes de liberar novos destinos.

O pavimento inferior continua vazio. Não há socket, servidor de participantes ou persistência.

## Testes

```sh
npm test
npm run test:browser
```

Os testes Node verificam `/`, `/tela`, Phaser local, IDs dos ambientes, portais desativados, segundo pavimento vazio, conectividade de todos os nós e segurança dos segmentos de navegação com todos os offsets de personagem. Também verificam os deslocamentos iniciais desde o spawn, a restrição do corredor e a exclusão das mesas/cadeiras.

O teste Playwright usa o Chrome instalado e verifica:

- Inicialização do Phaser e oito participantes com identidade, pavimento, sala e posição.
- Nascimento no `spawn_sala5`, em oito posições distintas dentro da região livre.
- Apenas a Sala 5 ativa, HUD e nomes acompanhando os avatares.
- Canvas e câmera em 1920×1080, 1280×720, 800×600 e 390×844.
- Circulação por dois minutos, visitas variadas e ausência de colisões com móveis/paredes em cada frame.
- Ausência de erros de JavaScript e console.

As capturas ficam em `test-results/sala5-1920.png`, `sala5-spawn-1920.png` e `sala5-mobile.png`. Se não houver Chrome instalado, ajuste `channel` em `playwright.config.js`.

### Resultado em 10/10/2026

`npm install` concluiu com 71 pacotes auditados e nenhuma vulnerabilidade reportada. `npm start` foi verificado em uma porta temporária (3001), pois o servidor principal já estava ativo em 3000; ambos responderam com `/ → /tela` (302) e `/tela` (200). A instância temporária foi encerrada e a principal permanece disponível.

Os três testes Node passaram. A execução final no Chrome passou e encerrou normalmente: quatro tamanhos de tela, oito participantes, 102 visitas em dois minutos, nenhum frame fora da região permitida ou sobre móveis e nenhum erro JavaScript/console. As capturas de TV e tela estreita foram inspecionadas visualmente; as visitas variam entre execuções.

O único aviso foi do executor sobre `NO_COLOR`/`FORCE_COLOR`, sem impacto na aplicação. Neste Windows o PowerShell bloqueia `npm.ps1`, por isso a validação usou `npm.cmd`. A instalação foi executada com a permissão existente para escrever no cache do npm fora da pasta do projeto.

## Limitações

Esta é uma interpretação estilizada do recorte indicado, não uma reprodução CAD nem uma identificação arquitetônica exclusiva da sala do evento. A sala exata e seus detalhes precisam de validação antes de futuras expansões. Os avatares são placeholders sem animações direcionais completas. Há offsets para reduzir sobreposições, mas não há desvio entre participantes; encontros e nomes parcialmente sobrepostos ainda podem ocorrer. A segurança contra móveis decorre do grafo e das margens validadas, sem física ou pathfinding avançado.

Telas estreitas mantêm todo o recorte visível, com elementos menores. O navegador pode pausar uma aba oculta; o retorno não provoca saltos. O check-in, SQLite e Socket.IO foram adicionados na Fase 2, documentada em PHASE2.md. Geração real por IA, saída dos ciclos, pesquisa, rastreamento, segundo pavimento jogável e mapa completo continuam pendentes.


