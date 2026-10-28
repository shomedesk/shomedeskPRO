import React, { useState, useEffect } from 'react';
import { db } from '@/src/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { currencyService } from '@/src/services/currencyService';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface TickerPair {
  from: string;
  to: string;
}

interface TickerSettings {
  enabled: boolean;
  pairs: TickerPair[];
  speed: number;
}

export default function CurrencyTicker() {
  const [settings, setSettings] = useState<TickerSettings | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'systemSettings', 'ticker'), (doc) => {
      if (doc.exists()) {
        setSettings(doc.data() as TickerSettings);
      } else {
        // Default settings
        setSettings({
          enabled: true,
          pairs: [
            { from: 'USD', to: 'OMR' },
            { from: 'USD', to: 'INR' },
            { from: 'USD', to: 'SAR' },
            { from: 'USD', to: 'AED' },
            { from: 'USD', to: 'BDT' }
          ],
          speed: 30
        });
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchRates = async () => {
      const currentRates = await currencyService.getRates('USD');
      setRates(currentRates);
    };

    fetchRates();
    const interval = setInterval(fetchRates, 1000 * 60 * 5); // Update every 5 mins
    return () => clearInterval(interval);
  }, []);

  if (!settings?.enabled || Object.keys(rates).length === 0) return null;

  return (
    <div className="bg-blue-600/10 border-b border-blue-500/20 h-8 flex items-center overflow-hidden whitespace-nowrap z-[60] relative">
      <div className="flex animate-marquee items-center gap-12 px-4">
        {/* Duplicate the list for seamless loop */}
        {[...settings.pairs, ...settings.pairs, ...settings.pairs].map((pair, idx) => {
          // Calculate cross rate based on USD base rates
          // If from is USD, rate is just rates[to]
          // If to is USD, rate is 1 / rates[from]
          // If neither is USD, rate is rates[to] / rates[from]
          
          let displayRate = 0;
          if (pair.from === 'USD') {
            displayRate = rates[pair.to] || 0;
          } else if (pair.to === 'USD') {
            displayRate = rates[pair.from] ? 1 / rates[pair.from] : 0;
          } else {
            const fromRate = rates[pair.from];
            const toRate = rates[pair.to];
            if (fromRate && toRate) {
              displayRate = toRate / fromRate;
            }
          }

          if (!displayRate) return null;
          
          return (
            <div key={`${pair.from}-${pair.to}-${idx}`} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className="text-blue-400">{pair.from}/{pair.to}</span>
              <span className="text-white">{displayRate.toFixed(4)}</span>
              <div className="w-1 h-1 rounded-full bg-blue-500/30" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
