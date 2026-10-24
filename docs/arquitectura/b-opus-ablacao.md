# B-Opus — ablação e sensibilidade

Gerado por `scripts/b-opus-ablation.mjs` em 2026-10-24, sobre 296 instrumentos activos (3 anos de histórico, a estratégia actua nos últimos 2; 15 000 € por compra, sem comissões). Resultados indicativos: dois anos de dados não permitem validação fora da amostra.

## Ablação

| Tipo | Configuração | Soma dos resultados | Com ganho / perda | 10 piores | 10 melhores | Operações | Acerto |
|---|---|---|---|---|---|---|---|
| — | full (por omissão, versão B) | 840 975 € | 135 / 149 | -59 529 € | 467 148 € | 1937 | 35% |
| referência | original (especificação: ER, stop 3 × ATR, sem reforços) | 126 035 € | 125 / 122 | -36 319 € | 80 466 € | 852 | 40% |
| remover | no_adds | 495 862 € | 160 / 124 | -53 872 € | 176 080 € | 1937 | 42% |
| adicionar | with_er | 220 967 € | 105 / 142 | -50 617 € | 217 830 € | 701 | 38% |
| substituir | adx | 703 851 € | 130 / 148 | -67 694 € | 422 412 € | 1483 | 36% |
| remover | no_time_stop | 852 623 € | 139 / 145 | -61 839 € | 464 666 € | 1883 | 35% |
| adicionar | with_volume_confirmation | 709 399 € | 132 / 146 | -55 725 € | 373 966 € | 1544 | 37% |
| adicionar | with_pullback_entry | 548 926 € | 125 / 158 | -62 951 € | 377 854 € | 1674 | 35% |
| adicionar | with_overextension_block | 831 096 € | 134 / 139 | -54 533 € | 443 998 € | 1331 | 39% |
| adicionar | with_partial_take_profit | 799 351 € | 142 / 142 | -56 475 € | 403 726 € | 1937 | 37% |
| substituir | monthly_review | 559 214 € | 114 / 164 | -66 131 € | 412 612 € | 1438 | 33% |

## Sensibilidade (um parâmetro de cada vez)

| Configuração | Soma dos resultados | Com ganho / perda | 10 piores | 10 melhores | Operações | Acerto |
|---|---|---|---|---|---|---|
| por omissão | 840 975 € | 135 / 149 | -59 529 € | 467 148 € | 1937 | 35% |
| smaTrendFast = 40 (omissão 50) | 832 977 € | 135 / 148 | -62 648 € | 468 583 € | 1969 | 35% |
| smaTrendFast = 60 (omissão 50) | 836 683 € | 136 / 147 | -60 769 € | 463 253 € | 1921 | 35% |
| smaTrendSlow = 150 (omissão 200) | 835 682 € | 139 / 144 | -55 457 € | 460 951 € | 1932 | 35% |
| smaTrendSlow = 250 (omissão 200) | 829 934 € | 137 / 147 | -67 577 € | 467 872 € | 1975 | 35% |
| m1Fast = 5 (omissão 10) | 862 934 € | 134 / 150 | -55 453 € | 472 833 € | 1983 | 35% |
| m1Fast = 20 (omissão 10) | 835 832 € | 135 / 148 | -63 338 € | 471 447 € | 1946 | 36% |
| m1Slow = 100 (omissão 125) | 730 818 € | 137 / 147 | -53 590 € | 400 304 € | 1909 | 35% |
| m1Slow = 150 (omissão 125) | 868 476 € | 134 / 149 | -59 518 € | 467 892 € | 1987 | 35% |
| m2Lookback = 126 (omissão 252) | 824 684 € | 137 / 150 | -63 444 € | 446 304 € | 2079 | 37% |
| m2Lookback = 189 (omissão 252) | 819 451 € | 130 / 157 | -66 816 € | 452 597 € | 1992 | 36% |
| m2Skip = 0 (omissão 21) | 870 793 € | 137 / 146 | -63 037 € | 468 205 € | 1887 | 34% |
| m2Skip = 10 (omissão 21) | 818 248 € | 138 / 146 | -64 310 € | 459 363 € | 1913 | 35% |
| atrN = 14 (omissão 22) | 820 986 € | 135 / 149 | -54 536 € | 495 393 € | 1949 | 35% |
| atrN = 30 (omissão 22) | 879 899 € | 136 / 148 | -58 932 € | 481 886 € | 1949 | 35% |
| stopMult = 3 (omissão 4) | 622 199 € | 134 / 150 | -53 165 € | 318 176 € | 2551 | 38% |
| stopMult = 5 (omissão 4) | 982 543 € | 125 / 159 | -76 169 € | 550 886 € | 1615 | 31% |
| stopMult = 6 (omissão 4) | 852 717 € | 119 / 165 | -86 788 € | 497 154 € | 1387 | 31% |
| erThreshold = 0.2 (omissão 0.25) | 840 975 € | 135 / 149 | -59 529 € | 467 148 € | 1937 | 35% |
| erThreshold = 0.3 (omissão 0.25) | 840 975 € | 135 / 149 | -59 529 € | 467 148 € | 1937 | 35% |
| timeStopSessions = 10 (omissão 20) | 863 684 € | 139 / 145 | -58 451 € | 453 932 € | 2088 | 36% |
| timeStopSessions = 40 (omissão 20) | 856 296 € | 139 / 145 | -61 839 € | 464 666 € | 1889 | 36% |
| cooldownSessions = 5 (omissão 10) | 882 306 € | 132 / 152 | -77 970 € | 451 355 € | 2144 | 35% |
| cooldownSessions = 20 (omissão 10) | 620 503 € | 124 / 160 | -55 111 € | 407 398 € | 1679 | 35% |
| gapProtectAtr = 0.5 (omissão 1) | 843 504 € | 136 / 147 | -61 475 € | 466 790 € | 1917 | 35% |
| gapProtectAtr = 2 (omissão 1) | 844 514 € | 135 / 149 | -59 691 € | 467 148 € | 1938 | 35% |
| addOnGain = 0.05 (omissão 0.1) | 1 186 173 € | 129 / 155 | -89 564 € | 638 885 € | 1937 | 28% |
| addOnGain = 0.15 (omissão 0.1) | 721 128 € | 147 / 137 | -59 064 € | 374 495 € | 1937 | 40% |
| addOnGain = 0.2 (omissão 0.1) | 656 278 € | 153 / 131 | -54 461 € | 323 471 € | 1937 | 42% |
| maxAdds = 2 (omissão 5) | 785 976 € | 135 / 149 | -59 529 € | 368 442 € | 1937 | 35% |
| maxAdds = 0 (omissão 5) | 838 018 € | 135 / 149 | -59 529 € | 466 197 € | 1937 | 35% |
