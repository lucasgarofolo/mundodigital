# Fase 5 — crachá como credencial de entrada

Esta atualização substitui a aprovação em uma tela separada. O check-in salva a selfie privada e inicia duas filas independentes: análise/composição LPC existente e portrait Cloudflare existente. O celular abre diretamente `/pass/:uuid`, mostrando processamento e depois o próprio crachá. O único CTA inicial do dono é **ENTRAR NO MUNDO // DIGITAL**.

## Fluxo e estados

Não foi criada outra máquina persistida nem uma nova migração. Os estados existentes continuam sendo a fonte de verdade:

| Estado da experiência no crachá | Estado interno / condição |
| --- | --- |
| `ASSETS_PROCESSING` | `AVATAR_PROCESSING`, ou LPC pronto aguardando portrait dentro do limite de apresentação |
| `PASS_READY` | `AVATAR_REVIEW`, LPC `READY` ou `FALLBACK`, e portrait pronto, falho ou com espera de apresentação encerrada |
| `ENTRY_SCHEDULED` | `AVATAR_APPROVED`, após o clique no crachá |
| `ENTERING` | Caminhada de entrada em andamento |
| `ACTIVE` | Personagem já circulando |

Esses nomes novos são derivados na resposta pública do passe; não duplicam os campos SQLite. Só `ENTERING` e `ACTIVE` entram na API do mundo e no Phaser. Nem receber o número do passe, nem gerar o portrait, nem abrir o crachá aprova a entrada.

## Preparação paralela

`server.js` solicita o portrait depois de salvar o participante e sua foto, sem esperar pela análise LPC. A solicitação persistida continua única por UUID. O LPC usa os mesmos analisadores, catálogo, compositor, PNG e spritesheet anteriores. A Cloudflare usa o mesmo serviço, modelo, prompt e multipart implementados na etapa anterior.

O portrait pode terminar primeiro; nesse caso, o celular continua mostrando processamento até o LPC ficar tecnicamente pronto. Uma falha de análise mantém o fallback LPC existente. Uma falha no portrait libera o crachá com placeholder, sem exibir a selfie original.

```dotenv
PASS_PORTRAIT_WAIT_MS=15000
WORLD_ENTRY_DELAY_MS=8000
```

O primeiro valor é o limite de apresentação enquanto se aguarda o portrait, medido desde a solicitação persistida. Depois de 15 segundos, um LPC já pronto permite apresentar o crachá com placeholder. Se o LPC levou mais tempo, não existe uma nova espera adicional de 15 segundos. A geração do portrait continua em paralelo, e a página atualiza automaticamente quando terminar. Valores de 0 a 60000 ms são aceitos; valor inválido usa 15000.

Essa espera é uma decisão de apresentação: o endpoint de entrada exige o LPC pronto no estado `AVATAR_REVIEW`, mas não faz da resposta Cloudflare uma condição de aprovação. Assim, mesmo uma falha de apresentação não pode bloquear a entrada por causa do portrait. As regras de estado, token e idempotência continuam sendo validadas no servidor.

## Aprovação pelo próprio crachá

`public/js/check-in.js` mantém captura de câmera, upload e sessão, e faz um único redirecionamento para o passe. Não contém mais prévia isolada, pergunta “Está parecido com você?”, botão de aprovação ou regeneração nessa tela. O HTML correspondente também foi removido. O backend de variação LPC anterior permanece disponível, sem alterações na geração, mas não faz parte da nova interface de entrada.

`public/js/pass.js` mostra portrait e o mesmo LPC que será usado no mundo. O clique em **ENTRAR NO MUNDO // DIGITAL**:

1. Desabilita imediatamente o botão e impede outro envio simultâneo pela interface.
2. Chama o endpoint protegido `POST /api/participants/:uuid/approve-avatar`, reutilizado como comando de entrada.
3. O backend valida a preparação do LPC e grava aprovação/horário apenas uma vez.
4. O agendador existente mantém o atraso de oito segundos e o espaçamento entre entradas.
5. Na mesma página, aparecem **Olhe para a TV 👀**, **BAIXAR MEU CRACHÁ** e **COMPARTILHAR**.

Não há contagem regressiva nem clique extra. Repetir a chamada retorna o mesmo agendamento; não reinicia o prazo nem duplica eventos ou personagens. Fechar o celular após a confirmação não cancela a entrada. Posição inicial, porta, destaque do nome, escala, animações e circulação da Sala 5 não foram modificados.

## Story, download e compartilhamento

O Story só é preparado após a solicitação de entrada, com os assets disponíveis. Se o portrait estiver pendente ou falhar, pode usar o mesmo placeholder do crachá e o LPC pronto, permitindo guardar a credencial sem bloquear o visitante. Quando o portrait chegar, o hash muda e o Story é refeito localmente. Não se faz outra chamada Cloudflare nem outra composição LPC.

