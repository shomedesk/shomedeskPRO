import React, { useState, useEffect } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, setDoc, serverTimestamp, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { 
  Brain, 
  Search, 
  TrendingUp, 
  AlertTriangle, 
  Zap, 
  MessageSquare, 
  Settings as SettingsIcon,
  Loader2,
  ChevronRight,
  ShieldCheck,
  BarChart3,
  X
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { cn } from '@/src/lib/utils';

import { currencyService } from '@/src/services/currencyService';

type AIModel = 'gemini' | 'groq' | 'claude' | 'chatgpt';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: AIModel;
  timestamp: Date;
}

interface AISettings {
  geminiKey?: string;
  groqKey?: string;
  claudeKey?: string;
  chatgptKey?: string;
  preferredModel: AIModel;
}

const MODEL_NICKNAMES: Record<AIModel, string> = {
  gemini: 'Gemini (Answer)',
  groq: 'Groq (Fast Reply)',
  claude: 'Claude (Deep Reply)',
  chatgpt: 'ChatGPT (Smart Reply)'
};

export default function Audit() {
  const { selectedBusiness, isAllBusinessesSelected, businesses, userProfile } = useBusiness();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>({ preferredModel: 'gemini' });
  const [showSettings, setShowSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  useEffect(() => {
    const businessId = isAllBusinessesSelected ? 'global' : selectedBusiness?.id;
    if (!businessId) return;

    const docRef = doc(db, 'aiSettings', businessId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setAiSettings(docSnap.data() as AISettings);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `aiSettings/${businessId}`);
      }
    );

    return () => unsubscribe();
  }, [selectedBusiness, isAllBusinessesSelected]);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const businessId = isAllBusinessesSelected ? 'global' : selectedBusiness?.id;
    if (!businessId) return;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'aiSettings', businessId), {
        ...aiSettings,
        ownerId: isAllBusinessesSelected ? auth.currentUser?.uid : selectedBusiness?.ownerId,
        businessId
      });
      toast.success('AI Settings saved successfully');
      setShowSettings(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `aiSettings/${businessId}`);
      toast.error('Failed to save AI settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: chatInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    const apiKey = getApiKeyForModel(aiSettings.preferredModel);
    if (!apiKey && aiSettings.preferredModel !== 'gemini') {
      toast.error(`Please set the API key for ${MODEL_NICKNAMES[aiSettings.preferredModel]} in settings`);
      setShowSettings(true);
      setIsChatLoading(false);
      return;
    }

    try {
      let resultText = '';
      const prompt = `
        You are a helpful business assistant for ShomeDesk. 
        Context: The user is currently viewing ${isAllBusinessesSelected ? 'all businesses' : `the business "${selectedBusiness?.name}"`}.
        User Question: ${chatInput}
      `;

      if (aiSettings.preferredModel === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: prompt,
        });
        resultText = response.text || 'No response from AI';
      } else {
        resultText = await callOtherAI(aiSettings.preferredModel, apiKey!, prompt);
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: resultText,
        model: aiSettings.preferredModel,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat failed:', error);
      toast.error('Failed to get AI response');
    } finally {
      setIsChatLoading(false);
    }
  };

  const performAudit = async () => {
    if (!selectedBusiness && !isAllBusinessesSelected) {
      toast.error('Please select a business first');
      return;
    }

    const apiKey = getApiKeyForModel(aiSettings.preferredModel);
    if (!apiKey && aiSettings.preferredModel !== 'gemini') {
      toast.error(`Please set the API key for ${MODEL_NICKNAMES[aiSettings.preferredModel]} in settings`);
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setReport(null);

    try {
      const targetBusinesses = isAllBusinessesSelected ? businesses : [selectedBusiness!];
      
      const allData = await Promise.all(targetBusinesses.map(async (business) => {
        let transactions, branches, bankAccounts, dailyReports, suppliers;
        
        try {
          [transactions, branches, bankAccounts, dailyReports, suppliers] = await Promise.all([
            getDocs(query(collection(db, 'transactions'), where('businessId', '==', business.id), orderBy('date', 'desc'), limit(50))),
            getDocs(query(collection(db, 'branches'), where('businessId', '==', business.id))),
            getDocs(query(collection(db, 'bankAccounts'), where('businessId', '==', business.id))),
            getDocs(query(collection(db, 'dailyReports'), where('businessId', '==', business.id), orderBy('date', 'desc'), limit(15))),
            getDocs(query(collection(db, 'suppliers'), where('businessId', '==', business.id)))
          ]);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `business_data/${business.id}`);
          throw error;
        }

        // Convert amounts to INR for global report
        const convertedTransactions = await Promise.all(transactions.docs.map(async (d) => {
          const tData = d.data();
          const inrAmount = await currencyService.convertToINR(tData.amount, business.currency || 'INR');
          return { 
            id: d.id, 
            amount: tData.amount, 
            description: tData.description || '',
            inrAmount, 
            currency: business.currency || 'INR' 
          };
        }));

        const convertedBankAccounts = await Promise.all(bankAccounts.docs.map(async (d) => {
          const bData = d.data();
          const inrBalance = await currencyService.convertToINR(bData.balance, business.currency || 'INR');
          return { 
            ...bData, 
            id: d.id, 
            accountName: bData.accountName,
            balance: bData.balance, 
            inrBalance, 
            currency: business.currency 
          };
        }));

        return {
          businessName: business.name,
          currency: business.currency || 'INR',
          transactions: convertedTransactions,
          branches: branches.docs.map(d => ({ ...d.data(), id: d.id })),
          bankAccounts: convertedBankAccounts,
          reports: dailyReports.docs.map(d => ({ ...d.data(), id: d.id })),
          suppliers: suppliers.docs.map(d => ({ ...d.data(), id: d.id }))
        };
      }));

      const prompt = `
        You are a professional financial auditor and business growth strategist.
        Analyze the following financial data for ${isAllBusinessesSelected ? 'all businesses combined' : `the business "${selectedBusiness?.name}"`} and provide a comprehensive report.
        
        CRITICAL CURRENCY INSTRUCTIONS:
        - For individual items (transactions, accounts), mention their original currency (e.g., USD, BDT).
        - For ALL totals, summaries, and overall analysis, you MUST use INR (Indian Rupee).
        - DO NOT use the "$" symbol unless it is specifically for a USD transaction.
        - Use "₹" or "INR" for all summary values.
        - All data provided below includes a pre-calculated "inrAmount" or "inrBalance" - use these values for your totals.
        
        The report should include:
        1. **Professional Audit**: A summary of the financial health in INR.
        2. **Risk Report**: Identify any potential financial risks or inconsistencies.
        3. **Growth Strategy**: Actionable advice on how to grow and improve profitability.
        4. **Problem Identification**: Highlight specific problems found in the data.

        Data Summary:
        ${allData.map(b => `
        Business: ${b.businessName} (Base Currency: ${b.currency})
        - Branches: ${b.branches.length}
        - Bank Accounts: ${JSON.stringify(b.bankAccounts.map(ba => ({ name: ba.accountName, balance: ba.balance, currency: ba.currency, inrBalance: ba.inrBalance })))}
        - Recent Transactions (Top 10): ${JSON.stringify(b.transactions.slice(0, 10).map(t => ({ desc: t.description, amount: t.amount, currency: t.currency, inrAmount: t.inrAmount })))}
        `).join('\n')}
        
        Overall Summary (Converted to INR):
        - Total Businesses: ${allData.length}
        - Total Branches: ${allData.reduce((acc, b) => acc + b.branches.length, 0)}
        - Total Bank Balance (INR): ₹${allData.reduce((acc, b) => acc + b.bankAccounts.reduce((sum, ba) => sum + ba.inrBalance, 0), 0).toFixed(2)}
        
        Please format the report in professional Markdown. Use clear headings, bullet points, and tables where appropriate.
      `;

      let resultText = '';

      if (aiSettings.preferredModel === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: prompt,
        });
        resultText = response.text || 'No response from AI';
      } else {
        // Fallback or generic fetch for other models (Groq, Claude, ChatGPT)
        // For this implementation, we'll simulate the fetch if keys are provided
        // In a real app, you'd use the respective SDKs or API endpoints
        resultText = await callOtherAI(aiSettings.preferredModel, apiKey!, prompt);
      }

      setReport(resultText);
      toast.success('Audit report generated successfully');
    } catch (error) {
      console.error('Audit failed:', error);
      toast.error('Failed to generate audit report');
    } finally {
      setLoading(false);
    }
  };

  const getApiKeyForModel = (model: AIModel) => {
    switch (model) {
      case 'gemini': return aiSettings.geminiKey;
      case 'groq': return aiSettings.groqKey;
      case 'claude': return aiSettings.claudeKey;
      case 'chatgpt': return aiSettings.chatgptKey;
      default: return undefined;
    }
  };

  const callOtherAI = async (model: AIModel, key: string, prompt: string) => {
    // This is a placeholder for actual API calls to Groq, Claude, ChatGPT
    // Since we can't easily install all SDKs, we'll use a generic fetch pattern
    
    let url = '';
    let body = {};
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    };

    if (model === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      body = {
        model: 'mixtral-8x7b-32768',
        messages: [{ role: 'user', content: prompt }]
      };
    } else if (model === 'chatgpt') {
      url = 'https://api.openai.com/v1/chat/completions';
      body = {
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: prompt }]
      };
    } else if (model === 'claude') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      } as any;
      body = {
        model: 'claude-3-opus-20240229',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error(`API error: ${response.statusText}`);
      const data = await response.json();

      if (model === 'claude') return data.content[0].text;
      return data.choices[0].message.content;
    } catch (error) {
      console.error(`${model} API call failed:`, error);
      return `Error calling ${MODEL_NICKNAMES[model]} API. Please check your API key and network.`;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-50 flex items-center gap-3">
            <Brain className="text-blue-500" size={32} />
            Deep Financial Audit
          </h1>
          <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mt-1">
            AI-Powered Business Intelligence & Growth Strategy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 border border-slate-700"
            >
              <Brain size={18} className="text-blue-400" />
              <span className="hidden sm:inline">{MODEL_NICKNAMES[aiSettings.preferredModel].split(' ')[0]}</span>
              <ChevronRight size={16} className={cn("transition-transform", isModelMenuOpen && "rotate-90")} />
            </button>

            {isModelMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-[#1E293B] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in fade-in zoom-in duration-200">
                <div className="p-3 border-b border-slate-800">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Select Audit Intelligence</p>
                </div>
                {(Object.keys(MODEL_NICKNAMES) as AIModel[]).map((model) => (
                  <button
                    key={model}
                    onClick={() => {
                      setAiSettings({ ...aiSettings, preferredModel: model });
                      setIsModelMenuOpen(false);
                    }}
                    className={cn(
                      "w-full p-4 text-left hover:bg-slate-800 transition-all flex flex-col gap-1",
                      aiSettings.preferredModel === model ? "bg-blue-600/10 text-blue-400" : "text-slate-400"
                    )}
                  >
                    <span className="text-xs font-black uppercase tracking-widest">{MODEL_NICKNAMES[model]}</span>
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      {model === 'gemini' ? 'Google Pro 1.5' : model === 'groq' ? 'Mixtral 8x7b' : model === 'claude' ? 'Claude 3 Opus' : 'GPT-4 Turbo'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {userProfile?.role !== 'accountant' && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 border border-slate-700"
            >
              <SettingsIcon size={18} />
              AI Settings
            </button>
          )}
          <button
            onClick={performAudit}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-3 px-8 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-xl shadow-blue-900/20"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
            Run Deep Audit
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-black text-slate-50 flex items-center gap-2">
              <SettingsIcon className="text-blue-500" size={22} />
              AI Model Configuration
            </h2>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-slate-300">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={saveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Preferred Model</label>
                <select
                  value={aiSettings.preferredModel}
                  onChange={(e) => setAiSettings({ ...aiSettings, preferredModel: e.target.value as AIModel })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500"
                >
                  <option value="gemini">Gemini (Answer)</option>
                  <option value="groq">Groq (Fast Reply)</option>
                  <option value="claude">Claude (Deep thinking)</option>
                  <option value="chatgpt">ChatGPT (Smart)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Gemini API Key (Optional)</label>
                <input
                  type="password"
                  value={aiSettings.geminiKey || ''}
                  maxLength={200}
                  onChange={(e) => setAiSettings({ ...aiSettings, geminiKey: e.target.value })}
                  placeholder="Leave empty to use system key"
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Groq API Key</label>
                <input
                  type="password"
                  value={aiSettings.groqKey || ''}
                  maxLength={200}
                  onChange={(e) => setAiSettings({ ...aiSettings, groqKey: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Claude API Key</label>
                <input
                  type="password"
                  value={aiSettings.claudeKey || ''}
                  maxLength={200}
                  onChange={(e) => setAiSettings({ ...aiSettings, claudeKey: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">ChatGPT API Key</label>
                <input
                  type="password"
                  value={aiSettings.chatgptKey || ''}
                  maxLength={200}
                  onChange={(e) => setAiSettings({ ...aiSettings, chatgptKey: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="md:col-span-2 pt-4">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all active:scale-95"
              >
                {isSavingSettings ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Save AI Configuration'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && (
        <div className="bg-[#1E293B] p-12 rounded-3xl border border-slate-800 shadow-2xl flex flex-col items-center justify-center space-y-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse"></div>
            <Brain className="text-blue-500 animate-bounce relative" size={64} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-slate-50">Analyzing Financial Database...</h3>
            <p className="text-slate-400 max-w-md mx-auto">
              Our AI is exploring your complete financial records to provide a professional audit, risk report, and growth strategy.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
          </div>
        </div>
      )}

      {report && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
              icon={<ShieldCheck className="text-green-400" />} 
              label="Audit Status" 
              value="Completed" 
              subValue={`By ${MODEL_NICKNAMES[aiSettings.preferredModel]}`}
            />
            <StatCard 
              icon={<AlertTriangle className="text-amber-400" />} 
              label="Risk Level" 
              value="Analysis Done" 
              subValue="See report below"
            />
            <StatCard 
              icon={<TrendingUp className="text-blue-400" />} 
              label="Growth Potential" 
              value="High" 
              subValue="Strategy ready"
            />
          </div>

          <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-2xl">
            <div className="flex items-center gap-3 mb-8 border-b border-slate-800 pb-6">
              <div className="bg-blue-600/20 p-3 rounded-2xl">
                <BarChart3 className="text-blue-500" size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-50">Financial Audit Report</h2>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Generated on {new Date().toLocaleDateString()}</p>
              </div>
            </div>
            
            <div className="prose prose-invert max-w-none prose-headings:text-blue-400 prose-strong:text-slate-50 prose-p:text-slate-300">
              <Markdown>{report}</Markdown>
            </div>
          </div>
        </div>
      )}

      {/* Chat Section */}
      <div className="bg-[#1E293B] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col min-h-[600px] mt-12">
        <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600/20 p-2 rounded-xl">
              <MessageSquare className="text-blue-500" size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-50">AI Business Assistant</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ask questions about your business</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 bg-slate-800 p-2 rounded-2xl border border-slate-700">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Select Expert:</label>
            <div className="flex gap-1">
              {(Object.keys(MODEL_NICKNAMES) as AIModel[]).map((model) => (
                <button
                  key={model}
                  onClick={() => setAiSettings({ ...aiSettings, preferredModel: model })}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                    aiSettings.preferredModel === model 
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                      : "text-slate-500 hover:text-slate-300 hover:bg-slate-700"
                  )}
                >
                  {model === 'gemini' ? 'Gemini' : model === 'groq' ? 'Groq' : model === 'claude' ? 'Claude' : 'GPT'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto space-y-4 max-h-[400px]">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <Brain size={48} className="text-slate-700" />
              <p className="text-sm font-bold text-slate-500 max-w-xs">
                No messages yet. Ask me anything about your business finances or strategy!
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "flex flex-col max-w-[85%] space-y-1",
                  msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {msg.role === 'user' ? 'You' : MODEL_NICKNAMES[msg.model || 'gemini']}
                  </span>
                  <span className="text-[8px] text-slate-600 font-bold">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div 
                  className={cn(
                    "p-4 rounded-2xl text-sm font-medium leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-blue-600 text-white rounded-tr-none" 
                      : "bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700"
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))
          )}
          {isChatLoading && (
            <div className="flex flex-col mr-auto items-start max-w-[85%] space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {MODEL_NICKNAMES[aiSettings.preferredModel]} is thinking...
                </span>
              </div>
              <div className="bg-slate-800 p-4 rounded-2xl rounded-tl-none border border-slate-700 flex gap-1">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={sendMessage} className="p-4 bg-slate-900/50 border-t border-slate-800 flex gap-3">
          <input
            type="text"
            value={chatInput}
            maxLength={2000}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={`Ask ${MODEL_NICKNAMES[aiSettings.preferredModel]} a question...`}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-6 py-3 text-sm font-bold text-slate-200 outline-none focus:border-blue-500 transition-all"
          />
          <button
            type="submit"
            disabled={isChatLoading || !chatInput.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black px-6 rounded-2xl transition-all active:scale-95 flex items-center gap-2"
          >
            {isChatLoading ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>

      {!loading && !report && !messages.length && (
        <div className="bg-slate-900/50 p-12 rounded-3xl border border-dashed border-slate-800 text-center space-y-4">
          <div className="bg-slate-800 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Search className="text-slate-500" size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-300">Ready for Audit</h3>
          <p className="text-slate-500 max-w-sm mx-auto">
            Click the "Run Deep Audit" button to start the AI analysis of your business finances.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, subValue }: { icon: React.ReactNode; label: string; value: string; subValue: string }) {
  return (
    <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex items-center gap-4">
      <div className="bg-slate-900 p-4 rounded-2xl">
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</p>
        <p className="text-lg font-black text-slate-50">{value}</p>
        <p className="text-xs font-bold text-slate-400">{subValue}</p>
      </div>
    </div>
  );
}

