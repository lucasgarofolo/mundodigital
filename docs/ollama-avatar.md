# Análise local de selfie com Ollama

O provider `ollama` substitui somente a análise visual do Gemini. Foto normalizada → modelo de visão local → JSON do catálogo existente → compositor LPC → prévia no celular → aprovação → entrada pela porta. Não há mudança de mapa, câmera, banco ou máquina de estados. `local` continua sendo o LPC padrão sem IA; `ollama` faz análise real da imagem.

## Configuração

Ollama precisa estar aberto no computador que executa o servidor Node. O modelo deve estar instalado e suportar imagens. Nesta máquina já existe `gemma4:12b`, com capacidade `vision` confirmada por `/api/show`, sem baixar outro modelo.

```dotenv
AVATAR_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:12b
OLLAMA_TIMEOUT_MS=0
OLLAMA_LOG_RESPONSE=true
```

Abra o aplicativo Ollama ou execute `ollama serve`; `ollama list` mostra os modelos instalados. Depois reinicie `npm.cmd start`. Para voltar ao Gemini, altere apenas `AVATAR_PROVIDER=gemini` e reinicie Node; as configurações e a chave Google continuam preservadas.

`OLLAMA_TIMEOUT_MS=0` aguarda sem prazo local. Valor positivo configura o mesmo prazo no analisador e na fila. Shutdown e limpeza cancelam requisições pendentes. O modo Ollama processa uma selfie por vez para reduzir pressão de memória. A primeira chamada carrega o modelo; com 16 GB de RAM e GPU de 6 GB, o modelo de 7,6 GB pode usar RAM/CPU e levar mais tempo. Não é uma garantia de desempenho para o evento.

O endpoint é `/api/chat`, com imagem JPEG base64 de até 768×768, `stream:false`, `format` igual ao schema do catálogo, temperatura zero e pensamento desativado. A resposta é validada localmente. Nome, e-mail e UUID não são enviados ao modelo. A URL aceita somente loopback e modelos com sufixo `:cloud` são rejeitados. Nenhuma chamada ao Gemini é feita como fallback; falha gera LPC padrão para aprovação.

Fotos de cadastros existentes não são automaticamente analisadas outra vez. Para testar pelo formulário, use um e-mail novo. “Gerar outra versão” continua sendo variação local LPC. A interface informa que a análise ocorre no computador do evento; o terminal exibe envio, resultado validado e códigos de falha, sem imagens ou chaves.

## Testes

`npm.cmd test` cobre transporte simulado, JPEG normalizado, schema, resposta inválida, indisponibilidade, timeout, concorrência unitária, revisão e deduplicação sem Google.

`npm.cmd run avatar:test:ollama` faz uma chamada ao modelo real com uma imagem sintética uniforme, usando banco separado em `.test-data`. Verifica JSON válido, geração LPC, revisão invisível no mundo, aprovação e estado `ACTIVE`. O teste limita a análise a três minutos e não usa selfies de visitantes. Uma imagem uniforme deve retornar características `unknown`, convertidas nos defaults do catálogo; esse teste confirma integração, não semelhança do avatar com uma pessoa. Semelhança deve ser conferida manualmente com selfie autorizada no formulário.

Validação nesta máquina: **29 testes de servidor passaram**, e o teste com o `gemma4:12b` real também passou até `ACTIVE`. Nenhum registro do banco principal foi alterado pelo teste e nenhuma chamada ao Google foi feita. O modelo precisou de aproximadamente 69 segundos para carregar pela primeira vez; esse tempo não inclui toda a inferência. O serviço Ollama foi iniciado para o teste e deixado disponível em loopback.

Arquivos: `lib/ollamaAvatarAnalyzer.js` e `scripts/test-ollama-avatar.js` novos; integração em `server.js`, `lib/avatarPipeline.js`, `scripts/analyze-participant.js`, `public/js/check-in.js`, `.env.example`, `package.json` e testes do pipeline. Não foi adicionada dependência npm.

Referências oficiais: [visão](https://docs.ollama.com/capabilities/vision), [JSON estruturado](https://docs.ollama.com/capabilities/structured-outputs) e [chat API](https://docs.ollama.com/api/chat).
