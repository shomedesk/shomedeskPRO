import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import { useBusiness } from '@/src/contexts/BusinessContext';
import { getBusinessContext } from '@/src/services/aiContextService';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { 
  MessageSquare, 
  X, 
  Send, 
  Volume2, 
  VolumeX,
  Brain,
  Loader2,
  User,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type AIModel = 'gemini' | 'groq' | 'claude' | 'chatgpt';

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

export default function BusinessAssistant() {
  const { selectedBusiness, userProfile, businesses, isAllBusinessesSelected } = useBusiness();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState(true);
  const [aiSettings, setAiSettings] = useState<AISettings>({ preferredModel: 'gemini' });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [contextStatus, setContextStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const models: { id: AIModel; name: string; desc: string }[] = [
    { id: 'gemini', name: 'Gemini 3 Pro', desc: 'Deep Analysis' },
    { id: 'groq', name: 'Groq Llama 3', desc: 'Ultra Fast' },
    { id: 'claude', name: 'Claude 3.5', desc: 'Smart Reasoning' },
    { id: 'chatgpt', name: 'GPT-4o', desc: 'Versatile' },
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const speak = (text: string) => {
    if (!isTtsEnabled) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

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

  const getApiKeyForModel = (model: AIModel) => {
    switch (model) {
      case 'gemini': return aiSettings.geminiKey || process.env.GEMINI_API_KEY;
      case 'groq': return aiSettings.groqKey;
      case 'claude': return aiSettings.claudeKey;
      case 'chatgpt': return aiSettings.chatgptKey;
      default: return null;
    }
  };

  const callOtherAI = async (model: AIModel, apiKey: string, prompt: string) => {
    const endpoints: Record<string, string> = {
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      claude: 'https://api.anthropic.com/v1/messages',
      chatgpt: 'https://api.openai.com/v1/chat/completions'
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let body: any = {};

    if (model === 'groq') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }]
      };
    } else if (model === 'claude') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      };
    } else if (model === 'chatgpt') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }]
      };
    }

    const response = await fetch(endpoints[model], {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`AI Request failed: ${response.statusText}`);
    const data = await response.json();

    if (model === 'claude') return data.content[0].text;
    return data.choices[0].message.content;
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;

    const targetBusiness = selectedBusiness || businesses[0];
    if (!targetBusiness && !isAllBusinessesSelected) {
      const errorMsg: Message = { role: 'assistant', content: 'Please select a business first to gather context.' };
      setMessages(prev => [...prev, { role: 'user', content: text }, errorMsg]);
      return;
    }

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setContextStatus('loading');

    try {
      let contextData = "";
      if (isAllBusinessesSelected) {
        contextData = `All Businesses Summary: ${businesses.length} businesses found.`;
      } else if (targetBusiness) {
        const context = await getBusinessContext(targetBusiness.id);
        setContextStatus(context ? 'success' : 'error');
        contextData = `
          - Branches: ${context?.branches?.length ? JSON.stringify(context.branches) : "No branches found."}
          - Employees: ${context?.employees?.length ? JSON.stringify(context.employees) : "No employees found."}
          - Bank Accounts: ${context?.banks?.length ? JSON.stringify(context.banks) : "No bank accounts found."}
          - Branch Documents: ${context?.documents?.length ? JSON.stringify(context.documents) : "No documents found."}
          - Recent Daily Reports: ${context?.reports?.length ? JSON.stringify(context.reports) : "No recent reports found."}
        `;
      }

      const apiKey = getApiKeyForModel(aiSettings.preferredModel);
      if (!apiKey && aiSettings.preferredModel !== 'gemini') {
        const errorMsg: Message = { role: 'assistant', content: `Please set the API key for ${MODEL_NICKNAMES[aiSettings.preferredModel]} in the AI Audit settings.` };
        setMessages(prev => [...prev, errorMsg]);
        setIsLoading(false);
        return;
      }
      
      const systemInstruction = `
        You are ShomeDesk AI, a professional business assistant.
        
        BUSINESS DATA CONTEXT:
        ${contextData}
        
        CURRENT STATE:
        - Time: ${new Date().toLocaleString()}
        - User: ${userProfile?.displayName} (Role: ${userProfile?.role})
        - Selected: ${isAllBusinessesSelected ? 'All Businesses' : targetBusiness?.name}

        GUIDELINES:
        - Be concise. Use bullet points for lists.
        - Always maintain a professional, helpful, and data-driven tone.
      `;

      let aiContent = "";
      if (aiSettings.preferredModel === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: [
            { role: 'user', parts: [{ text: systemInstruction }] },
            ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
            { role: 'user', parts: [{ text: text }] }
          ]
        });
        aiContent = response.text || "I'm sorry, I couldn't process that.";
      } else {
        aiContent = await callOtherAI(aiSettings.preferredModel, apiKey!, `${systemInstruction}\n\nUser: ${text}`);
      }

      const aiMessage: Message = { role: 'assistant', content: aiContent };
      setMessages(prev => [...prev, aiMessage]);
      
      if (isTtsEnabled) {
        speak(aiContent);
      }
    } catch (error) {
      console.error('AI Assistant Error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I encountered an error. Please check your API keys in AI Audit settings." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl shadow-2xl shadow-blue-900/40 flex items-center justify-center transition-all z-[70] active:scale-95 group"
      >
        <Brain className="group-hover:animate-pulse" size={28} />
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#0F172A]" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-8 w-auto sm:w-[400px] h-[500px] sm:h-[600px] max-h-[calc(100vh-120px)] bg-[#1E293B] border border-slate-800 rounded-3xl shadow-2xl z-[70] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-xl text-blue-500">
                  <Brain size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest">Business Assistant</h3>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      contextStatus === 'success' ? "bg-emerald-500" : 
                      contextStatus === 'loading' ? "bg-amber-500 animate-pulse" : 
                      contextStatus === 'error' ? "bg-red-500" : "bg-emerald-500 animate-pulse"
                    )} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {contextStatus === 'success' ? 'Context Synced' : 
                       contextStatus === 'loading' ? 'Gathering...' : 
                       contextStatus === 'error' ? 'Sync Failed' : 'Online'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-xl transition-all flex items-center gap-1.5"
                    title="Select AI Model"
                  >
                    <Brain size={18} />
                    <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">
                      {models.find(m => m.id === aiSettings.preferredModel)?.name.split(' ').pop()}
                    </span>
                  </button>
                  
                  <AnimatePresence>
                    {isModelMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-[80]"
                      >
                        <div className="p-2 border-b border-slate-800">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 py-1">Select AI Model</p>
                        </div>
                        {models.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setAiSettings(prev => ({ ...prev, preferredModel: m.id }));
                              setIsModelMenuOpen(false);
                            }}
                            className={cn(
                              "w-full p-3 text-left hover:bg-slate-800 transition-all flex flex-col gap-0.5",
                              aiSettings.preferredModel === m.id ? "bg-blue-600/10 text-blue-400" : "text-slate-400"
                            )}
                          >
                            <span className="text-[10px] font-black uppercase tracking-widest">{m.name}</span>
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{m.desc}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={() => setIsTtsEnabled(!isTtsEnabled)}
                  className={cn(
                    "p-2 rounded-xl transition-all",
                    isTtsEnabled ? "text-blue-400 bg-blue-500/10" : "text-slate-500 hover:bg-slate-800"
                  )}
                >
                  {isTtsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                  <div className="w-16 h-16 bg-blue-500/10 rounded-3xl flex items-center justify-center text-blue-500">
                    <Bot size={32} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-200">Hello {userProfile?.displayName}!</p>
                    <p className="text-xs font-bold text-slate-500 mt-1">I can help you with your business data. Ask me about employees, branches, or financial reports.</p>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-2 w-full pt-4">
                    {[
                      "How many employees do we have?",
                      "What is the total bank balance?",
                      "Show me recent sales summary",
                      "List all our branches"
                    ].map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(q)}
                        className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex gap-3 max-w-[85%]",
                    msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                    msg.role === 'user' ? "bg-indigo-600" : "bg-slate-800 border border-slate-700"
                  )}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={cn(
                    "p-3 rounded-2xl text-sm font-medium leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-indigo-600 text-white rounded-tr-none" 
                      : "bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-none"
                  )}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3 mr-auto">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <Loader2 size={16} className="animate-spin text-blue-500" />
                  </div>
                  <div className="p-3 bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-none">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={input}
                    maxLength={2000}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Ask business question (e.g., today's profit, supplier dues)..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-3 pr-12 text-sm font-medium outline-none focus:border-blue-500 transition-all text-white placeholder-slate-500"
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-blue-500 hover:text-blue-400 disabled:opacity-0 transition-all cursor-pointer"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-3 text-center">
                Powered by ShomeDesk AI • Real-Time Business Intelligence
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
