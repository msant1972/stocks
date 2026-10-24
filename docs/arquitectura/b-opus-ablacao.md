# B-Opus — ablação e sensibilidade

Gerado por `scripts/b-opus-ablation.mjs` em 2026-10-24, sobre 296 instrumentos activos (3 anos de histórico, a estratégia actua nos últimos 2; 15 000 € por compra, sem comissões). Resultados indicativos: dois anos de dados não permitem validação fora da amostra.

## Ablação

| Tipo | Configuração | Soma dos resultados | Com ganho / perda | 10 piores | 10 melhores | Operações | Acerto |
|---|---|---|---|---|---|---|---|
| — | full (por omissão) | 126 035 € | 125 / 122 | -36 319 € | 80 466 € | 852 | 40% |
| remover | no_trend_strength | 403 603 € | 153 / 131 | -50 999 € | 144 913 € | 2551 | 41% |
| substituir | adx_instead_of_er | 315 280 € | 154 / 124 | -44 254 € | 136 653 € | 1869 | 41% |
| remover | no_time_stop | 130 318 € | 125 / 122 | -35 221 € | 80 466 € | 843 | 40% |
| adicionar | with_volume_confirmation | 119 460 € | 115 / 128 | -32 883 € | 82 248 € | 749 | 41% |
| adicionar | with_pullback_entry | 107 176 € | 117 / 127 | -27 257 € | 67 926 € | 688 | 45% |
| adicionar | with_overextension_block | 57 022 € | 91 / 97 | -27 139 € | 44 478 € | 447 | 43% |
| adicionar | with_partial_take_profit | 132 670 € | 119 / 128 | -31 331 € | 73 728 € | 852 | 42% |
| substituir | monthly_review | 7072 € | 90 / 127 | -28 376 € | 56 051 € | 511 | 38% |

## Sensibilidade (um parâmetro de cada vez)

| Configuração | Soma dos resultados | Com ganho / perda | 10 piores | 10 melhores | Operações | Acerto |
|---|---|---|---|---|---|---|
| por omissão | 126 035 € | 125 / 122 | -36 319 € | 80 466 € | 852 | 40% |
| smaTrendFast = 40 (omissão 50) | 125 986 € | 125 / 123 | -35 821 € | 80 466 € | 859 | 40% |
| smaTrendFast = 60 (omissão 50) | 114 864 € | 123 / 124 | -37 137 € | 80 561 € | 843 | 40% |
| smaTrendSlow = 150 (omissão 200) | 131 344 € | 125 / 123 | -34 734 € | 80 919 € | 857 | 40% |
| smaTrendSlow = 250 (omissão 200) | 123 101 € | 125 / 122 | -35 106 € | 80 466 € | 852 | 40% |
| m1Fast = 5 (omissão 10) | 126 035 € | 125 / 122 | -36 319 € | 80 466 € | 852 | 40% |
| m1Fast = 20 (omissão 10) | 125 234 € | 124 / 123 | -36 319 € | 80 466 € | 853 | 40% |
| m1Slow = 100 (omissão 125) | 125 731 € | 125 / 122 | -36 319 € | 80 466 € | 852 | 40% |
| m1Slow = 150 (omissão 125) | 124 272 € | 125 / 122 | -36 319 € | 80 466 € | 856 | 40% |
| m2Lookback = 126 (omissão 252) | 121 859 € | 124 / 135 | -37 976 € | 81 362 € | 877 | 40% |
| m2Lookback = 189 (omissão 252) | 100 427 € | 118 / 134 | -35 410 € | 78 820 € | 859 | 40% |
| m2Skip = 0 (omissão 21) | 126 017 € | 120 / 132 | -35 528 € | 86 480 € | 869 | 39% |
| m2Skip = 10 (omissão 21) | 121 264 € | 117 / 134 | -35 576 € | 84 778 € | 865 | 40% |
| atrN = 14 (omissão 22) | 111 543 € | 120 / 127 | -38 237 € | 88 681 € | 850 | 39% |
| atrN = 30 (omissão 22) | 109 080 € | 116 / 131 | -39 312 € | 83 983 € | 865 | 40% |
| stopMult = 2.5 (omissão 3) | 67 802 € | 112 / 135 | -33 713 € | 69 804 € | 959 | 37% |
| stopMult = 3.5 (omissão 3) | 138 571 € | 121 / 126 | -41 106 € | 92 851 € | 771 | 42% |
| stopMult = 4 (omissão 3) | 170 958 € | 122 / 125 | -44 327 € | 101 214 € | 701 | 45% |
| erThreshold = 0.2 (omissão 0.25) | 155 353 € | 121 / 148 | -40 572 € | 99 588 € | 1227 | 39% |
| erThreshold = 0.3 (omissão 0.25) | 61 042 € | 104 / 110 | -25 587 € | 59 351 € | 550 | 41% |
| timeStopSessions = 10 (omissão 20) | 139 024 € | 128 / 119 | -32 371 € | 80 342 € | 870 | 41% |
| timeStopSessions = 40 (omissão 20) | 130 318 € | 125 / 122 | -35 221 € | 80 466 € | 843 | 40% |
| cooldownSessions = 5 (omissão 10) | 95 426 € | 118 / 129 | -38 668 € | 71 759 € | 944 | 40% |
| cooldownSessions = 20 (omissão 10) | 114 616 € | 121 / 126 | -34 247 € | 74 109 € | 760 | 41% |
| gapProtectAtr = 0.5 (omissão 1) | 119 916 € | 123 / 124 | -34 761 € | 80 489 € | 843 | 40% |
| gapProtectAtr = 2 (omissão 1) | 107 473 € | 124 / 123 | -39 383 € | 71 725 € | 856 | 40% |