O PNG continua tendo 1080×1920, gerado pelo mesmo HTML/CSS e Playwright. Campos de controle da entrada não fazem parte do hash da imagem: `ENTRY_SCHEDULED` → `ENTERING` → `ACTIVE` não gera novos PNGs. `PENDING` → `PROCESSING` do portrait também não invalida uma imagem visualmente idêntica. Nome, campos opcionais, portrait e configuração visual relevante continuam invalidando o cache quando mudam.

Antes do clique, os botões de compartilhar/baixar ficam ocultos, a resposta pública não entrega `storyUrl` e a rota do PNG bloqueia acesso sem entrada confirmada. Depois do clique, os botões aparecem e ficam habilitados quando o arquivo estiver pronto. O arquivo é pré-carregado antes do clique em compartilhar para preservar a ativação do usuário no navegador.

**BAIXAR MEU CRACHÁ** baixa o Story PNG. **COMPARTILHAR** verifica `navigator.canShare` e chama `navigator.share` com esse arquivo quando suportado; caso contrário, baixa o PNG. Cancelar o menu nativo não força download. Não há publicação automática ou integração privada com Instagram.

## Refresh, restart e compatibilidade

O passe consulta seu estado uma vez por segundo durante processamento, entrada e geração de imagens. Refresh recupera a etapa atual a partir do backend:

- Processamento: mensagem de preparação, sem botão de entrada prematuro.
- Crachá pronto: cartão e CTA de entrada.
- Entrada agendada/em andamento: “Olhe para a TV”, download e compartilhar.
- Ativo: “Você já está no Mundo // Digital”, mantendo as opções do crachá.

`/check-in` com sessão existente retorna ao mesmo passe. Sessão é guardada em `localStorage` e `sessionStorage` como alternativa. `/check-in?new=1` inicia outro formulário sem excluir participantes do banco. Para registros antigos sem passe, o comando protegido `prepare-pass` provisiona a credencial uma única vez usando a selfie privada existente; GETs públicos não iniciam gerações.

`scheduled_entry_at`, portrait e Story continuam persistidos. O restart recupera entradas e tarefas interrompidas dentro dos limites anteriores; portraits prontos não são reenviados à IA. Não há reconstrução de LPC no refresh, no crachá ou na exportação.

## Privacidade e escopo

O formulário informa antes do envio que o portrait usa um serviço externo. Nome/campos destinados ao crachá e assets gerados continuam públicos no passe; e-mail, selfie, token, caminhos privados e dados administrativos continuam protegidos. Função, instituição e tags só usam os valores informados/configurados, sem inferência de personalidade.

Nenhum arquivo do Universal LPC, Phaser, câmera, mapa ou movimento foi alterado. Não houve nova IA, avatar, QR Code, expansão da escola ou outra funcionalidade futura.

## Arquivos e validação

Criados: `docs/credential-flow.md`, `tests/credential-flow.test.js`, `tests/helpers/storyRenderer.js`, `tests/helpers/captureCheckin.js`.

Modificados: `server.js`, `lib/store.js`, `lib/passView.js`, `lib/passService.js`, `lib/passRoutes.js`, `public/check-in.html`, `public/js/check-in.js`, `public/pass.html`, `public/js/pass.js`, `public/css/pass.css`, `.env.example`, `.env` (nova configuração de espera somente), `package.json`, `playwright.config.js`, `README.md`, `docs/portrait-pass.md`, `docs/avatar-experience.md`, `tests/avatar-experience.test.js`, `tests/portrait-pass.test.js`, `tests/browser/avatar-experience.spec.js`, `tests/browser/avatar-pipeline.spec.js`, `tests/browser/checkin.spec.js`, `tests/browser/pass.spec.js`, `tests/browser/selfie-camera.spec.js`.

Os testes verificam os dois assets em paralelo, portrait terminando antes do LPC, portrait lento, fallback, crachá antes da entrada, ocultação de compartilhamento antes do clique, duplo clique, espera real de oito segundos com celular fechado, entrada pela porta, recuperação de todas as etapas, exportação provisória/final e estabilidade do LPC. A captura HTTP dos testes foi adaptada ao redirecionamento imediato do formulário.

Resultado final: `npm.cmd test` passou **36 testes de servidor**; `npx.cmd playwright test` passou **16 testes de navegador**. Inclui dois minutos de estabilidade da Sala 5, câmera/zoom/HUD, captura de selfie, persistência e carga de 50 participantes. As telas de passe pronto, orientação para a TV e participante ativo também foram inspecionadas visualmente.

As credenciais Cloudflare foram detectadas configuradas no ambiente, sem expor seus valores. Mesmo assim, as chamadas de IA nesta validação são simuladas, com bancos/imagens de teste isolados. Não foram usadas selfies reais nem feitas gerações pagas. Semelhança do portrait e menu nativo de compartilhamento em aparelho físico continuam sendo verificações manuais.
