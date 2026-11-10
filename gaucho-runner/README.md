# Gaúcho Runner — a cavalo

O jogo do dinossauro do Chrome recriado a partir de uma **imagem de referência**:
um gaúcho montado a cavalo em pixel art 1-bit (cinza-claro + preto), correndo pelo pampa
e desviando de capim, pedras, arbustos, cercas e quero-queros.

Canvas puro, sem dependências, sem build. Abra o `index.html` e jogue.

A imagem que guiou o visual está em `referencia.jpg`.

## O que veio da referência

- **Personagem:** o sprite vem da primeira imagem (`referencia.jpg`) e a
  **animação do galope usa os 8 quadros da folha `galope-referencia.jpg`**: os quadros foram
  recortados, alinhados pelo chapéu e pelo chão, e entram no jogo como estão
  (1 bit, fundo transparente, tinta adaptada ao dia/noite). Assim o movimento é
  exatamente o da referência de galope.
- **Paleta de 2 cores + tom das nuvens:** cinza-claro `#F7F7F7` (mesmo fundo do
  jogo do dinossauro do Google), preto `#1E1C18` e um terceiro tom suave usado só
  nas nuvens (`#D8D8D8` no dia; noite inverte).
- **Nuvens vazadas** (só contorno, em degraus), em tom claro, traço fino,
  tamanho menor e deriva lenta.
- **Chão** com linha fina e risquinhos espalhados.
- **Obstáculos do pampa:** capim (1 a 3 tufos), pedra, arbusto espinhoso e cerca
  de madeira com mourões vazados e travessas duplas.
- **Quero-quero:** 4 quadros da folha `quero-referencia.jpg` (asas em 4 posições), recortados, alinhados pelo bico, espelhados para voar para a esquerda e tingidos com a paleta. Mantém crista, bico fino, asa pontuda e pernas longas.

## Aspecto pixel

O jogo é desenhado num canvas de **baixa resolução** e depois ampliado:

1. as formas são polígonos de lados retos — nada de curvas;
2. a cena é rasterizada numa grade grossa (`SCALE_FACTOR = 3` pixels de tela por
   pixel de arte);
3. cada pixel é aproximado para a **paleta de 3 tons** (fundo, tinta e nuvem) —
   isso remove o anti-aliasing e deixa as bordas duras;
4. a ampliação é feita com **nearest-neighbor** (`imageSmoothingEnabled = false`),
   com pixels do mesmo tamanho na tela.

## Tela inicial

Ao abrir, o jogo mostra um menu no mesmo estilo (fundo cinza-claro, tinta
preta, mesma fonte monoespaçada do jogo): **JOGAR**, **SOBRE** e **CONTATO**,
com o cavalo galopando ao fundo.
Navegue com as setas + Enter, ou clique/tocque. SOBRE e CONTATO abrem painéis com
um botão VOLTAR, e `Esc` durante o jogo volta ao menu.
Os contatos em `CONTACT_LINES` (no `game.js`) são placeholders — troque pelos seus.

## Tela cheia

O jogo ocupa a viewport inteira (`100vw × 100vh`), sem moldura, sem borda e sem
caixa em volta. O céu vai até as bordas e o chão fica perto do rodapé. O mundo é
medido em unidades lógicas e a escala é recalculada no resize.

## Municípios

A cada **obstáculo vencido** o gaúcho conquista **um município do Rio Grande
do Sul**, na ordem alfabética dos **497** municípios do arquivo
`../municipios.xlsx` (IBGE — Censo 2022). O HUD só mostra um município **depois**
que o primeiro obstáculo é vencido; a partir daí exibe o **último conquistado**,
centralizado, com a contagem normal (`1`, `2`, …) e uma barra de
progresso geral. Não existe mais pontuação por distância; o recorde é a
quantidade de municípios conquistados numa corrida. Ao conquistar o **497º**, o
jogo termina em vitória com **“O RS é teu! Parabéns por conquistar os 497
municípios gaúchos”**. Em uma derrota comum, a tela final mostra as frases
**“Tchê! Tu conquistou 1 dos 497 municípios gaúchos!”** e
**“O último conquistado foi NOME”**. Se morrer logo no primeiro obstáculo,
mostra **“Mas bah! Não chegou a lugar nenhum! Tenta de novo, tchê!”**.

A lista é gerada do Excel e fica embutida em `municipios.js`
(`window.MUNICIPIOS`), sem depender de servidor nem de fetch. Os nomes do HUD e
da tela final usam uma fonte monoespaçada comum do sistema (Consolas / Lucida
Console / Courier New), sem pixelização, com acentos e cedilha preservados
(`Barracão`, `Espaço`, `Almirante Tamandaré`).
As nuvens são posicionadas abaixo da faixa reservada ao HUD, para não passarem
por trás do nome do município, e a tela de fim de jogo usa um painel opaco para
que nenhuma nuvem atravesse o resultado. Elas também são menores, têm traço
fino, tom claro e se movem a 10% da velocidade do cenário.

## Controles

