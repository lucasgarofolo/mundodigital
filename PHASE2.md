# Fase 2 — Check-in e entrada no telão

Registro histórico. A [Fase 3](PHASE3.md) passa a persistir a foto normalizada privadamente, restaura o mundo pela API e usa Socket.IO para eventos incrementais. Consulte esse documento para o comportamento atual.

## Estado da entrega

O fluxo completo está disponível em **modo local de desenvolvimento**, sem consumo de API: nome, e-mail e selfie → validação → avatar genérico provisório → SQLite → entrada pela porta em dois ou mais telões via Socket.IO.

**A geração real de avatar por IA ainda depende da escolha do provedor.** Nenhum provedor estava configurado no projeto e nenhuma chamada paga foi realizada. O módulo `lib/avatarGenerator.js` recebe uma selfie normalizada e devolve `{ buffer, kind }`; seu gerador local não analisa aparência nem reconhece rostos. A selfie é obrigatória para validar o fluxo, mas não é utilizada para personalizar esse placeholder.

As opções apresentadas foram [OpenAI — edição de imagens por referência](https://developers.openai.com/api/docs/guides/image-generation) e [Gemini — geração/edição de imagens](https://ai.google.dev/gemini-api/docs/image-generation). Após a decisão, a integração deve ser implementada nesse módulo com credencial exclusivamente no servidor e autorização para consumo da API. Atualmente `AVATAR_PROVIDER` aceita somente `local`; outro valor provoca um erro explícito ao iniciar, em vez de simular IA.

## Executar

Requer **Node.js 24 ou superior**, usando SQLite integrado ao Node.

```sh
npm install
npm start
```

- Telão real: http://localhost:3000/tela — inicialmente vazio, recebe somente participantes salvos.
- Celular: http://localhost:3000/check-in.
- Demonstração anterior: http://localhost:3000/tela?demo=1 — oito personagens fictícios, sem conexão com participantes reais.
- `/` continua redirecionando para `/tela`.

No PowerShell com scripts bloqueados, use `npm.cmd`. Para configurar, copie `.env.example` para `.env`; Node carrega esse arquivo no início de `npm start`.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP e Socket.IO |
| `AVATAR_PROVIDER` | `local` | Geração provisória sem serviço externo |
| `DATA_DIR` | `data` na raiz do projeto | Pasta privada de SQLite e avatares |

Não são necessárias chaves para testar localmente. Chaves de provedor ainda não são utilizadas nem expostas por esta versão.

## Acesso pelo celular na mesma rede

1. Execute o servidor no computador do telão.
2. Conecte computador e celular à mesma rede Wi-Fi.
3. No computador, execute `ipconfig` e identifique o IPv4 do adaptador conectado.
4. No celular, abra `http://IP_DO_COMPUTADOR:3000/check-in`.
5. No telão, abra `http://IP_DO_COMPUTADOR:3000/tela` ou `http://localhost:3000/tela`.

O servidor escuta em `0.0.0.0`. Se a conexão não chegar, confira a permissão de entrada da porta 3000 no firewall e o isolamento de dispositivos no Wi-Fi. Não foi alterado o firewall automaticamente. A captura usa o seletor nativo de arquivo com `capture="user"`; a disponibilidade da câmera depende do navegador/telefone. O teste automatizado simulou a tela de celular e o upload, sem operar uma câmera física.

## Fluxo e privacidade dos dados

`/check-in` permite tirar/selecionar a foto, ver a prévia, enviar os dados e acompanhar a criação. Após salvar, confirma a entrada quando um telão real acusa o carregamento do avatar e a caminhada de entrada termina. Sem telão conectado, informa que o avatar está salvo e oferece verificar novamente; não afirma que houve exibição.

O servidor normaliza o e-mail em minúsculas e valida seu formato. **Não confirma titularidade e não envia e-mail de verificação.** O e-mail tem índice único no SQLite. Um novo envio com o mesmo e-mail retorna o participante existente, sem substituir seu nome ou avatar. Requisições concorrentes desse e-mail compartilham a geração em andamento. Uma falha não reserva permanentemente o e-mail; o usuário pode reenviar a foto.

A selfie deve ser JPEG, PNG ou WebP, com até **5 MB**, até **20 megapixels**, pelo menos 32×32 e sem múltiplos frames. MIME e conteúdo são verificados no servidor; imagens corrompidas são recusadas. Há limite de quatro uploads/processamentos simultâneos. HEIC, SVG e GIF não são aceitos.

A selfie fica somente em memória. É decodificada, orientada e normalizada para até 512×512, removendo metadados. Os buffers acessíveis do original e da versão normalizada são zerados no encerramento da solicitação, inclusive em duplicação/falha. Nenhuma selfie é gravada em disco ou disponibilizada em rota pública. No navegador, a prévia usa URL de objeto, revogada após sucesso/troca de foto/saída da página.

Somente o PNG gerado é publicado por `/avatars/<uuid>.png`; os arquivos são normalizados para 64×96 e não carregam metadados da selfie. E-mail, selfie e detalhes internos da simulação não aparecem em respostas de participantes ou mensagens Socket.IO. O banco e a pasta de dados não são servidos por `express.static`.

## Persistência, movimento e ciclos

- Banco: `data/participants.sqlite`, tabelas `participants` e `cycles`.
- Avatares gerados: `data/avatars/*.png`.
- Metadados privados: e-mail, nome, avatar, criação e ciclo.
- Simulação persistida: pavimento, sala, posição lógica, estado, velocidade, destino, rota e pausas.
- API pública: ID, nome, avatar, tipo do avatar, pavimento, sala, posição, estado, criação e ciclo — sem e-mail.

A movimentação existente foi extraída para `public/js/movement.js`, sem dependência de Phaser, e reutilizada tanto pelo modo demo como pelo servidor. Não foi substituída por outra navegação. O servidor é a autoridade para participantes reais, avança a simulação a cada 100 ms e transmite snapshots; o cliente interpola as posições. Dois telões não escolhem destinos diferentes para o mesmo participante.

Os dados de entrada ficam em `WORLD.floors.ground_floor.entry`, em `world-config.js`: início, offsets e caminho até `porta_sala5`. O avatar caminha por uma pequena faixa de entrada do corredor já desenhado, atravessa a abertura existente e passa ao grafo interno. Isso não habilita o corredor para exploração nem altera os portais futuros. O mapa, seus móveis e o controlador da Fase 1.6 foram preservados.

Cada conexão/reconexão recebe o estado completo atual. IDs e carregamentos pendentes evitam criação duplicada de sprites. Em uma reconexão, posições existentes são realinhadas ao snapshot do servidor, evitando interpolar grandes distâncias através dos móveis. O HUD atualiza a contagem e distingue demonstração de modo real; no modo local, o telão também identifica os avatares provisórios.

A simulação é salva a cada segundo e ao encerrar com SIGINT/SIGTERM. Em uma queda abrupta, a posição pode retornar ao último checkpoint (aproximadamente um segundo); os participantes e seus avatares já concluídos continuam salvos. Reabrir o telão não repete a caminhada de entrada de quem já está dentro.

Os ciclos são intervalos globais de 15 minutos, ancorados no relógio do servidor em múltiplos de 900.000 ms desde a época Unix. `cycleAt` calcula ID, início e fim; as definições são persistidas no SQLite. O ciclo do participante é atribuído **após gerar o avatar**, imediatamente antes de salvar. Recarregar/reiniciar não altera um ciclo já atribuído. A saída automática ainda está desativada: os avatares permanecem na Sala 5, inclusive após o fim do ciclo.

## Arquivos

Criados:

- `lib/store.js`: SQLite, ciclos, unicidade e checkpoints.
- `lib/avatarGenerator.js`: validação de foto e contrato do gerador; placeholder local.
- `public/check-in.html`, `public/css/check-in.css`, `public/js/check-in.js`: experiência mobile.
- `public/js/movement.js`: movimentação compartilhada extraída da Fase 1.5.
- `public/js/participantsClient.js`: sincronização, carregamento de texturas e recuperação.
- `.env.example`: configuração local sem segredos.
- `tests/checkin.test.js` e `tests/browser/checkin.spec.js`: API, persistência, ciclo e fluxo em dois telões.
- `PHASE2.md`: este documento.

Modificados:

- `server.js`: aplicação HTTP/Socket.IO, upload, API, simulação e encerramento.
- `package.json` / `package-lock.json`: Socket.IO, Multer, Sharp, Node 24 e testes.
- `public/js/game.js`, `characters.js`: modo demo/real e integração da movimentação compartilhada.
- `public/js/world-config.js`: somente dados da caminhada de entrada.
- `public/tela.html`: contagem inicial e identificação do modo.
- `playwright.config.js`: servidor isolado de testes na porta 3010, dados em `.test-data`.
- `tests/world.test.js`, `tests/browser/world.spec.js`, `tests/browser/camera.spec.js`: adaptação para servidor e modo demo explícito.
- `.gitignore`, `README.md`: dados privados e instruções.

Preservados: desenho do mapa em `world.js`, `cameraController.js`, estilos do telão, referências arquitetônicas, pontos de visita e conexões internas existentes.

## Testes e limitações

```sh
npm test
npm run test:browser
```

Os testes não usam selfies de pessoas nem serviços de IA: as imagens são fixtures sintéticas e os avatares são placeholders locais. Os dados ficam em `.test-data`, separados de `data` e ignorados pelo Git.

Validação em 10/10/2026: `npm install` concluiu com 108 pacotes auditados, sem vulnerabilidades reportadas; `npm start` iniciou o modo local na porta 3000. As rotas `/` (302), `/tela`, `/check-in` e `/api/config` (200) foram verificadas. Os oito testes Node passaram, incluindo upload inválido/excessivo, concorrência, falha/retry, reinicialização do servidor, persistência de posição, dados privados, virada de ciclo e circulação pela porta.

A execução final de `npm run test:browser` concluiu normalmente: **3 testes passaram em 2,7 minutos**. Foram verificados zoom suave, atalhos, limites, HUD fixo, resize, check-in em viewport mobile, entrada em dois telões, reconexão, recarga e deduplicação. A circulação demo permaneceu estável por dois minutos, com 104 visitas aos pontos de navegação. Os cenários não registraram erros recorrentes de console ou de execução da aplicação. As capturas do formulário mobile e do telão foram inspecionadas visualmente.

Ocorrências corrigidas: a entrega dos PNGs falhou inicialmente no diretório de testes iniciado por ponto; a rota passou a servir somente o nome validado com `root` privado explícito. A verificação da faixa de entrada foi ajustada para os offsets definidos nos dados. No ambiente Windows, o encerramento automático do servidor do executor ficou pendente após aprovar os cenários; a execução final usa uma instância de teste explicitamente iniciada na porta 3010, reaproveitada pelo Playwright. Se esse encerramento ficar pendente na sua máquina, inicie um servidor de teste separado com `PORT=3010`, `DATA_DIR=.test-data/manual` e `AVATAR_PROVIDER=local` antes do comando de navegador.

O Node 24.13 instalado emite `ExperimentalWarning` para seu módulo SQLite; o executor também avisa sobre `NO_COLOR`/`FORCE_COLOR`. Esses avisos não são erros de JavaScript da aplicação. Nenhum teste chamou OpenAI, Gemini ou outro provedor externo.

Nesta versão não há autenticação nem comprovação da titularidade do e-mail; a experiência deve ser validada na rede do evento antes de ser disponibilizada publicamente. O gerador local não personaliza o avatar a partir da selfie. A integração real de IA, avaliação visual de seus resultados e consumo autorizado ainda estão pendentes. O fluxo de câmera física e acesso pela rede devem ser conferidos no celular que será usado no evento.

Não foram implementados saída dos grupos, corredor explorável, segundo pavimento, busca, rastreamento, integração Forms/RA ou mapa completo. Com mais participantes na sala, podem ocorrer sobreposições; a saída dos ciclos será a próxima fase, não foi simulada apagando personagens.
