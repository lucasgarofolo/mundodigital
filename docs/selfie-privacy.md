# Selfie temporária e exclusão automática

A selfie é uma entrada temporária dos pipelines LPC e portrait. Quando ambos encerram o uso da imagem, o servidor remove o arquivo privado e sua referência. Permanecem avatar Universal LPC, appearance JSON, portrait pixel art, crachá/Story e dados operacionais. Classificação, prompt, geração do portrait, sprites, mundo e câmera não foram alterados.

## Aviso e ciência

Antes dos controles de captura/envio, `/check-in` apresenta “Sobre sua selfie 📸”: finalidade, envio aos serviços de IA, exclusão **do servidor do Mundo // Digital** após o processamento e aplicação das políticas próprias dos provedores externos. Não promete exclusão em servidores externos nem apresenta interpretação jurídica de consentimento.

A confirmação obrigatória é: “Estou ciente de que minha selfie será processada por serviços de inteligência artificial para gerar minha experiência no Mundo // Digital.” O botão permanece desabilitado sem ela. Capturar uma prévia local não envia a selfie ao backend.

O backend exige `selfieAiAcknowledged=true` no multipart (valor textual exato `true`). Ausência, `false`, `1` e outros valores recebem HTTP 400 antes de persistir imagens ou agendar consumidores. Novos POSTs duplicados também precisam da confirmação; recuperar uma sessão existente continua permitido.

Registram-se somente `selfieAiAcknowledgedAt` e `selfieNoticeVersion = "1.0"`, sem copiar o texto por participante ou inventar aceite retroativo para registros antigos. O link “Saiba como sua imagem é utilizada” fica oculto até configurar `SELFIE_PRIVACY_POLICY_URL` com HTTPS ou caminho local. Nenhuma página jurídica fictícia foi criada, e o `.env` real não foi alterado.

## Armazenamento e metadados

O upload validado continua normalizado sem metadados em `data/photos/<uuid>.png`, fora do diretório estático. O nome original enviado não compõe o caminho salvo. Não existe URL pública da selfie ou botão para visualizá-la no admin.

A migração aditiva para **SQLite versão 8** preserva registros e assets:

| Campo interno | Finalidade |
| --- | --- |
| `photoPath` / `photo_path` | Referência privada existente, limpa após exclusão. |
| `selfieStatus` | AVAILABLE, PROCESSING, DELETED ou DELETE_FAILED; null quando nunca houve selfie. |
| `selfieDeletedAt` | Horário confirmado de exclusão/reconciliação. |
| `selfieAiAcknowledgedAt` | Horário da ciência no novo check-in. |
| `selfieNoticeVersion` | Versão curta do aviso. |
| `avatarSelfieFinishedAt` | Consumidor LPC encerrou definitivamente seu trabalho. |
| `portraitSelfieFinishedAt` | Consumidor portrait encerrou definitivamente seu trabalho. |

Esses campos operacionais permitem um futuro admin mostrar situação e falhas. `photoPath` e metadados de selfie são removidos do JSON de simulação antigo e das novas gravações. Depois de apagar, a referência no walker também é limpa, evitando que checkpoints recriem um caminho inválido.

## Critério de exclusão

`lib/selfieLifecycle.js` centraliza a operação. A selfie só pode ser removida quando:

1. Avatar READY, ou FALLBACK/FAILED com término definitivo registrado ou orçamento comprovadamente esgotado.
2. Portrait READY, ou FAILED com término definitivo registrado ou orçamento comprovadamente esgotado.
3. Nenhum dos dois serviços possui trabalho ativo/enfileirado para o UUID.
4. Nenhum consumidor mantém reserva de uso da imagem em memória.

O fallback real do pipeline LPC é `FALLBACK`, tratado explicitamente. Um FAILED momentâneo do portrait não representa término: o retry automático mantém o job/reserva e volta para PENDING antes da espera. A exclusão tem exclusão mútua por UUID; uma nova análise não pode começar enquanto a imagem está sendo removida.

O pipeline LPC mantém uma reserva adicional enquanto a Promise real do analisador não termina. Mesmo que o timeout já tenha produzido fallback, um consumidor que ainda não reconheceu o AbortSignal impede a remoção. O backend continua podendo mostrar o fallback sem ficar preso aguardando essa Promise.

As políticas de retry continuam iguais: LPC repete uma vez HTTP 500/502/503/504 no orçamento global existente; portrait mantém suas falhas transitórias e máximo de duas tentativas persistidas. Falhas permanentes encerram sem repetir chamadas indevidas, mesmo com contador nominal menor que dois. Retry manual dentro do orçamento continua possível enquanto a selfie existe, por exemplo quando o outro consumidor ainda processa. Não se retém a foto indefinidamente para um possível retry manual futuro.

READY + PROCESSING, PENDING + READY, espera de retry e análise cancelando não permitem exclusão. “Gerar outra versão” continua usando appearance JSON localmente e funciona sem selfie, sem nova IA.

## Filesystem, buffers e falhas

Só é aceito o caminho canônico privado do próprio UUID. Referências inseguras são recusadas, sem seguir caminhos arbitrários. Após `unlink()` bem-sucedido, o estado passa a DELETED e o caminho fica null. ENOENT também reconcilia como DELETED, cobrindo queda entre a remoção física e a atualização do SQLite.

Outros erros preservam referência/arquivo e registram DELETE_FAILED, nunca um sucesso falso. Um sweep posterior tenta novamente. Logs usam UUID abreviado e códigos seguros (`selfie:cleanup-started`, `selfie:deleted`, `selfie:deletion-failed`), sem conteúdo, Base64, caminhos completos ou mensagens brutas de filesystem.

