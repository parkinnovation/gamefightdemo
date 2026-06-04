# Game Fight Demo

Jogo de luta 1x1 em estilo Street Fight com:

- selecao de personagem
- luta jogador vs CPU
- barra de energia
- rounds (melhor de 3)

## Estrutura de assets

Coloque os assets do Drive nestas pastas:

```text
ASSETSGAME/
  character1/
    idle.png
    walk.png
    jump.png
    attack1.png
    attack2.png
    hurt.png
    ko.png
  character2/
    ...
  character3/
    ...
```

Cada imagem deve ser um spritesheet horizontal com a animacao completa da acao.
O jogo corta a imagem em 12 quadros na ordem da esquerda para a direita.

Se algum sprite nao existir, o jogo usa fallback visual automaticamente.

## Como executar

Abra `index.html` no navegador.

Controles:

- `A/D`: mover
- `W`: pular
- `J`: ataque 1
- `K`: ataque 2
