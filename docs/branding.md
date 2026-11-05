# Identidade pública — Mundo // Digital

O ajuste altera somente marca e textos. Mantém os elementos HTML, estilos, cores, fontes, dimensões, rotas, contratos, dados e comportamento existentes. Os cabeçalhos que já tinham duas linhas continuam com duas linhas; o nome é lido como **Mundo // Digital**. O botão principal usa caixa alta.

## Arquivos alterados

- Interface: `public/check-in.html`, `public/pass.html`, `public/tela.html`, `public/operator.html`.
- Textos do frontend: `public/js/pass.js`, `public/js/operator.js`, `public/js/participantsClient.js`, `public/js/world.js`, `public/js/world-config.js`.
- Templates e mensagens do backend: `lib/passView.js`, `lib/passRoutes.js`, `server.js`.
- Configuração textual: `.env`, `.env.example`, descrição em `package.json`.
- Documentação: `README.md`, `docs/avatar-pipeline.md`, `docs/credential-flow.md`, `docs/macro-world.md`, `docs/operator-tracking.md`, `docs/portrait-pass.md`, `docs/selfie-privacy.md`, `CREDITS-LPC.md` e sua cópia em `public/assets/avatars/lpc/CREDITS-LPC.md`.
- Expectativas e dados sintéticos de testes: `tests/world.test.js`, `tests/portrait-pass.test.js`, `tests/browser/world.spec.js`, `tests/browser/pass.spec.js`, `tests/browser/selfie-privacy.spec.js`.
- Criados: este registro e `tests/browser/branding.spec.js`.

## Textos públicos atualizados

A tabela registra a versão final de cada texto que continha a marca anterior. Os demais trechos de cada mensagem foram preservados.

