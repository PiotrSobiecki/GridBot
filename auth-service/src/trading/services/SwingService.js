import Decimal from "decimal.js";

/**
 * Zwraca swingPercent dla danej ceny i kierunku (kupno/sprzedaż),
 * na podstawie tablic buySwingPercent / sellSwingPercent w ustawieniach zlecenia.
 */
export function getSwingPercent(currentPrice, settings, isBuy) {
  const swingPercents = isBuy
    ? settings.buySwingPercent
    : settings.sellSwingPercent;

  if (!swingPercents || swingPercents.length === 0) {
    return new Decimal(0);
  }

  const price = new Decimal(currentPrice);

  for (const sp of swingPercents) {
    // Sprawdź zakres cen: minPrice <= cena < maxPrice
    if (sp.minPrice != null && price.lt(new Decimal(sp.minPrice))) {
      continue;
    }
    if (sp.maxPrice != null && price.gte(new Decimal(sp.maxPrice))) {
      continue;
    }
    return new Decimal(sp.value || 0);
  }

  return new Decimal(0);
}

/**
 * Uniwersalny trailing-stop swing check.
 *
 * @param {Decimal}  currentPrice   – aktualna cena
 * @param {object}   trackingObj    – obiekt z polami swingHighPrice / swingLowPrice (Position lub GridState)
 * @param {string}   highField      – nazwa pola peak  (np. 'swingHighPrice' / 'swingSellHighPrice')
 * @param {string}   lowField       – nazwa pola trough (np. 'swingLowPrice'  / 'swingBuyLowPrice')
 * @param {Decimal}  swingPercent   – wymagane cofnięcie w %
 * @param {'up'|'down'} favorableDir – kierunek korzystny ('up' = sprzedaż/short open, 'down' = kupno/buyback)
 * @param {boolean}  debug          – czy logować szczegóły (zależne od GRID_DEBUG_CONDITIONS)
 * @returns {{ execute: boolean, updated: boolean }}
 */
export function checkSwingTrailing(
  currentPrice,
  trackingObj,
  highField,
  lowField,
  swingPercent,
  favorableDir,
  debug = false,
) {
  if (swingPercent.eq(0)) return { execute: true, updated: false };

  if (favorableDir === "up") {
    const peak =
      trackingObj[highField] != null
        ? new Decimal(trackingObj[highField])
        : null;

    // Aktualizacja/ustawienie szczytu (peak)
    if (!peak || currentPrice.gt(peak)) {
      if (debug) {
        const prev = peak ? peak.toNumber() : null;
        console.log(
          `🔍 SWING track(up) ${highField}: prevPeak=${prev ?? "-"} newPeak=${currentPrice.toNumber()}`,
        );
      }
      trackingObj[highField] = currentPrice.toNumber();
      return { execute: false, updated: true };
    }

    const retrace = peak.minus(currentPrice).div(peak).mul(100);
    if (retrace.gte(swingPercent)) {
      if (debug) {
        console.log(
          `✅ SWING exec(up) ${highField}: peak=${peak.toNumber()} current=${currentPrice.toNumber()} retrace=${retrace.toDecimalPlaces(4).toString()}% swing=${swingPercent.toString()}%`,
        );
      }
      trackingObj[highField] = null;
      return { execute: true, updated: true };
    }

    return { execute: false, updated: false };
  }

  // favorableDir === 'down'
  const trough =
    trackingObj[lowField] != null
      ? new Decimal(trackingObj[lowField])
      : null;

  // Aktualizacja/ustawienie dołka (trough)
  if (!trough || currentPrice.lt(trough)) {
    if (debug) {
      const prev = trough ? trough.toNumber() : null;
      console.log(
        `🔍 SWING track(down) ${lowField}: prevTrough=${prev ?? "-"} newTrough=${currentPrice.toNumber()}`,
      );
    }
    trackingObj[lowField] = currentPrice.toNumber();
    return { execute: false, updated: true };
  }

  const retrace = currentPrice.minus(trough).div(trough).mul(100);
  if (retrace.gte(swingPercent)) {
    if (debug) {
      console.log(
        `✅ SWING exec(down) ${lowField}: trough=${trough.toNumber()} current=${currentPrice.toNumber()} retrace=${retrace.toDecimalPlaces(4).toString()}% swing=${swingPercent.toString()}%`,
      );
    }
    trackingObj[lowField] = null;
    return { execute: true, updated: true };
  }

  return { execute: false, updated: false };
}

export default {
  getSwingPercent,
  checkSwingTrailing,
};

