/**
 * Symulacja działania GridBota – czysta logika bez bazy i giełdy.
 * Uruchom: node scripts/simulate-gridbot.js
 */
import Decimal from "decimal.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRICE_SCALE = 2;

// ========== USTAWIENIA (wypełnione jak w UI) ==========
const settings = {
  focusPrice: 94000,
  minProfitPercent: 0.5,
  buyConditions: {
    minValuePer1Percent: 200,
    priceThreshold: 100000,
    checkThresholdIfProfitable: true,
  },
  sellConditions: {
    minValuePer1Percent: 200,
    priceThreshold: 89000,
    checkThresholdIfProfitable: true,
  },
  trendPercents: [
    { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 1, buyPercent: 1, sellPercent: 1 },
    { trend: 2, buyPercent: 0.6, sellPercent: 0.3 },
    { trend: 5, buyPercent: 0.5, sellPercent: 0.5 },
    { trend: 10, buyPercent: 0.1, sellPercent: 1 },
  ],
  additionalBuyValues: [
    { minPrice: 0, maxPrice: 89000, value: 250 },
    { minPrice: 89000, maxPrice: 100000, value: 70 },
    { minPrice: 100000, maxPrice: null, value: 50 },
  ],
  maxBuyPerTransaction: [
    { minPrice: 0, maxPrice: 89000, value: 2000 },
    { minPrice: 89000, maxPrice: 100000, value: 700 },
    { minPrice: 100000, maxPrice: null, value: 500 },
  ],
  buySwingPercent: [
    { minPrice: 0, maxPrice: 90000, value: 0.1 },
    { minPrice: 90000, maxPrice: 95000, value: 0.2 },
    { minPrice: 95000, maxPrice: 100000, value: 0.5 },
    { minPrice: 100000, maxPrice: null, value: 1 },
  ],
  sellSwingPercent: [
    { minPrice: 0, maxPrice: 90000, value: 0.1 },
    { minPrice: 90000, maxPrice: 95000, value: 0.2 },
    { minPrice: 95000, maxPrice: 100000, value: 0.5 },
    { minPrice: 100000, maxPrice: null, value: 1 },
  ],
  platform: { minTransactionValue: 0 },
};

function getTrendPercent(trend, isBuy) {
  const trendPercents = settings.trendPercents;
  let result = trendPercents[0];
  for (const tp of trendPercents) {
    if (tp.trend <= trend) result = tp;
  }
  const percent = isBuy ? result.buyPercent : result.sellPercent;
  return new Decimal(percent || 0.5);
}

function calculateNextBuyTarget(focusPrice, trend) {
  const fp = new Decimal(focusPrice);
  const trendPercent = getTrendPercent(trend, true);
  const decrease = fp.mul(trendPercent).div(100);
  return fp.minus(decrease).toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);
}

function calculateNextSellTarget(focusPrice, trend) {
  const fp = new Decimal(focusPrice);
  const trendPercent = getTrendPercent(trend, false);
  const increase = fp.mul(trendPercent).div(100);
  return fp.plus(increase).toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_UP);
}

function matchesThreshold(price, threshold) {
  const p = new Decimal(price);
  if (threshold.minPrice != null && p.lt(new Decimal(threshold.minPrice)))
    return false;
  if (threshold.maxPrice != null && p.gte(new Decimal(threshold.maxPrice)))
    return false;
  return true;
}

function getSwingPercent(currentPrice, isBuy) {
  const swingPercents = isBuy
    ? settings.buySwingPercent
    : settings.sellSwingPercent;
  const price = new Decimal(currentPrice);
  for (const sp of swingPercents) {
    if (sp.minPrice != null && price.lt(new Decimal(sp.minPrice))) continue;
    if (sp.maxPrice != null && price.gte(new Decimal(sp.maxPrice))) continue;
    return new Decimal(sp.value || 0);
  }
  return new Decimal(0);
}

function meetsMinSwing(previousPrice, currentPrice, trend, isBuy) {
  const minSwingPercent = getSwingPercent(currentPrice, isBuy);
  if (minSwingPercent.eq(0)) return true;
  const priceDiff = new Decimal(previousPrice).minus(currentPrice).abs();
  const percentChange = priceDiff.div(previousPrice).mul(100);
  return percentChange.gte(minSwingPercent);
}

