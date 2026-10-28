/**
 * Currency and decimal formatting utilities
 * Primary Currency: OMR (Omani Rial) with strict 3 decimal places (e.g. 1.000, 0.000)
 */

export const DEFAULT_CURRENCY = 'OMR';

export function getDecimalPlaces(_currencyCode: string = 'OMR'): number {
  // Global strict requirement: 3 decimal places for all financial and quantity values
  return 3;
}

export function formatAmount(amount: number | string | null | undefined, _currencyCode: string = 'OMR'): string {
  const val = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
  if (isNaN(val)) return '0.000';
  return val.toFixed(3);
}

export function toStrictDecimal3(amount: number | string | null | undefined): number {
  const val = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
  if (isNaN(val)) return 0;
  return Math.round(val * 1000) / 1000;
}

export function formatCurrencyWithSymbol(amount: number | string | null | undefined, currency: string = 'OMR'): string {
  const curr = currency || DEFAULT_CURRENCY;
  return `${curr} ${formatAmount(amount, curr)}`;
}

/**
 * Checks if a product is typically sold by weight (kg) based on measurement or name keywords
 */
export function isWeightItem(name: string = '', measurement: string = ''): boolean {
  const m = (measurement || '').toLowerCase().trim();
  if (['kg', 'g', 'gm', 'gram', 'kilogram', 'weight', 'scale'].includes(m)) return true;
  const n = (name || '').toLowerCase();
  const weightKeywords = [
    'potato', 'potatoes', 'onion', 'onions', 'alu', 'peyaj', 'tomato', 'tomatoes',
    'ginger', 'garlic', 'rice', 'beef', 'chicken', 'mutton', 'meat', 'fish',
    'vegetable', 'fruit', 'apple', 'banana', 'orange', 'sugar', 'salt', 'oil',
    'flour', 'atta', 'maida', 'dal', 'lentil'
  ];
  return weightKeywords.some(keyword => n.includes(keyword));
}

/**
 * Formats item quantity with 3 decimal precision and unit badge
 */
export function formatQuantity(qty: number | string | null | undefined, unit: string = 'pcs'): string {
  const val = typeof qty === 'number' ? qty : parseFloat(String(qty || '0'));
  const safeQty = isNaN(val) ? 0 : val;
  const cleanUnit = (unit || 'pcs').toLowerCase();
  return `${safeQty.toFixed(3)} ${cleanUnit}`;
}
