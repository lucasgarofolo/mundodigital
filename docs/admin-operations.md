# Fase 9B — Central de operação

`/admin` é a central autenticada do Mundo // Digital. Reutiliza sessão, usuários, Argon2id, cookie, CSRF e revogação da Fase 9A. Não existe login adicional. Reinicie `npm start` e entre com uma conta administrativa existente; nenhuma nova variável, dependência ou migration é necessária.

## Dashboard e consultas

O topo exibe PARTICIPANTES, ACTIVE, PROCESSING, FAILED, PASS_READY, ENTRY_SCHEDULED e ENTERING. `lib/adminQueries.js` executa uma consulta SQL agregada, sem carregar participantes completos para contá-los no navegador.

São projeções operacionais dos estados existentes:

| Contador | Regra |
| --- | --- |
| PARTICIPANTES | Todos os cadastros, inclusive os removidos do mundo (`INACTIVE`). |
| ACTIVE / ENTERING | Estado real da experiência em cadastro ainda ativo. |
| ENTRY_SCHEDULED | `AVATAR_APPROVED`, usado pelo agendador existente. |
| PASS_READY | `AVATAR_REVIEW`, LPC READY/FALLBACK e portrait resolvido ou prazo de apresentação expirado, conforme a credencial existente. |
| PROCESSING | LPC pendente, portrait solicitado/pendente/processando ou Story pendente/processando depois da aprovação. |
| FAILED | Falha de portrait/Story ou fallback de análise LPC quando a personalização está habilitada. O LPC padrão do provider `local` não é contado como falha. |

Os contadores de experiência e assets podem se sobrepor: alguém ACTIVE pode ter portrait FAILED. Eles não devem ser somados para calcular o total. Nenhum estado novo foi persistido para o dashboard.

A busca aceita nome parcial, diferenças de caixa e acentos pelo `senai_fold` existente, além de UUID completo/parcial. Os filtros são TODOS, ACTIVE, PROCESSING, FAILED, PASS_READY, PORTRAIT FAILED e LPC FAILED. A UI usa 25 registros por página; a API aceita 25 ou 50. São duas consultas limitadas para a listagem: total filtrado e página ordenada. Não há lista ilimitada.

## Serviços e TV

Server informa disponibilidade desta resposta e uptime. Banco executa a própria consulta de resumo; falha não é apresentada como contadores zerados. Socket.IO informa conexões autenticadas. A TV é ONLINE somente quando há sockets do mundo na sala `live`; clientes `admin` e `operator` não contam como TV. Ao desconectar a última TV, o painel recebe atualização OFFLINE.

OpenRouter e Cloudflare usam presença de configuração e observações das chamadas reais: última tentativa, último sucesso, último erro seguro e latência. Sem chamada observada, CONFIGURADO não promete que a API externa está saudável; provider LPC diferente de OpenRouter aparece INATIVO. Um erro recente gera WARNING; um sucesso posterior retorna a OK. Códigos HTTP disponíveis aparecem junto ao erro. Nenhum healthcheck gera imagem ou chamada paga.

Quando `usage.cost` já está disponível no log OpenRouter, são mostrados último custo e soma desta execução. Esses valores não são gravados no banco. LPC, portrait, Story e entradas agendadas exibem suas filas existentes; as concorrências não foram ampliadas.

Selfie Cleanup mostra consumidores ativos e falhas de remoção. A tabela/detalhe apresenta somente o estado da selfie: PROCESSANDO, REMOVIDA, DELETE_FAILED ou disponibilidade operacional. Nunca há thumbnail, caminho, Base64, download ou botão para ver a selfie. Se os consumidores terminaram, não há lease/job ativo e a referência ainda existe mais de dois minutos após a conclusão, aparece **Selfie aguardando cleanup**. Consultar o painel não apaga arquivos.

## Participantes e detalhe lateral

A tabela apresenta nome, status, LPC, portrait, selfie temporária, localização, entrada e ações. O UUID identifica todas as operações; nomes iguais continuam independentes.

