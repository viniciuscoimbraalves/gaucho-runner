# AGENTS.md — Guia para agentes

Este arquivo descreve o projeto e as regras que um agente deve seguir para
alterá-lo sem quebrar o jogo. Leia também `gaucho-runner/README.md` para a
documentação voltada a quem joga.

## Visão geral

- **Gaúcho Runner**: corrida infinita em pixel art, clone do jogo do dinossauro
  do Chrome, com um gaúcho a cavalo no pampa.
- O arquivo `index.html` da raiz redireciona para `gaucho-runner/index.html`.
- **Sem build, sem dependências, sem npm.** Canvas puro, JavaScript e CSS.
- **497 municípios do RS** vêm de `municipios.xlsx` e estão embutidos em
  `gaucho-runner/municipios.js`.
- **Cada obstáculo vencido = um município conquistado**, na ordem alfabética.
  Ao conquistar o 497º, o jogo termina em vitória.
- Não existe pontuação por distância, pontos, `HI` ou apelido de “score”.

## Como rodar e testar

1. Abra `index.html` na raiz ou `gaucho-runner/index.html` no navegador.
   Funciona por `file://` porque a lista de municípios é local; não há `fetch`.
2. Para servir localmente (opcional):

   ```sh
   python -m http.server 8000
   ```

   Depois acesse `http://localhost:8000/`.

3. Não há suíte de testes. Use:

   ```sh
   node --check gaucho-runner/game.js
   node --check gaucho-runner/municipios.js
   ```

4. Para validação visual, use Chrome headless (ou abra no navegador):

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --headless=new --disable-gpu --hide-scrollbars `
     --window-size=1280,720 `
     --screenshot="$env:TEMP\teste.png" `
     "file:///C:/caminho/para/gaucho-runner/index.html?debug=dead&cidades=40"
   ```

   Teste sempre pelo menos **1280×720** e **500×780**.

## Estrutura

```text
.
├── index.html                  # redireciona para gaucho-runner/
├── municipios.xlsx             # fonte dos municípios (IBGE)
├── gaucho-runner/
│   ├── index.html              # carrega municipios.js e game.js
│   ├── style.css               # página em tela cheia, cursor, fundo
│   ├── game.js                 # jogo inteiro (lógica, desenho, áudio)
│   ├── municipios.js           # window.MUNICIPIOS (497 nomes, ordenados)
│   ├── README.md               # documentação do jogo
│   └── *.jpg                   # referências visuais
└── AGENTS.md
```

### Arquivos que não devem ser editados manualmente

- `gaucho-runner/municipios.js`: é gerado a partir de `municipios.xlsx`.
  Se o Excel mudar, regenere a lista (497 nomes, sem cabeçalho e sem a linha
  “Fonte: IBGE”), ordenando com comparação sem acentos e preservando os
  acentos no texto.
- Os sprites de cavalo e quero-quero estão como `data:image/png;base64,...`
  dentro de `game.js`. São linhas enormes; evite reformatá-las ou movê-las.
  O cavalo/cavaleiro é afinado no carregamento por `thinFrameImage()`; o
  `RUNNER_THIN_RADIUS` controla a erosão do contorno (mantendo as áreas cheias).

## Invariantes do jogo (não reintroduzir)

- **Progresso**: `game.conquered` é a única medida de avanço. Exiba o número
  sem zeros à esquerda (`1`, `40`, `497`).
- **HUD**: o município só aparece depois de vencer o primeiro obstáculo.
  O bloco fica centralizado no topo:
  - `MUNICÍPIO 0/497` antes do primeiro (sem nome);
  - `MUNICÍPIO 40/497` + último município conquistado depois.
- **Fim de jogo**:
  - morreu sem conquistar ninguém:
    `Mas bah! Não chegou a lugar nenhum! Tenta de novo, tchê!`
  - derrota normal:
    `Tchê! Tu conquistou N dos 497 municípios gaúchos!`
    e `O último conquistado foi NOME` (sem ponto e vírgula).
  - vitória no 497º:
    `O RS é teu!` e
    `Parabéns por conquistar os 497 municípios gaúchos`.
- **Botões do fim**: `JOGAR DE NOVO` e `MENU`. Só os botões são clicáveis;
  clicar fora não reinicia. O cursor de mão aparece **somente** sobre botões.
- **Aviso do primeiro obstáculo**: deve ser grande, no mesmo tamanho/negrito
  das mensagens de resultado, e usar o texto exato acima.
- **Número e nome em negrito** no HUD e no resultado (peso 700).
- **Fundo**: `#F7F7F7`, o mesmo cinza-claro do jogo do dinossauro do Google.
  A paleta tem fundo, tinta e um tom extra só para nuvens. No dia:
  fundo `#F7F7F7`, tinta `#1E1C18`, nuvem `#D8D8D8`.
