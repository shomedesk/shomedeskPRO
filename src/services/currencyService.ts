import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface ExchangeRates {
  [key: string]: number;
}

class CurrencyService {
  private ratesCache: Record<string, ExchangeRates> = {};
  private lastFetched: number = 0;
  private CACHE_DURATION = 1000 * 60 * 60; // 1 hour
  
  private FALLBACK_RATES: ExchangeRates = {
    'USD': 1,
    'INR': 83.5,
    'BDT': 110.0,
    'EUR': 0.92,
    'GBP': 0.79,
    'AED': 3.67,
    'SAR': 3.75,
    'OMR': 0.38,
    'QAR': 3.64,
    'KWD': 0.31,
    'BHD': 0.38
  };

  async getRates(base: string = 'USD'): Promise<ExchangeRates> {
    // 1. Try to get manual rates from Firestore first (Global Settings)
    try {
      if (auth.currentUser) {
        const settingsDoc = await getDoc(doc(db, 'systemSettings', 'currency'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          if (data.useManualRates && data.rates) {
            return data.rates;
          }
        }
      }
    } catch (e) {
      // Silent fail for manual rates, proceed to API/Cache
    }

    // 2. Use cached rates if valid
    const now = Date.now();
    if (this.ratesCache[base] && (now - this.lastFetched < this.CACHE_DURATION)) {
      return this.ratesCache[base];
    }

    // 3. Fetch from API
    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      if (data.result === 'success') {
        this.ratesCache[base] = data.rates;
        this.lastFetched = now;
        return data.rates;
      }
      throw new Error('API returned failure result');
    } catch (error) {
      // Log as warning instead of error to avoid alarming users if fallback is available
      console.warn('Currency API fetch failed, using fallback rates:', error instanceof Error ? error.message : String(error));
      
      // 4. Fallback logic: If we have ANY cached rates, try to derive from them
      // Otherwise use hardcoded fallbacks
      const baseRates = this.ratesCache['USD'] || this.FALLBACK_RATES;
      
      if (base === 'USD') return baseRates;
      
      // Derive rates for the requested base from USD rates
      const baseToUsd = 1 / (baseRates[base] || 1);
      const derivedRates: ExchangeRates = {};
      for (const [curr, rate] of Object.entries(baseRates)) {
        derivedRates[curr] = rate * baseToUsd;
      }
      return derivedRates;
    }
  }

  async saveManualRates(rates: ExchangeRates, useManual: boolean) {
    await setDoc(doc(db, 'systemSettings', 'currency'), {
      rates,
      useManualRates: useManual,
      updatedAt: new Date().toISOString()
    });
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    if (from === to) return amount;
    const rates = await this.getRates(from);
    const rate = rates[to];
    if (!rate) return amount;
    return amount * rate;
  }

  async convertToINR(amount: number, from: string): Promise<number> {
    return this.convert(amount, from, 'INR');
  }

  formatCurrency(amount: number, currency: string = 'INR'): string {
    const code = (currency || 'OMR').trim().toUpperCase();
    const is3 = ['OMR', 'KWD', 'BHD', 'JOD', 'RO'].includes(code);
    const validCurrencyCode = code === 'RO' ? 'OMR' : code;
    try {
      return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: validCurrencyCode,
        minimumFractionDigits: is3 ? 3 : 2,
        maximumFractionDigits: is3 ? 3 : 2
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(is3 ? 3 : 2)}`;
    }
  }
}

export const currencyService = new CurrencyService();