OpenRouter/Gemini/Ollama já preparam JPEG em memória, sem arquivo intermediário. Buffers de origem/JPEG são zerados nos caminhos de cleanup; Cloudflare zera seu buffer de entrada. O handler limpa os buffers de upload e normalização. Não há cache, thumbnail ou backup de selfie introduzido pelo projeto. Strings temporárias de requisição/Base64 não são persistidas nem registradas; sua memória é gerenciada pelo runtime.

No celular, ObjectURLs e referências da prévia são liberados após envio/saída. O canvas é esvaziado depois da captura. Assets gerados são arquivos do produto e não são removidos com a selfie.

## Restart e sweep conservador

O servidor executa um sweep antes de liberar a aplicação. READY/READY com selfie ainda presente é removido sem chamar provedores novamente. Jobs interrompidos seguem a retomada existente e continuam protegidos.

Um único sweep global roda a cada **60 segundos**, incluindo nova tentativa de DELETE_FAILED. Não existe timer por participante ou expiração por idade de fotografia em processamento.

Arquivos canônicos sem registro, com mais de **24 horas**, só são removidos quando não há upload, lease ou job de selfie ativo/enfileirado. Arquivos recentes, desconhecidos e situações sem término demonstrável são preservados. As 24 horas são uma proteção para órfãos, não um TTL que interrompe processamento.

A manutenção `avatar:analyze` também usa o lifecycle. Como antes, execute-a com o servidor do evento parado para não ter dois processos manipulando o mesmo banco/diretório.

## Reprocessamento e assets

Operações que precisem de uma selfie removida recebem HTTP 409 / SELFIE_REMOVED com: “Selfie original removida por privacidade. Uma nova foto é necessária para este reprocessamento.” A manutenção apresenta a mesma orientação. Não se restaura o arquivo, consulta caminho inexistente ou inicia retry infinito.

Reutilizar um LPC READY, recuperar um portrait PNG já salvo, gerar variação local e renderizar Story a partir dos assets continuam possíveis. `/pass/:uuid`, API do passe, portrait, Story e `/tela` não dependem de `photoPath`. O hash/cache do Story não inclui metadados da selfie. Não foi criado fluxo de substituição de foto ou upload de admin.

## Validação

Execute `npm.cmd test` e `npx.cmd playwright test`. Os novos testes são `tests/selfie-privacy.test.js` e `tests/browser/selfie-privacy.spec.js`.

Cobrem confirmação obrigatória, conclusão normal, ambas as ordens de conclusão, retries, falhas terminais, retry manual antes/depois da remoção, analisador ainda cancelando, DELETE_FAILED/nova tentativa automática, restart, ENOENT após queda, sweep conservador, variação local e LPC/portrait/passe/Story sem selfie. O teste mobile verifica aviso antes da captura, checkbox, envio e refresh de check-in/passe/TV. Fixtures antigos foram atualizados para declarar ciência; testes de retenção permanente foram ajustados à política temporária.

Os testes usam imagens sintéticas/provedores simulados, sem enviar selfies reais a IA. A política não promete exclusão nos provedores externos ou apagamento forense de memória/disco. Falta de permissão de filesystem mantém DELETE_FAILED até que a remoção seja possível.

Resultado em 02/11/2026: **156 testes Node aprovados**, **32 testes Chrome aprovados na suíte completa** e teste de manutenção CLI repetido com sucesso após integrar seu cleanup. O aviso foi inspecionado visualmente em 390 px; captura em `test-results/selfie-privacy-notice-mobile.png`. Foram preservados LPC, portrait, Story, câmera, tracking, mundo e comportamentos sociais, incluindo o cenário de dois minutos de estabilidade.

## Arquivos desta implementação

Criados:

- `lib/selfieLifecycle.js`
- `tests/selfie-privacy.test.js`
- `tests/browser/selfie-privacy.spec.js`
- `docs/selfie-privacy.md`

Modificados:

- Backend: `server.js`, `lib/store.js`, `lib/avatarPipeline.js`, `lib/passService.js`.
- Interface: `public/check-in.html`, `public/css/check-in.css`, `public/js/check-in.js`, `public/js/selfieCamera.js`.
- Manutenção/teste de carga: `scripts/analyze-participant.js`, `scripts/load-test.js`, `scripts/test-ollama-avatar.js`.
- Configuração/documentação: `.env.example`, `package.json`, `README.md`, `PHASE3.md`, `docs/avatar-pipeline.md`, `docs/portrait-pass.md`.
- Testes Node existentes: `tests/avatar-experience.test.js`, `tests/avatar-pipeline.test.js`, `tests/checkin.test.js`, `tests/credential-flow.test.js`, `tests/participant-reset.test.js`, `tests/persistence.test.js`, `tests/portrait-pass.test.js`.
- Testes Chrome existentes: `tests/browser/avatar-experience.spec.js`, `tests/browser/avatar-pipeline.spec.js`, `tests/browser/checkin.spec.js`, `tests/browser/operator.spec.js`, `tests/browser/participant-reset.spec.js`, `tests/browser/pass.spec.js`, `tests/browser/selfie-camera.spec.js`.

O `.env` real, analisadores, catálogo, mapper, builder, compositor, assets LPC, configuração do mundo, movement, câmera e tracking não foram alterados. Reinicie o servidor para carregar os handlers novos, aplicar a migração e executar a recuperação inicial.