- **Fontes**: a home, o HUD e o fim de jogo usam `UI_FONT` (pilha monoespaçada:
  Consolas / Lucida Console / Courier New), sem fonte pixelada. A home usa
  `drawMenuText()` desenhado depois do upscale. Acentos e ç são esperados.
- **Dificuldade**: começa fácil e piora com os municípios conquistados.
  Velocidade de `5.5` a `11.5`. Primeiros 15 obstáculos: só pedra/capim baixos.
  Primeiros 40: isolados. Quero-quero isolado por volta de 20; duplas e trios
  com tipos intercalados a partir de 40; pássaro sobre obstáculo por 70;
  pássaro + obstáculo por 120; trio por 200; mourão + obstáculo por 280.
  Obstáculos: capim, pedra, arbusto, cerca, tronco e mourão, com tamanhos
  variados e sem repetir o mesmo tipo em sequência.
- **Personagem**: `RUNNER_SCALE = 0.85` (15% menor). O sprite e a hitbox são
  escalados; não mude só um dos dois.
- **Sem abaixar**: o personagem só pula; não existe pose agachada nem controle
  de abaixar (`↓`/`S` não fazem nada durante a corrida).
- **Mobile**: em `(pointer: coarse)` o chão sobe para reservar a faixa dos
  controles de toque, que é o botão DOM `PULAR` no rodapé. As
  safe areas usam o probe CSS + `env()`. Há um aviso para jogar na horizontal
  em celular em pé. Não reintroduza controles só dentro do canvas.
- **Ciclo dia/noite**: a cada 100 municípios conquistados.
- **Recorde**: `localStorage["gaucho.record"]` guarda o máximo de municípios;
  `gaucho.muted` guarda o som. Não use `gaucho.hi` (pontuação antiga).

## Código

- `game.js` é um IIFE em `'use strict'`, com 2 espaços de indentação,
  ponto e vírgula e comentários em português.
- Fluxo principal:
  - `startGame()` / `resetRun()` — inicia a corrida;
  - `update()` — relógio fixo de 60 Hz, física, obstáculos e conquistas;
  - `spawnWave()` — escolhe e cria os padrões; `nextGround()`/`nextPost()`/
    `nextBird()` registram o último tipo para intercalar sem repetir;
  - `conquerCity()` / `win()` / `crash()` — progresso, vitória e derrota;
  - `render()` — desenha a cena, posteriza e amplia;
  - `drawMenuText()`, `drawMunicipioHud()`, `drawGameOver()` — texto nítido
    em pixels CSS depois do upscale.
- A cena é desenhada em baixa resolução no canvas `art`, posterizada para 3
  tons e ampliada com nearest-neighbor. Texto de interface é desenhado no
  canvas final, em pixels CSS, para ficar nítido.
- `game.status`: `waiting | running | crashed | won`.
- O jogo pausa a simulação em `crashed`/`won` (o cenário pode continuar
  animando), e os botões do painel controlam reinício/menu.
- O obstáculo conta como vencido quando `x + w < runnerBox().x`; não conte
  obstáculos que ainda estão à frente do personagem.
- Os botões do fim são desenhados no espaço CSS; as hitboxes são convertidas
  para unidades lógicas (`W`/`H`) para o `pointerdown` funcionar.
- **Controles de toque:** botão DOM `PULAR` em `#touch-controls`, visível em
  `body.touch.playing`; usa `jump()`/`cutJump()`.

## Debug

Parâmetros de URL (em `gaucho-runner/index.html`):

- `?debug=run` / `?debug=jump` / `?debug=dead` / `?debug=win` — cena estática
  (`win` mostra a tela de vitória no 497º);
- `&night=1` — força noite;
- `&boxes=1` — mostra hitboxes;
- `&cidades=40` — define quantos municípios já foram conquistados;
- `&touch=1` — força o layout/controles de toque no desktop;
- `&rotate=0` — esconde o aviso de paisagem;
- `?screen=about` / `?screen=contact` — abre os painéis.

Os antigos `&score=` e `&sec=` foram removidos; não os reintroduza.

## Antes de finalizar

- Rode `node --check` nos dois arquivos JS.
- Abra/inspecione o jogo e confira:
  - HUD no começo (sem nome), depois do primeiro obstáculo (nome) e no 497º;
  - morte no primeiro obstáculo (mensagem “Mas bah!”);
  - vitória no 497º (“O RS é teu!”);
  - botões **JOGAR DE NOVO** e **MENU**, clique fora e cursor;
  - fundo cinza-claro, home na fonte monoespaçada;
  - mobile com `?debug=run&touch=1&rotate=0`: botão **PULAR**,
    chão levantado e safe areas;
  - telas estreitas (500×780), sem texto estourando.
- Ao alterar `game.js`, `municipios.js` ou `style.css`, suba o `?v=` em
  `gaucho-runner/index.html` para evitar cache antigo.
- Mantenha o texto em UTF-8. Prefira as ferramentas de edição do agente a
  reescrever arquivos inteiros pelo PowerShell, que já causou problemas de
  codificação neste projeto.