VER abre um drawer sem sair da página. Mostra UUID curto, número do passe, estados reais da experiência/LPC/portrait/Story/selfie, bloco/área, check-in, aprovação, agendamento, entrada, tentativas e último erro observado com serviço e horário. Pode mostrar somente os assets gerados: LPC, portrait e Story, além do link do passe. Não projeta e-mail, reviewToken, appearance, foto ou caminho privado.

As permissões e os motivos dos botões desabilitados vêm do backend. Cada POST valida novamente estado, role, UUID, payload e disponibilidade. Atualizar a página faz apenas leituras.

## Ações e recuperação

| Ação | Integração e limites |
| --- | --- |
| LOCALIZAR NA TV | Chama `operatorControl.focus(uuid)` existente. Mantém o mesmo foco por UUID, inclusive entre blocos; nenhuma nova câmera. |
| IR PARA SALA DE ACESSO | Chama o HOME existente, inclusive pelo botão global no topo. |
| REPROCESSAR AVATAR | Somente fallback de análise, personalização habilitada, selfie disponível, sem job em curso e com orçamento original restante. Usa `store.retryAvatar()` e `avatarPipeline.enqueue()`. READY é preservado; não é uma variação local nem uma nova chamada direta à API. |
| REPROCESSAR PORTRAIT | Somente FAILED, solicitação já existente, selfie disponível, sem job em curso e com orçamento original restante. Usa `passService.retry()`. |
| REGERAR STORY | Invalida estado/hash do Story e enfileira o renderer existente. Usa LPC, portrait e dados já disponíveis; não precisa da selfie e não chama nenhuma IA. Requer assets e aprovação/entrada compatíveis com o passe. |
| FORÇAR ENTRADA | Somente PASS_READY com passe. Usa a mesma função de aprovação, agendador, caminhada de entrada e transição ACTIVE do fluxo normal. Não insere sprite diretamente. |
| CANCELAR ENTRADA | Implementado com confirmação, somente em `AVATAR_APPROVED`/ENTRY_SCHEDULED. Cancela o timer por UUID e retorna a `AVATAR_REVIEW`; conserva horário histórico da aprovação. Não cancela entrada que já começou. |
| REMOVER DO MUNDO | Com confirmação, para ENTERING/ACTIVE com avatar presente. Marca o status existente INACTIVE, preservando cadastro, UUID, histórico, passe e assets. |
| EXCLUIR CADASTRO | Com confirmação, exclui permanentemente um cadastro que ainda não iniciou a entrada, incluindo PASS_READY. Remove o registro do banco, a eventual selfie, o LPC e suas versões, portrait e Story daquele UUID. Libera o e-mail para outro check-in. Entrada agendada é cancelada; ENTERING/ACTIVE e quem já entrou não podem ser apagados por esta ação. |
| TENTAR REMOVER NOVAMENTE | Somente DELETE_FAILED com todos os consumidores terminados e sem job/lease ativo. Chama o serviço existente de cleanup, sem IA. |

Após a exclusão da selfie, as duas ações de IA ficam desabilitadas e o backend as recusa, com mensagem sobre necessidade de nova foto. Não há backup oculto, restauração ou upload administrativo. A recuperação manual mantém o limite original de duas tentativas persistidas e as mesmas regras de retry, timeout, AbortSignal e fila. Pode não existir oportunidade de retry se os dois consumidores já terminaram e o cleanup apagou a imagem — isso é intencional.

Antes de enfileirar recuperação que depende de foto, uma lease impede corrida com a exclusão; o arquivo privado é verificado e o estado é relido após a operação assíncrona. A lease temporária é sempre liberada. Nenhuma chamada OpenRouter/Cloudflare fica dentro da rota administrativa.