| Tecla | Ação |
| --- | --- |
| `espaço` / `↑` / `W` | pular (soltar cedo = pulo mais baixo) |
| `M` | ligar/desligar som |
| `Esc` | voltar ao menu |
| clique / toque | pular e começar; no fim, somente nos botões **JOGAR DE NOVO** e **MENU** |

No celular, **PULAR** vira um botão no rodapé. O jogo reserva essa faixa,
levanta o chão e respeita as **safe areas** do aparelho.

## Mecânicas

- velocidade de **5,5 a 11,5**, subindo conforme os municípios são conquistados;
- **cada obstáculo vencido = um município conquistado**; a pontuação antiga foi
  removida e o recorde é o número de municípios;
- ciclo dia/noite a cada 100 municípios conquistados (lua, estrelas e nuvens);
- pulo com altura variável, agora exigido de formas diferentes;
- obstáculos variados: capim, pedra, arbusto, cerca, tronco e mourão, com
  tamanhos aleatórios e **sem repetir o mesmo tipo em sequência**;
- padrões liberados com a progressão: isolado, dupla próxima, dupla espaçada
  (dois pulos), pássaro sobre obstáculo (exige pulo curto), pássaro + obstáculo,
  mourão + obstáculo, trio (três pulos) — duplas e trios sempre intercalando
  tipos diferentes;
- começo bem leve: os primeiros 40 municípios são só obstáculos isolados e os
  15 primeiros só pedra/capim baixos; o quero-quero isolado começa por volta de
  20 municípios, as duplas por volta de 40, o pássaro sobre obstáculo por 70,
  o pássaro + obstáculo por 120, o trio por 200 e o mourão + obstáculo por 280;
- quero-queros em três alturas, todos exigindo pulo;
- personagem 15% menor que o original (sprite e caixa de colisão);
- as patas se cruzam em X no galope (dianteiras e traseiras passam uma pela outra);
- hitbox mais estreita que o desenho, para o pulo perdoar;
- tela de fim com duas opções — **JOGAR DE NOVO** e **MENU** — e clique fora
  dos botões não reinicia a partida; o cursor de mão só aparece sobre botões;
- ao conquistar o último município (497), o jogo encerra em vitória;

## Estrutura

```
gaucho-runner/
├── index.html      # canvas em tela cheia
├── style.css       # página sem margens, sem moldura, com upscale pixelado
├── game.js         # jogo inteiro (lógica, desenho, paleta, fonte, áudio)
├── municipios.js   # 497 municípios do RS em ordem alfabética (do .xlsx)
├── referencia.jpg  # imagem usada como guia visual
├── galope-referencia.jpg  # folha com os quadros do galope
├── quero-referencia.jpg   # folha com os quadros do quero-quero
└── README.md
```

## Onde mexer

- **Tamanho do pixel:** `SCALE_FACTOR` no topo do `game.js` (2 = mais fino,
  4 = mais blocão).
- **Cores:** `PAL` (dia e noite). Dois tons base e um tom extra (`cloud`) só
  para as nuvens.
- **Física e dificuldade:** `CFG` (`gravity`, `jumpVelocity`, `startSpeed`,
  `maxSpeed`, `nightEvery`), a curva de `game.speed` e `spawnWave()` para os
  padrões.
- **Cavalo + cavaleiro:** `drawRunner()` e os 8 quadros de galope; caixa em
  `BODY_H` / `runnerBox()`. Os quadros passam por `thinFrameImage()` /
  `RUNNER_THIN_RADIUS`, que afinam o contorno mantendo a silhueta cheia.
- **Obstáculos:** `drawGrass()`, `drawRock()`, `drawBush()`, `drawFence()`.
- **Quero-quero:** `drawBird()`. **Menus:** `drawMenuText()` + `UI_FONT`.
- **Municípios:** lista em `municipios.js`; contador em `game.conquered` e
  textos do HUD/fim de jogo em `drawMunicipioHud()` / `drawGameOver()`.
- **Fonte da interface:** `UI_FONT` no topo do `game.js` (hoje uma pilha
  monoespaçada sem pixelização, com acentos).
- **Tamanho do conjunto:** `BODY_H` e as caixas em `runnerBox()`.
- **Escala do mundo:** `DESIGN_W` e `MIN_H`.

## Depuração

Parâmetros de URL:

- `?debug=run` / `?debug=jump` / `?debug=dead` / `?debug=win` — cena estática
  (`win` mostra a vitória no 497º)
- `&night=1` — força a noite
- `&boxes=1` — mostra as caixas de colisão
- `&cidades=40` — define quantos municípios já foram conquistados
- `&touch=1` — força os controles de toque (para testar no desktop)
- `&rotate=0` — esconde o aviso de “jogue na horizontal”

Exemplo: `index.html?debug=dead&cidades=40`
Para testar o layout mobile: `index.html?debug=run&touch=1&rotate=0`

## Notas

Recriação própria, inspirada no T-Rex Runner do Chromium (licença BSD) e na
imagem de referência fornecida. Nenhum asset do Chrome foi copiado: tudo é
desenhado com paths de canvas e reduzido à paleta de pixel art.
