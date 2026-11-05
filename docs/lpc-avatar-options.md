# Universal LPC — prova de conceito da Fase 4.0

Abra **http://localhost:3000/tela?lpcTest=true** depois de `npm.cmd start`. A Sala 5 existente mostra sete placeholders e um LPC identificado como “LPC”. Esse modo usa participantes fictícios no frontend, não grava registros e não conecta a cena ao Socket.IO. `/tela` mantém o fluxo real; `/tela?demo=1` mantém os oito placeholders. Nenhum mapa, câmera, navegação, endpoint, provedor de avatar ou schema foi substituído.

## Origem e licença

Foi escolhido o [Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator), revisão `58ce1aa479e4df32845a73a5d0afc221c3a893c2`. Não foi instalado o aplicativo gerador nem importado seu código. Foram importados nove PNGs de caminhada e um subconjunto de paletas para composição offline com o Sharp que o projeto já utiliza.

Todas as camadas utilizadas oferecem **OGA-BY 3.0** como licença, escolhida individualmente a partir das definições de crédito. Os autores, alternativas de licença, observações e links originais estão em [CREDITS-LPC.md](../CREDITS-LPC.md). O texto completo da licença e uma cópia pública dos créditos acompanham os assets. O link de créditos aparece no rodapé somente no modo LPC.

| Camada importada | Caminho no repositório de origem (sob `spritesheets/`) | zPos |
|---|---|---:|
| Corpo masculino adulto | `body/bodies/male/walk.png` | 10 |
| Sapatos básicos | `feet/shoes/basic/male/walk.png` | 15 |
| Calça | `legs/pants/male/walk.png` | 20 |
| Camiseta | `torso/clothes/shortsleeve/tshirt/male/walk.png` | 35 |
| Cabeça humana masculina | `head/heads/human/male/walk.png` | 100 |
| Rosto neutro | `head/faces/male/neutral/walk.png` | 101 |
| Barba curta | `beards/beard/trimmed/walk.png` | 110 |
| Óculos pretos | `facial/glasses/glasses/adult/walk/black.png` | 115 |
| Cabelo curto plain | `hair/plain/adult/walk.png` | 120 |

`public/assets/avatars/lpc/sources/manifest.json` registra os caminhos exatos, revisão, metadados de atribuição e fontes de cada arquivo. Os PNGs locais têm nomes de camada (`body.png`, `hair.png` etc.).

## Layout verificado e integração

Cada camada de caminhada selecionada mede **576×256**: nove colunas e quatro linhas de frames **64×64**. Não se pressupõe o layout de um sheet completo. O [código de constantes da revisão usada](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/58ce1aa479e4df32845a73a5d0afc221c3a893c2/sources/state/constants.ts) define direções `up, left, down, right` e ciclo de caminhada 1–8. O sheet completo padrão tem 13 colunas e caminhada nas linhas 8–11; os PNGs compactos importados começam a caminhada na linha 0 e têm nove colunas, confirmado pelos próprios arquivos.

| Direção | Linha | Frame parado | Frames de caminhada |
|---|---:|---:|---|
| up | 0 | 0 | 1–8 |
| left | 1 | 9 | 10–17 |
| down | 2 | 18 | 19–26 |
| right | 3 | 27 | 28–35 |

Os índices são zero-based. Não há idle animado importado: parar interrompe a animação e mantém a coluna 0 da última direção. São quatro animações globais, registradas uma vez, a **10 fps**, com repetição. `Sprite.play(key, true)` mantém o ciclo quando a direção não muda. Não há composição por frame.

O deslocamento lógico existente é projetado para a tela antes de escolher a direção dominante. Diagonais usam uma das quatro direções cardinais. O LPC não recebe o espelhamento e o bob artificial dos placeholders; sua própria caminhada anima o corpo. A velocidade e os waypoints continuam definidos em `movement.js`.

