/**
 * Live Market Rates for Export Avocado Varieties in Kenya.
 * 
 * Flow & Margin Breakdown:
 * 1. Exporter Buyer Pays Manager: 
 *    - Grade A (Export Hass): 160 KES / kg
 *    - Grade B (Local/Proc):  110 KES / kg
 *    - Grade C (Standard):    80 KES / kg
 * 
 * 2. Manager Pays Farmer:
 *    - Grade A: 115 KES / kg
 *    - Grade B: 75 KES / kg
 *    - Grade C: 50 KES / kg
 * 
 * 3. Cooperative Cold-Chain & Transport Balance (Retained by Manager):
 *    - Grade A: 45 KES / kg
 *    - Grade B: 35 KES / kg
 *    - Grade C: 30 KES / kg
 *    (Used for refrigerated transport, cold room storage, export packing, and perishable handling)
 */

const MARKET_RATES = {
  "A": {
    buyerPrice: 160,
    farmerPayoutRate: 115,
    coldChainMargin: 45,
    description: "Grade A Export Hass — Premium export quality"
  },
  "B": {
    buyerPrice: 110,
    farmerPayoutRate: 75,
    coldChainMargin: 35,
    description: "Grade B Processing — Oil extraction & local retail"
  },
  "C": {
    buyerPrice: 80,
    farmerPayoutRate: 50,
    coldChainMargin: 30,
    description: "Grade C Standard — Fresh local consumption"
  }
};

function getMarketRate(grade = "A") {
  const normalized = String(grade).toUpperCase().replace(/GRADE\s*/i, "").trim();
  return MARKET_RATES[normalized] || MARKET_RATES["A"];
}

module.exports = {
  MARKET_RATES,
  getMarketRate
};