Na remoção do mundo, o servidor libera visita/slot e interação social pela lógica existente, cancela agendamento e LPC pendente, remove o walker e suas referências, encerra foco se necessário e emite `participant:removed`. O cliente reutiliza a remoção de personagem que já limpa efeitos, emotes e recursos. Um portrait já em processamento pode terminar sob a lease existente, preservando o asset e a selfie enquanto necessário; trabalho ainda não iniciado é encerrado. Um restart também encerra o consumidor portrait interrompido de cadastro INACTIVE sem iniciar outra IA, permitindo cleanup seguro. O passe sinaliza a remoção e continua disponível com os assets gerados.

`PASS_READY` é um passe aguardando confirmação de entrada, não uma falha: o visitante precisa usar ENTRAR, ou o operador pode usar FORÇAR ENTRADA. Para tentativas abandonadas, abra **VER → EXCLUIR CADASTRO**. Essa exclusão é diferente de REMOVER DO MUNDO e invalida o passe antigo.

`lib/participantDeletion.js` encerra atomicamente o cadastro antes de cancelar agendamentos e trabalhos daquele UUID, impedindo novas aprovações/retries. Aguarda os jobs, a composição local e todas as leases reais da selfie, inclusive chamadas que demorem a obedecer ao cancelamento. Só então limpa os arquivos privados/gerados e apaga o registro. Se o processamento não encerrar em dez segundos, mantém o cadastro inativo e o arquivo necessário, informa que é preciso aguardar e permite repetir EXCLUIR CADASTRO. Se houver falha de disco, o registro também permanece para uma nova tentativa; erros internos e caminhos não são expostos. Um restart não retoma IA para esse cadastro inativo. A limpeza global não inicia enquanto houver exclusões individuais; o encerramento do servidor aguarda as operações em curso. A ação reutiliza sessão, role admin, CSRF e requestId, com auditoria `DELETE_PARTICIPANT`; não altera schema, mundo, câmera nem provedores de IA.

Validação da exclusão em 05/11/2026: 190/190 testes Node aprovados e 3/3 testes do painel no Chrome aprovados. A suíte Node foi executada com `STORY_BROWSER_CHANNEL=chrome` somente no processo de teste: esta máquina possui Chrome, mas não Chromium. A configuração de produção permanece independente. Os cenários novos cobrem confirmação, sessão/CSRF, idempotência, liberação do e-mail, preservação de outros participantes, cancelamento de agendamento, jobs LPC/portrait/Story, leases após abort, composição em andamento, falha de disco e repetição após timeout. Os testes usam imagens sintéticas e mocks de IA; nenhum cadastro real foi excluído. Logs locais em `.test-data/admin-deletion-regression-chrome.log` e `.test-data/admin-deletion-browser.log`.

## Tempo real, feedback e idempotência

O modo Socket.IO `admin` usa a sessão administrativa da Fase 9A e recebe `admin:updated`, com revisão e até 50 UUIDs afetados. Não transmite fotos, detalhes completos ou listas de participantes. Mudanças são agrupadas por 500 ms. O navegador consulta novamente resumo/página visível/detalhe; uma consulta de segurança a cada cinco segundos, enquanto visível, cobre perda de conexão. Não há mutação ou retry provocado por F5.

Botões mostram PROCESSANDO e ficam desabilitados durante a operação. O frontend evita cliques simultâneos e usa diálogo próprio para remoção, cancelamento e desativação de administrador. A API exige `requestId` UUID por ação: repetições com a mesma chave/administrador/ação compartilham o resultado por cinco minutos. Uma chave reutilizada para outro alvo é rejeitada. O cache é limitado a 256 itens e é efêmero; a checagem de estado, reservas e deduplicação das filas continuam sendo a defesa principal, inclusive após restart.

## Atividade e auditoria

`lib/operationEvents.js` mantém os últimos 50 eventos desta execução: check-in, entrada agendada/iniciada/ativa, LPC pronto/fallback, portrait, Story, exclusão de selfie e ações administrativas. Exibe horário, nome quando resolvido sem ambiguidade, código seguro e administrador da ação. Prefixos de UUID ambíguos não são atribuídos a outro participante.

O último erro por participante e as observações dos serviços são efêmeros e limitados. Não há novo subsistema de auditoria nem tabela financeira. Os logs administrativos existentes recebem timestamp, adminId/username, UUID e ação, por exemplo:

