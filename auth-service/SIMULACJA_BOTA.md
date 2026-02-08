# Symulacja działania GridBota

## Wypełnione pola (ustawienia)

| Pole                              | Wartość                                          |
| --------------------------------- | ------------------------------------------------ |
| focusPrice                        | 94000                                            |
| minProfitPercent                  | 0.5%                                             |
| buyConditions.priceThreshold      | 100000                                           |
| buyConditions.minValuePer1Percent | 200                                              |
| sellConditions.priceThreshold     | 89000                                            |
| trendPercents (0,1,2,5,10)        | buy%: 0.5,1,0.6,0.5,0.1 / sell%: 0.5,1,0.3,0.5,1 |

## Przebieg symulacji (kolejne ceny)

| Krok | Opis                                       | Cena  | Focus | Trend | Nast. zakup | Nast. sprzedaż | Kupno? | Sprzedaż?       | Wykonanie                                              |
| ---- | ------------------------------------------ | ----- | ----- | ----- | ----------- | -------------- | ------ | --------------- | ------------------------------------------------------ |
| 1    | Start (focus)                              | 94000 | 94000 | 0     | 93530       | 94470          | nie    | —               | —                                                      |
| 2    | Cena spada → cel zakupu 93530 → KUPNO      | 93500 | 94000 | 0     | 93530       | 94470          | TAK    | —               | BUY @ 93500, value=135.00, targetSell=93967.5, trend→1 |
| 3    | Cena spada (bez 2. zakupu – cel 92650)     | 93000 | 93500 | 1     | 92565       | 94435          | nie    | —               | —                                                      |
| 4    | Cena spada (cel 92565 – cena za wysoka)    | 92800 | 93500 | 1     | 92565       | 94435          | nie    | —               | —                                                      |
| 5    | Cena w górę (bez akcji)                    | 93200 | 93500 | 1     | 92565       | 94435          | nie    | —               | —                                                      |
| 6    | Cena w górę (bez sprzedaży)                | 93600 | 93500 | 1     | 92565       | 94435          | nie    | —               | —                                                      |
| 7    | Cena ≥ cel sprzedaży 1. pozycji → SPRZEDAŻ | 93980 | 93500 | 1     | 92565       | 94435          | nie    | 93500 → 93967.5 | SELL @ 93980, profit=0.69, focus→93980, trend→0        |
| 8    | Po sprzedaży focus=93980, trend=0          | 93900 | 93980 | 0     | 93510.1     | 94449.9        | nie    | —               | —                                                      |

## Stan końcowy

- **Focus:** 93980
- **Trend (zakup):** 0
- **Następny cel zakupu:** 93510.1
- **Następny cel sprzedaży:** 94449.9
- **Otwarte pozycje:** 0
- **Całkowity zysk (symulacja):** 0.69
- **Liczba transakcji kupna:** 1
- **Liczba transakcji sprzedaży:** 1

## Krótki opis działania

1. **Zakup:** Gdy cena spadnie **co najmniej** do `nextBuyTarget` (focus − trend%) i spełniony jest min. wahanie (swing), bot kupuje. Wartość transakcji zależy od trendu i zakresów cen (minValuePer1Percent, additionalBuyValues, maxBuyPerTransaction).
2. **Cel sprzedaży:** Dla każdej pozycji liczy się `targetSellPrice = cena_zakupu * (1 + minProfitPercent%)`. Gdy cena rynkowa ≥ targetSellPrice, bot sprzedaje z zyskiem.
3. **Focus:** Po zakupie focus = cena zakupu; po sprzedaży focus = cena sprzedaży. Od focus zależą następne cele (nextBuyTarget, nextSellTarget).
4. **Trend:** Rośnie po każdym zakupie (do max z trendPercents), spada po każdej sprzedaży. Wpływa na % odchylenia celu i na wartość transakcji.