function calculateTransactionValue(currentPrice, trend, isBuy) {
  const trendPercent = getTrendPercent(trend, isBuy);
  let minValuePer1Percent = new Decimal(
    isBuy
      ? settings.buyConditions.minValuePer1Percent
      : settings.sellConditions.minValuePer1Percent,
  );
  let baseValue = minValuePer1Percent.mul(trendPercent);
  const additionalValues = isBuy
    ? settings.additionalBuyValues
    : settings.additionalSellValues;
  for (const threshold of additionalValues) {
    if (matchesThreshold(currentPrice, threshold)) {
      baseValue = baseValue.plus(
        new Decimal(threshold.value || 0).mul(trendPercent),
      );
      break;
    }
  }
  const maxValues = settings.maxBuyPerTransaction;
  for (const threshold of maxValues) {
    if (matchesThreshold(currentPrice, threshold)) {
      const maxVal = new Decimal(threshold.value || 10000);
      if (baseValue.gt(maxVal)) baseValue = maxVal;
      break;
    }
  }
  return baseValue.toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);
}

// ========== STAN SYMULOWANY ==========
let state = {
  currentFocusPrice: settings.focusPrice,
  buyTrendCounter: 0,
  sellTrendCounter: 0,
  nextBuyTarget: null,
  nextSellTarget: null,
  lastKnownPrice: settings.focusPrice,
  openPositions: [], // { buyPrice, amount, buyValue, targetSellPrice, trendAtBuy }
  totalProfit: 0,
  totalBuyTransactions: 0,
  totalSellTransactions: 0,
};

function recalcTargets() {
  state.nextBuyTarget = calculateNextBuyTarget(
    state.currentFocusPrice,
    state.buyTrendCounter,
  ).toNumber();
  state.nextSellTarget = calculateNextSellTarget(
    state.currentFocusPrice,
    state.buyTrendCounter,
  ).toNumber();
}

// Inicjalizacja
recalcTargets();

const log = [];
function step(price, label) {
  const p = new Decimal(price);
  state.lastKnownPrice = price;

  // 1) Próg cenowy – czy w ogóle wolno kupować
  const buyThreshold = settings.buyConditions.priceThreshold;
  const aboveBuyThreshold = buyThreshold && p.gt(buyThreshold);
  const canBuyByThreshold =
    !aboveBuyThreshold ||
    (state.totalProfit > 0 &&
      !settings.buyConditions.checkThresholdIfProfitable);

  // 2) Cel zakupu
  const buyTarget = state.nextBuyTarget;
  const priceAtOrBelowBuyTarget = p.lte(buyTarget);
  const swingOkBuy = meetsMinSwing(
    state.currentFocusPrice,
    price,
    state.buyTrendCounter,
    true,
  );

  const wouldBuy = canBuyByThreshold && priceAtOrBelowBuyTarget && swingOkBuy;

  // 3) Sprzedaż pozycji (czy cena >= targetSellPrice którejś pozycji)
  let wouldSellPosition = null;
  for (const pos of state.openPositions) {
    if (p.gte(pos.targetSellPrice)) {
      wouldSellPosition = pos;
      break;
    }
  }

  const row = {
    step: log.length + 1,
    label,
    price,
    focus: state.currentFocusPrice,
    trend: state.buyTrendCounter,
    nextBuyTarget: state.nextBuyTarget,
    nextSellTarget: state.nextSellTarget,
    aboveBuyThreshold,
    canBuyByThreshold,
    priceAtOrBelowBuyTarget,
    swingOkBuy,
    wouldBuy,
    wouldSellPosition: wouldSellPosition
      ? `${wouldSellPosition.buyPrice} → ${wouldSellPosition.targetSellPrice}`
      : null,
    openPositions: state.openPositions.length,
    totalProfit: state.totalProfit,
  };
  log.push(row);

  // Symulacja wykonania (bez giełdy – tylko aktualizacja stanu)
  if (wouldSellPosition && state.openPositions.length > 0) {
    const pos = state.openPositions.shift();
    const sellValue = new Decimal(pos.amount).mul(price);
    const profit = sellValue.minus(pos.buyValue).toNumber();
    state.totalProfit += profit;
    state.totalSellTransactions += 1;
    state.currentFocusPrice = price;
    state.buyTrendCounter = Math.max(0, state.buyTrendCounter - 1);
    recalcTargets();
    row.executed = `SELL @ ${price}, profit=${profit.toFixed(2)}, focus→${price}, trend→${state.buyTrendCounter}`;
  }

  if (wouldBuy && state.openPositions.length < 10) {
    const trendPercent = getTrendPercent(
      state.buyTrendCounter,
      true,
    ).toNumber();
    const transactionValue = calculateTransactionValue(
      price,
      state.buyTrendCounter,
      true,
    ).toNumber();
    const amount = transactionValue / price;
    const targetSellPrice = new Decimal(price)
      .mul(1 + settings.minProfitPercent / 100)
      .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_UP)
      .toNumber();
    state.openPositions.push({
      buyPrice: price,
      amount,
      buyValue: transactionValue,
      targetSellPrice,
      trendAtBuy: state.buyTrendCounter,
    });
    state.currentFocusPrice = price;
    state.buyTrendCounter = Math.min(state.buyTrendCounter + 1, 10);
    state.totalBuyTransactions += 1;
    recalcTargets();
    row.executed = `BUY @ ${price}, value=${transactionValue.toFixed(2)}, targetSell=${targetSellPrice}, trend→${state.buyTrendCounter}`;
  }

  return row;
}