```text
[Mundo // Digital] admin:action {"timestamp":"2026-11-03T18:30:00.000Z","adminId":"<id>","username":"operacao","participantUuid":"<uuid>","action":"REGENERATE_STORY"}
```

Não são registrados selfie, Base64, conteúdo de prompt, tokens, hash de senha ou e-mail. Códigos são permitidos explicitamente; mensagem arbitrária de erro externo não vai para o painel.

## Administradores e segurança

A seção de contas reutiliza o backend da Fase 9A para listar username, role, active e último login; criar administrador; desativar com confirmação; redefinir senha de outro administrador; trocar a própria senha com senha atual e confirmação; e sair. A última conta ativa permanece protegida no backend. Desativação, troca/reset de senha e logout invalidam as sessões correspondentes e desconectam sockets. Não há papel novo ou RBAC complexo.

Todas as rotas abaixo exigem sessão válida e role admin. POST também exige token CSRF e Origin conforme a Fase 9A. APIs respondem 401/403 em vez de HTML; o frontend retorna a `/login` quando a sessão expira. A sala Socket.IO administrativa exige a mesma sessão, valida autorização e encerra conexões revogadas/expiradas.

| Método | Rota nova |
| --- | --- |
| GET | `/api/admin/operations` |
| GET | `/api/admin/participants?q=&filter=&page=&limit=` |
| GET | `/api/admin/participants/:uuid` |
| POST | `/api/admin/participants/:uuid/actions/:action` |
| POST | `/api/admin/camera/home` |

Exemplo de payload: `{ "requestId": "<uuid>", "confirm": true }`. `confirm` é obrigatório para remover/cancelar/excluir; campos extras são recusados. A exclusão usa `POST /api/admin/participants/:uuid/actions/delete-registration`. As APIs de contas continuam sendo as já documentadas em [authentication.md](authentication.md). O check-in e o passe público não receberam acesso às ações administrativas.

## Arquivos

Criados:

- `lib/adminOperations.js`: rotas, projeções, permissões, ações e sinalização administrativa.
- `lib/adminQueries.js`: consultas de resumo/busca/paginação e operações atômicas de cancelamento/remoção.
- `lib/operationEvents.js`: observações seguras e atividade efêmera.
- `public/css/admin.css`: layout do painel, tabela, drawer, feedback e responsividade.
- `public/js/adminOperations.js`: interface operacional e atualização de leituras.
- `public/js/adminFeedback.js`: toast e confirmação próprios.
- `tests/admin-operations.test.js`: integração administrativa isolada, com mocks de IA.
- `tests/browser/admin-operations.spec.js`: operação no Chrome, desktop/mobile e TV real por Socket.IO.
- `docs/admin-operations.md`: este guia e relatório.

Modificados:

- `server.js`: conecta observabilidade, ações, aprovação compartilhada e remoção segura.
- `lib/store.js`: disponibiliza as consultas administrativas; sem alteração de schema.
- `lib/auth.js`: autoriza modo Socket.IO admin com a mesma sessão/role.
- `lib/entryScheduler.js`: cancelamento por UUID e evento de agendamento.
- `lib/avatarPipeline.js`: cancelamento por UUID, preservando fila/retry/leases.
- `lib/passService.js`: leitura das filas, regeneração pelo renderer existente e encerramento de consumidor removido.
- `lib/selfieLifecycle.js`: inspeção operacional somente leitura.
- `lib/passRoutes.js`: sinaliza INACTIVE e impede retry de removido no passe.
- `public/admin.html`: central e formulários administrativos existentes.
- `public/js/admin.js`: dados de contas, confirmação e loading.
- `public/js/auth.js`: redirecionamento seguro ao expirar sessão e tratamento da própria troca de senha.
- `public/js/participantsClient.js`: recebe remoção e reutiliza cleanup visual existente.
- `public/js/pass.js`: preserva passe/download e comunica remoção do mundo.
- `tests/auth.test.js`: inclui handshake anônimo no modo admin.
- `tests/browser/auth.spec.js`: confirma desativação no diálogo próprio.
- `package.json`: inclui teste Node novo sem remover os existentes.
- `README.md` e `docs/authentication.md`: acesso e referências da Fase 9B.