| Local | Texto final |
| --- | --- |
| Título do check-in | Entre no Mundo // Digital |
| Marca no check-in, TV, operador, crachá e Story | Mundo // Digital |
| Finalidade da selfie | Sua foto será utilizada somente para criar sua identidade visual no Mundo // Digital. |
| Exclusão da selfie | Após o processamento ser concluído, a selfie será apagada do servidor do Mundo // Digital. O sistema manterá apenas os elementos gerados, como seu avatar e portrait. |
| Confirmação obrigatória | Estou ciente de que minha selfie será processada por serviços de inteligência artificial para gerar minha experiência no Mundo // Digital. |
| Processamento no check-in e passe | Preparando seu crachá do Mundo // Digital… |
| Título da TV | Mundo // Digital · Sala 5 e blocos |
| Nome acessível do mundo | Sala 5 de acesso ao Mundo // Digital |
| Câmera HOME na TV e operador | Visão de entrada do Mundo // Digital. |
| Título do operador | Controle do operador · Mundo // Digital |
| Resultado de busca, entrando | Entrando no Mundo // Digital |
| Resultado de busca, ativo | No Mundo // Digital |
| Resultado de busca, indisponível | Ainda não entrou no Mundo // Digital |
| Status da TV | AO VIVO · Mundo // Digital |
| Placa desenhada no mapa | Mundo // Digital, nas mesmas duas linhas existentes |
| Nome do terminal | Terminal Mundo // Digital |
| Título do passe | Meu passe · Mundo // Digital |
| Nome acessível do crachá | Crachá Mundo // Digital de {nome} |
| Nome acessível do LPC | Seu personagem no Mundo // Digital |
| Introdução do dono do passe | Este é o seu crachá do Mundo // Digital. Agora você pode entrar. |
| Introdução de quem abre outro passe | Este é um passe do Mundo // Digital. A entrada é confirmada no navegador do participante. |
| Botão de entrada | ENTRAR NO MUNDO // DIGITAL |
| Participante ativo | Você já está no Mundo // Digital. |
| Entrada em andamento | Tudo pronto! Seu avatar está entrando no Mundo // Digital. |
| Compartilhamento antes de entrar | Entre no Mundo // Digital para guardar e compartilhar seu crachá. |
| Título do compartilhamento nativo | Meu passe Mundo // Digital |
| Confirmação do download | Download iniciado. Compartilhe no Instagram. |
| Nome sugerido pelo navegador | mundo-digital-{número do passe}.png |
| Nome sugerido pelo endpoint de download | mundo-digital-{número do passe}-{arquivo} |
| Hashtag padrão documentada e ambiente local | #MundoDigital |
| Prefixo do log | [Mundo // Digital] |
| Mensagem de inicialização | Mundo // Digital: http://localhost:{porta}/tela … |
| Descrição do pacote | Protótipo isométrico do Mundo // Digital — Fase 1 |

O Story reutiliza `cardMarkup()`; a alteração do cabeçalho e nomes acessíveis é compartilhada com o crachá, sem mudar o renderizador ou a exportação 1080×1920. A chamada institucional para marcar um perfil foi removida. `EVENT_INSTAGRAM_HANDLE` está vazio no ambiente local; o template existente omite o handle quando não há um configurado. Nenhum perfil foi inventado.

README, documentação de arquitetura/fluxos/privacidade e créditos passaram a usar a mesma identidade. No diagrama LPC, a legenda passou a **Mapper de aparência → LPC**. Autoria, licenças e atribuições de terceiros foram preservadas.

## Ocorrências técnicas preservadas

Não há referência institucional na copy pública do sistema. A busca global no código e documentação mantém somente os identificadores abaixo e testes que verificam sua compatibilidade:

| Identificador | Local | Motivo |
| --- | --- | --- |
| `mundo-senai-virtual` | `package.json`, `package-lock.json` | Nome técnico do pacote; não é o título público. |
| `senai_fold` | `lib/store.js`, `docs/operator-tracking.md` | Função SQLite de busca; documentação continua fiel à implementação. |
| `senai_operator` | `lib/operatorControl.js`, teste do operador | Cookie de autenticação existente. |
| `senai-participant-session` | Check-in, passe e testes de recuperação | Chave de armazenamento que preserva a sessão do participante. |
| `senai-world-controls-collapsed` | `public/js/operator.js` | Preferência de recolhimento dos controles. |
| `X-SENAI-ADMIN` | `server.js`, `public/js/participantAdmin.js`, testes de limpeza | Header de um contrato administrativo existente. |

O teste de branding contém deliberadamente um valor de instituição fornecido por um visitante e uma busca pela marca anterior. Esses são dados/asserts sintéticos, sem alterar participantes reais. Instituição do visitante não é branding do sistema e continua sendo exibida exatamente como informada.

Caches de testes, dados históricos e arquivos já baixados não são reescritos. Não se alteram registros pessoais para trocar branding.

## Assets e limites

As duas plantas `public/assets/map/sc-site-13.jpg` e `sc-site-14.jpg` foram inspecionadas visualmente: não apresentaram logo ou nome institucional. A placa no mundo era texto Phaser e foi neutralizada sem alterar sua geometria. Nenhum asset gráfico exigiu redesenho; spritesheets e fontes LPC permanecem intactos.

Não existe página `/admin` neste checkout: a limpeza administrativa está em `/tela`, com operação também em `/operator`. Nenhuma rota nova foi criada. Não há manifest PWA para renomear.

Reinicie o processo Node para carregar os templates do backend e a hashtag atualizada do `.env`, depois recarregue as páginas. A política existente de cache de Story não foi modificada: a mudança de hashtag muda o hash da configuração e a recuperação normal recompõe o Story armazenado. Exportações já baixadas por visitantes continuam com o conteúdo da época do download.

## Verificação

O teste novo usa apenas imagem sintética e providers injetados, sem requisições reais de IA. Verifica check-in, processamento, passe pronto, entrada, ACTIVE, Story 1080×1920, TV, operador, ausência de marca institucional, handle ausente, botão sem overflow e preservação da instituição informada pelo visitante.

Todos os arquivos CSS são comparados por SHA-256 com o estado anterior. Código de banco, migrations, catálogo/compositor/assets LPC, analisadores, Cloudflare, filas, navegação, câmera, tracking e comportamentos não foram modificados.

`npm test`: **156 testes aprovados**, sem falhas. Inclui providers local/Ollama/Gemini/OpenRouter, independência do portrait, selfie temporária, LPC, persistência, credencial, operador, visitas e comportamentos.

`npx playwright test`: **33 testes aprovados em 8 minutos**, sem falhas. Inclui o novo teste de branding, câmera/resize, dois minutos de estabilidade da Sala 5, tracking, controles administrativos, câmera do celular, credencial, download/compartilhamento e cenários com 10/50/100 avatares. Os testes de APIs usam mocks/injeção; nenhuma chamada paga foi realizada.

Capturas conferidas visualmente: `test-results/branding-checkin-mobile.png`, `branding-pass-mobile.png`, `branding-operator-mobile.png`, `branding-world.png` e `branding-story.png`. Sem overflow horizontal ou corte do botão; o scroll vertical próprio do formulário com aviso de privacidade e do passe em celular permanece com as regras originais. O Story preserva as dimensões 1080×1920. A suíte também valida nome longo e alinhamento do Story.

A comparação por SHA-256 confirmou **130 arquivos existentes sem alterações, incluindo os 5 CSS**; as 29 alterações em arquivos existentes correspondem à lista de textos, configuração pública e expectativas de testes acima. A busca também verificou os diretórios de dados e artefatos: não há ocorrências em arquivos textuais dos dados principais; referências em logs/fixtures locais de `.test-data` são histórico de execução e não são reescritas. Nenhum dado pessoal do banco principal foi alterado.
