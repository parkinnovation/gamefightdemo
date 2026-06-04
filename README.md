# Game Fight Demo

Jogo de luta 1x1 em estilo Street Fight com:

- selecao de personagem
- luta jogador vs CPU
- barra de energia
- rounds (melhor de 3)

## Estrutura de assets

Coloque os assets do Drive nestas pastas:

```text
assets/
  character1/
    idle/1.png ... 12.png
    walk/1.png ... 12.png
    jump/1.png ... 12.png
    attack1/1.png ... 12.png
    attack2/1.png ... 12.png
    hurt/1.png ... 12.png
    ko/1.png ... 12.png
  character2/
    ...
  character3/
    ...
```

Se algum sprite nao existir, o jogo usa fallback visual automaticamente.

## Como executar

Abra `index.html` no navegador.

Controles:

- `A/D`: mover
- `W`: pular
- `J`: ataque 1
- `K`: ataque 2