`public/js/avatar/lpcConfig.js` centraliza frame, paleta manual, escala e alinhamento. A escala é **0,75**; o canvas do frame ocupa 48×48 unidades e o corpo visível fica aproximadamente entre 30 e 40 unidades de altura, próximo aos placeholders de 37,2. A origem dos pés é `(32,60)` no frame, com deslocamento vertical de −2. Foram preservados `pixelArt:true`, `antialias:false` e `roundPixels:true`; não há filtro de redimensionamento na exportação. Escalas fracionárias e zoom podem produzir distribuição desigual de pixels, sem suavização.

Sombra, nome e sprite compartilham o container atual. A posição e o depth continuam sendo `project(x,y).y`, permitindo ordenar o avatar atrás/à frente dos móveis. O HUD continua em HTML e não recebe o zoom do mundo.

## Composição e objeto manual

```js
{
  body: 'male', skin: 'light', head: 'human_male', face: 'neutral',
  hair: 'plain', hairColor: 'black', beard: 'trimmed', beardColor: 'black',
  glasses: 'basic_black', top: 'tshirt', topColor: 'black',
  pants: 'pants', pantsColor: 'charcoal', shoes: 'basic', shoesColor: 'black'
}
```

`scripts/build-lpc-avatar.js` exporta `createAvatar(appearance)`, que devolve um Buffer PNG. Recebe o objeto manual de `lpcConfig.js`, valida os campos contra o único preset importado, troca as cores com as paletas oficiais body/hair/cloth e compõe alpha por zPos. Óculos já são pretos. Os pixels e a transparência são preservados; não há reamostragem nem IA. `npm.cmd run avatar:build` regenera `test-avatar.png` offline. O navegador carrega somente esse PNG composto, uma vez por carregamento da cena.

`public/js/avatar/avatarLpc.js` é a pequena integração Phaser: preload, criação do Sprite/animações e atualização da direção/idle. `CharacterManager` seleciona esse visual somente para `avatarType:'lpc'` no fixture de teste.

## Catálogo encontrado na origem

Este é um recorte das opções existentes, **não** uma lista de combinações já suportadas pelo builder desta fase. A compatibilidade de corpo/animação e as licenças de qualquer expansão precisam ser conferidas nas respectivas definições. As [definições do catálogo](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/tree/58ce1aa479e4df32845a73a5d0afc221c3a893c2/sheet_definitions) e as [paletas oficiais](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/tree/58ce1aa479e4df32845a73a5d0afc221c3a893c2/palette_definitions) foram consultadas.

| Categoria | Exemplos reais encontrados | Definição/pasta na origem |
|---|---|---|
| Corpo | male, female, muscular, pregnant, teen, child | `body.json`, layer_1 |
| Tons de pele | light, amber, olive, taupe, bronze, brown, black; também cores fantasia | `palette_definitions/body/body_ulpc.json` |
| Cabelo curto | plain, buzzcut, parted/parted2/parted3, messy1/2/3, pixie, cowlick, swoop, unkempt | `sheet_definitions/hair/short`, `hair/bald` |
| Outros cabelos | afro, cornrows, dreadlocks, curly_short/long, bob, long, braid, ponytail | `sheet_definitions/hair` |
| Cores de cabelo | black, raven, dark_brown, light_brown, chestnut, gray, dark_gray, white, blonde, ginger, redhead | `palette_definitions/hair/hair_ulpc.json` |
| Barba/bigode | trimmed, beard, medium, winter, 5oclock_shadow; mustache, chevron, handlebar | `sheet_definitions/hair/beards`, `hair/mustaches` |
| Óculos | basic, halfmoon, nerd, round, secretary, shades, sunglasses | `sheet_definitions/headwear/accessories/glasses` |
| Parte superior | tshirt, shortsleeve, polo, longsleeve, sleeveless, blouse, tunic, formal | `sheet_definitions/torso/shirts` |
| Calças | pants, pants2, formal, formal_striped | `sheet_definitions/legs/pants` |
| Sapatos | basic, revised, sara, ghillies; também botas e sandálias | `sheet_definitions/feet` |
| Cores de roupa | black, charcoal, gray, white, navy, blue, green, forest, red, maroon, brown etc. | `palette_definitions/cloth/cloth_ulpc.json` |
| Acessórios | luvas, brincos, tapa-olho, máscara, bandanas e chapéus | `sheet_definitions/arms`, `headwear/accessories`, `headwear/coverings`, `headwear/hats` |