// ========== SCENARIUSZ CEN ==========
console.log("\n========== SYMULACJA GRIDBOTA ==========\n");

step(94000, "Start (focus)");
step(93500, "Cena spada → cel zakupu 93530 → KUPNO");
step(93000, "Cena spada (bez 2. zakupu – cel 92650)");
step(92800, "Cena spada (cel zakupu 92565 – cena jeszcze za wysoka)");
step(93200, "Cena w górę (bez akcji)");
step(93600, "Cena w górę (bez sprzedaży)");
step(93980, "Cena ≥ cel sprzedaży 1. pozycji → SPRZEDAŻ");
step(93900, "Po sprzedaży focus=93980, trend=0");

// ========== WYNIK ==========
const lines = [];
lines.push("# Symulacja działania GridBota");
lines.push("");
lines.push("## Wypełnione pola (ustawienia)");
lines.push("");
lines.push("| Pole | Wartość |");
lines.push("|------|---------|");
lines.push(`| focusPrice | ${settings.focusPrice} |`);
lines.push(`| minProfitPercent | ${settings.minProfitPercent}% |`);
lines.push(
  `| buyConditions.priceThreshold | ${settings.buyConditions.priceThreshold} |`,
);
lines.push(
  `| buyConditions.minValuePer1Percent | ${settings.buyConditions.minValuePer1Percent} |`,
);
lines.push(
  `| sellConditions.priceThreshold | ${settings.sellConditions.priceThreshold} |`,
);
lines.push(
  `| trendPercents (0,1,2,5,10) | buy%: 0.5,1,0.6,0.5,0.1 / sell%: 0.5,1,0.3,0.5,1 |`,
);
lines.push("");
lines.push("## Przebieg symulacji (kolejne ceny)");
lines.push("");
lines.push(
  "| Krok | Opis | Cena | Focus | Trend | Nast. zakup | Nast. sprzedaż | Kupno? | Sprzedaż? | Wykonanie |",
);
lines.push(
  "|------|------|------|-------|-------|-------------|----------------|--------|-----------|-----------|",
);

for (const r of log) {
  const exec = r.executed || "—";
  lines.push(
    `| ${r.step} | ${r.label} | ${r.price} | ${r.focus} | ${r.trend} | ${r.nextBuyTarget} | ${r.nextSellTarget} | ${r.wouldBuy ? "TAK" : "nie"} | ${r.wouldSellPosition || "—"} | ${exec} |`,
  );
}

lines.push("");
lines.push("## Stan końcowy");
lines.push("");
lines.push(`- **Focus:** ${state.currentFocusPrice}`);
lines.push(`- **Trend (zakup):** ${state.buyTrendCounter}`);
lines.push(`- **Następny cel zakupu:** ${state.nextBuyTarget}`);
lines.push(`- **Następny cel sprzedaży:** ${state.nextSellTarget}`);
lines.push(`- **Otwarte pozycje:** ${state.openPositions.length}`);
lines.push(`- **Całkowity zysk (symulacja):** ${state.totalProfit.toFixed(2)}`);
lines.push(`- **Liczba transakcji kupna:** ${state.totalBuyTransactions}`);
lines.push(`- **Liczba transakcji sprzedaży:** ${state.totalSellTransactions}`);
lines.push("");
lines.push("## Krótki opis działania");
lines.push("");
lines.push(
  "1. **Zakup:** Gdy cena spadnie **co najmniej** do `nextBuyTarget` (focus − trend%) i spełniony jest min. wahanie (swing), bot kupuje. Wartość transakcji zależy od trendu i zakresów cen (minValuePer1Percent, additionalBuyValues, maxBuyPerTransaction).",
);
lines.push(
  "2. **Cel sprzedaży:** Dla każdej pozycji liczy się `targetSellPrice = cena_zakupu * (1 + minProfitPercent%)`. Gdy cena rynkowa ≥ targetSellPrice, bot sprzedaje z zyskiem.",
);
lines.push(
  "3. **Focus:** Po zakupie focus = cena zakupu; po sprzedaży focus = cena sprzedaży. Od focus zależą następne cele (nextBuyTarget, nextSellTarget).",
);
lines.push(
  "4. **Trend:** Rośnie po każdym zakupie (do max z trendPercents), spada po każdej sprzedaży. Wpływa na % odchylenia celu i na wartość transakcji.",
);
lines.push("");

const result = lines.join("\n");
console.log(result);

const outPath = path.join(__dirname, "..", "SIMULACJA_BOTA.md");
fs.writeFileSync(outPath, result, "utf8");
console.log("\n✅ Zapisano wynik do: " + outPath);