## Validação e limites

Os testes usam bancos isolados em `.test-data`, imagens sintéticas e mocks. Nenhuma chamada paga nem selfie de visitante real foi usada. A suíte administrativa verifica contadores/filtros/paginação/busca com acentos, acesso e CSRF, idempotência, força/cancelamento/remoção, foco/HOME, TV ONLINE/OFFLINE, recuperação LPC/portrait com foto disponível, bloqueio após DELETED, retry de DELETE_FAILED, warning sem mutação em leituras, Story sem IA, independência dos provedores, lease durante remoção e cleanup após restart de removido.

O Chrome valida lista, drawer, localização real da câmera por UUID, HOME, remoção do sprite/foco, preservação do passe, duplo clique, F5 somente leitura e tela de 390 px sem overflow horizontal da página. A tabela mantém sua própria rolagem para operação básica mobile. As regressões incluem contas/sessões, check-in, credencial, privacidade, LPC, câmera, mundo, visitas e interações sociais, com cenários de 10/50/100 participantes.

Resultados executados em 03/11/2026:

| Verificação | Resultado |
| --- | --- |
| `npm.cmd test` | 177/177 aprovados; zero falhas, cerca de 78 segundos. |
| Suíte administrativa após revisão final das ações | 12/12 aprovados, incluindo rejeição de ações desconhecidas, recuperação e privacidade. |
| Regressão completa Chrome | 36/37 aprovados inicialmente; um clique da troca de senha foi interceptado por um gerenciador de senhas externo. |
| Reteste final Chrome de admin + autenticação | 4/4 aprovados após dispensar a sobreposição com Tab antes do clique real. Todos os 37 cenários distintos da regressão foram validados entre a execução completa e o reteste. |
| Revisão visual | Capturas desktop 1440×1000, drawer e mobile 390×844 inspecionadas; sem erros de página nos cenários administrativos. |
| Integridade | SHA-256 preservado de catálogo, builder LPC, analisadores OpenRouter/Cloudflare, movimento, navegação, comportamentos visual/social e câmera. |

Na amostra de mundo macro com 100 participantes distribuídos nos cinco blocos, o Chrome mediu 142 FPS com 20 sprites visíveis; no cenário de visitas com 100 participantes, 144 FPS com 21 visíveis. São amostras curtas da máquina de desenvolvimento, com renderização limitada ao bloco exibido; não constituem benchmark do equipamento do evento. A central não adiciona trabalho social por frame nem carrega todas as linhas no navegador.

Logs locais: `.test-data/phase9b-final-regression.log`, `.test-data/phase9b-final-admin.log`, `.test-data/phase9b-browser.log` e `.test-data/phase9b-browser-final.log`. Capturas em `test-results/admin-operations-desktop.png`, `admin-participant-detail.png` e `admin-operations-mobile.png`. Esses diretórios continuam ignorados pelo Git.

Limites operacionais: observações e idempotência vivem somente nesta execução; não há histórico de métricas ou auditoria persistida nova. Os status externos não são sondagens de disponibilidade. Um terminal que já perdeu a selfie não pode ser recuperado por nova IA sem uma nova captura futura. Não há upload de selfie pelo admin, edição de appearance, exportação ou painel financeiro. A arquitetura continua usando uma instância do servidor/SQLite e as filas existentes. Exclusão permanente de cadastro está limitada a quem ainda não iniciou a entrada.

Nenhum pipeline paralelo foi criado. Universal LPC, catálogo, compositor, assets, analisador OpenRouter e geração Cloudflare não foram alterados. Mundo, pathfinding, câmera e tracking foram preservados. A política de selfie temporária continua obrigatória, inclusive em recuperação, remoção e restart. Esta entrega termina na Fase 9B.