Os identificadores expostos no objeto manual são aliases internos explícitos, por exemplo `basic_black` seleciona `facial/glasses/glasses/adult/walk/black.png`. Não se deve concatenar caminhos a partir de texto produzido por um modelo.

## Ponto de entrada futuro

Em uma fase posterior, um adaptador poderá validar um JSON de características, converter `skinTone→skin`, `hairStyle→hair`, `facialHair→beard`, `bottom→pants` e `bottomColor→pantsColor` e chamar `createAvatar(appearance)`. Antes disso será necessário importar e atribuir os presets adicionais desejados, definir allowlists e fallback para características desconhecidas. Hoje o builder rejeita qualquer combinação diferente do preset de teste, intencionalmente.

Gemini, análise de selfie, geração em massa, persistência de aparência e associação do LPC a participantes reais não foram implementados.

## Verificação e limitações

Execute `npm.cmd test` e `npm.cmd run test:browser`. Os testes LPC verificam reprodução byte a byte da composição, transparência sem alpha interpolado, 36 frames sem cortes, tamanho visível, limites do preset e atribuição. No Chrome, verificam sete placeholders + um Sprite, quatro animações, caminhada nas quatro direções através do CharacterManager, idle correspondente, ordenação contra móveis reais, posição/nome/sombra, movimento automático, HUD com zoom, resize, uma única carga de textura e ausência de erros JavaScript/console. Os testes anteriores cobrem câmera, navegação, check-in em múltiplas telas, Socket.IO, persistência, refresh e restart.

A integração usa sprites top-down com quatro direções no mapa isométrico existente; não oferece oito direções nem altera a perspectiva do mapa. O ciclo é fixo a 10 fps e não é calibrado pixel a pixel com a velocidade dos pés. Óculos e barba são detalhes pequenos na visão geral. A avaliação estética final continua dependendo da TV e da distância de observação. Não foi incorporado um gerador headless completo: trata-se de composição offline de um único preset com assets verificados.

Resultado executado em 10/10/2026: **13/13 testes Node e 5/5 cenários Chrome passaram**, incluindo dois minutos de estabilidade da Sala 5. O teste LPC foi repetido após exigir avanço real do frame animado e passou novamente. A captura `test-results/lpc-sala5.png` foi inspecionada: proporções próximas aos placeholders, transparência e pés/sombra alinhados. Não houve erros recorrentes no console do navegador. O aviso experimental de `node:sqlite` é o aviso já existente do runtime Node.

## Arquivos entregues

Modificados: `public/js/game.js`, `public/js/characters.js`, `package.json` (comandos de build/teste) e `README.md`.

Criados:

- `public/js/avatar/lpcConfig.js` e `public/js/avatar/avatarLpc.js`;
- `scripts/build-lpc-avatar.js`;
- `tests/lpc.test.js` e `tests/browser/lpc.spec.js`;
- `docs/lpc-avatar-options.md` e `CREDITS-LPC.md`;
- `public/assets/avatars/lpc/test-avatar.png`, `LICENSE-OGA-BY-3.0.txt` e cópia pública `CREDITS-LPC.md`;
- `public/assets/avatars/lpc/sources/manifest.json`, `palettes.json` e nove PNGs: `body`, `shoes`, `pants`, `top`, `head`, `face`, `beard`, `glasses`, `hair`.

Os arquivos de pesquisa e bancos isolados dos testes permanecem em `.test-data`, já ignorado pelo projeto. Nenhuma dependência foi adicionada.
