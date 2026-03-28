import { useState, useRef, useEffect, useCallback } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import { 
  Bug, 
  Code2, 
  Lightbulb, 
  Wand2, 
  BookOpen, 
  Languages, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Copy, 
  Terminal,
  Play,
  Monitor,
  Plus,
  X,
  FileCode,
  Sparkles,
  Zap,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { DebugScene } from './components/DebugScene';
import { debugCode, type DebugResult } from './services/gemini';
import { getCodeCompletion, getAutoCorrection } from './lib/aiService';

interface Tab {
  id: string;
  title: string;
  code: string;
  result: DebugResult | null;
}

const LANGUAGES = [
  { id: 'python', name: 'Python', icon: '🐍' },
  { id: 'java', name: 'Java', icon: '☕' },
  { id: 'c', name: 'C', icon: '⚙️' },
  { id: 'cpp', name: 'C++', icon: '🚀' },
  { id: 'javascript', name: 'JavaScript', icon: '📜' },
];

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = localStorage.getItem('debug_tabs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved tabs', e);
      }
    }
    return [{ id: '1', title: 'Snippet 1', code: '', result: null }];
  });
  
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id || '1');
  const [isDebugging, setIsDebugging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [suggestion, setSuggestion] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [quotaExceededUntil, setQuotaExceededUntil] = useState<number>(0);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [autoCorrectEnabled, setAutoCorrectEnabled] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  
  const resultRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debugTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestCodeRef = useRef<string>('');
  const suggestionCacheRef = useRef<Record<string, string>>({});

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  useEffect(() => {
    localStorage.setItem('debug_tabs', JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const updateActiveTab = (updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...updates } : t));
  };

  const addTab = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newTab: Tab = {
      id: newId,
      title: `Snippet ${tabs.length + 1}`,
      code: '',
      result: null
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      const currentIndex = tabs.findIndex(t => t.id === id);
      const nextTab = newTabs[currentIndex] || newTabs[newTabs.length - 1];
      setActiveTabId(nextTab.id);
    }
  };

  const startRenaming = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditTitle(tab.title);
  };

  const saveRename = () => {
    if (editingTabId && editTitle.trim()) {
      setTabs(prev => prev.map(t => t.id === editingTabId ? { ...t, title: editTitle.trim() } : t));
    }
    setEditingTabId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') setEditingTabId(null);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      const newCode = activeTab.code + suggestion;
      updateActiveTab({ code: newCode });
      setSuggestion('');
    }
    if (e.key === 'Escape') {
      setSuggestion('');
    }
  };

  const fetchSuggestion = useCallback(async (code: string) => {
    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode === lastRequestCodeRef.current) {
      return;
    }

    // Circuit breaker check
    if (Date.now() < quotaExceededUntil) {
      return;
    }

    // Check cache
    if (suggestionCacheRef.current[trimmedCode]) {
      setSuggestion(suggestionCacheRef.current[trimmedCode]);
      return;
    }

    setIsSuggesting(true);
    lastRequestCodeRef.current = trimmedCode;
    
    try {
      const lang = activeTab.result?.detectedLanguage || 'javascript';
      const completion = await getCodeCompletion(code, lang);
      
      if (completion) {
        setSuggestion(completion);
        // Cache the result
        suggestionCacheRef.current[trimmedCode] = completion;
      } else {
        setSuggestion('');
      }
    } catch (err: any) {
      console.error("Suggestion fetch failed", err);
      
      // If it's a quota error, trigger circuit breaker for 30 seconds
      const isQuota = err?.status === 'RESOURCE_EXHAUSTED' || err?.code === 429 || err?.error?.code === 429 || err?.message?.includes("quota");
      if (isQuota) {
        setQuotaExceededUntil(Date.now() + 30000); // 30 second timeout
      }
      
      setSuggestion('');
    } finally {
      setIsSuggesting(false);
    }
  }, [activeTab.result?.detectedLanguage, quotaExceededUntil]);

  useEffect(() => {
    if (debugTimeoutRef.current) {
      clearTimeout(debugTimeoutRef.current);
    }

    const trimmedCode = activeTab.code.trim();
    if (trimmedCode) {
      debugTimeoutRef.current = setTimeout(() => {
        handleBackgroundDebug(activeTab.code);
      }, 1500); // 1.5s debounce for background debugging
    }

    return () => {
      if (debugTimeoutRef.current) clearTimeout(debugTimeoutRef.current);
    };
  }, [activeTab.code]);

  useEffect(() => {
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }

    const trimmedCode = activeTab.code.trim();
    if (trimmedCode && trimmedCode !== lastRequestCodeRef.current) {
      suggestionTimeoutRef.current = setTimeout(() => {
        fetchSuggestion(activeTab.code);
      }, 600); // Reduced debounce to 600ms for faster response
    } else if (!trimmedCode) {
      setSuggestion('');
      lastRequestCodeRef.current = '';
    }

    return () => {
      if (suggestionTimeoutRef.current) clearTimeout(suggestionTimeoutRef.current);
    };
  }, [activeTab.code, fetchSuggestion]);

  const handleAutoCorrect = async () => {
    if (!activeTab.code.trim()) return;
    setIsCorrecting(true);
    try {
      const lang = activeTab.result?.detectedLanguage || 'javascript';
      const corrected = await getAutoCorrection(activeTab.code, lang);
      updateActiveTab({ code: corrected });
      setSuggestion('');
    } catch (err) {
      console.error("Auto-correction failed", err);
    } finally {
      setIsCorrecting(false);
    }
  };

  const detectLanguage = (code: string) => {
    const trimmed = code.trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('const ') || trimmed.startsWith('function ')) return 'javascript';
    if (trimmed.startsWith('def ') || trimmed.startsWith('import ') && trimmed.includes('from ')) return 'python';
    if (trimmed.startsWith('#include ')) return 'cpp';
    if (trimmed.startsWith('public class ') || trimmed.startsWith('import java.')) return 'java';
    return 'javascript'; // Default
  };

  const handleBackgroundDebug = async (code: string) => {
    if (!code.trim()) return;
    
    // Optimistic language detection
    const detected = detectLanguage(code);
    updateActiveTab({ result: { detectedLanguage: detected, errors: [], errorLines: [], explanation: "", suggestedFix: "", expectedOutput: "", learningMoment: "", codeBreakdown: [], verifiedResources: [] } });
    
    try {
      const debugResult = await debugCode(code, () => {});
      updateActiveTab({ result: debugResult });

      // Auto-correct logic: Only apply if 1-2 simple syntax errors AND enabled
      if (autoCorrectEnabled && debugResult.errors.length > 0 && debugResult.errors.length <= 2) {
        const isSimpleError = debugResult.errors.every(err => 
          err.type.toLowerCase().includes('syntax') || 
          err.description.toLowerCase().includes('missing')
        );
        
        if (isSimpleError) {
          // Apply fix
          updateActiveTab({ code: debugResult.suggestedFix });
          // Notify user
          setError("Auto-corrected simple syntax error.");
          setTimeout(() => setError(null), 3000);
        }
      }
    } catch (err) {
      // Silent error handling for background debug
      console.error("Background debug failed", err);
    }
  };

  const handleDebug = async () => {
    if (!activeTab.code.trim()) return;
    
    setIsDebugging(true);
    setError(null);
    
    try {
      const debugResult = await debugCode(activeTab.code, (chunk) => {
        // Optional: Handle partial streaming updates if needed
        console.log("Chunk received:", chunk);
      });
      updateActiveTab({ result: debugResult });
      setShowConsole(false);
      // Scroll to result immediately
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsDebugging(false);
    }
  };

  const handleRun = () => {
    setIsRunning(true);
    setShowConsole(true);
    // Faster simulation
    setTimeout(() => {
      setIsRunning(false);
    }, 300);
  };

  const copyToClipboard = (text: string, type: 'fix' | 'original') => {
    navigator.clipboard.writeText(text);
    if (type === 'fix') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-900">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors lg:hidden"
            >
              <Terminal size={20} className="text-zinc-400" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-900/20">
                <Bug size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">NeonDebug AI</h1>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">3D Interactive Debugger</p>
              </div>
            </div>
          </div>
          
          <div className="hidden sm:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded-full text-xs font-bold text-indigo-400 border border-indigo-900/50">
              <Monitor size={14} />
              <span>v2.0 Multi-Tab</span>
            </div>
            <a href="#" className="hover:text-indigo-400 transition-colors">Docs</a>
            <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-all text-xs font-bold shadow-[0_0_10px_rgba(79,70,229,0.3)]">
              Sign In
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        {/* Sidebar Navigation */}
        <aside 
          className={`
            ${isSidebarOpen ? 'w-72' : 'w-0 lg:w-20'} 
            bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0 transition-all duration-300 overflow-hidden z-20 relative
          `}
        >
          <div className="p-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/50">
            <h2 className={`font-bold text-zinc-400 text-[10px] uppercase tracking-widest ${!isSidebarOpen && 'hidden'}`}>My Snippets</h2>
            <div className="flex items-center gap-1">
              <button 
                onClick={addTab}
                className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all shadow-[0_0_10px_rgba(79,70,229,0.5)]"
                title="New Snippet"
              >
                <Plus size={16} />
              </button>
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="hidden lg:flex p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors"
              >
                <Terminal size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`
                  group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer border
                  ${activeTabId === tab.id 
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm' 
                    : 'bg-transparent text-zinc-500 border-transparent hover:bg-zinc-50 hover:text-zinc-700'}
                  ${!isSidebarOpen && 'justify-center px-0'}
                `}
              >
                <FileCode size={20} className={activeTabId === tab.id ? 'text-indigo-600' : 'text-zinc-400'} />
                
                {isSidebarOpen && (
                  <>
                    <div className="flex-1 min-w-0">
                      {editingTabId === tab.id ? (
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={saveRename}
                          onKeyDown={handleKeyDown}
                          className="w-full bg-white border border-indigo-300 rounded px-1 py-0.5 text-indigo-700 focus:outline-none"
                        />
                      ) : (
                        <p className="truncate" onDoubleClick={(e) => startRenaming(e, tab)}>
                          {tab.title}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => startRenaming(e, tab)}
                        className="p-1 hover:bg-indigo-100 rounded text-indigo-400 hover:text-indigo-600"
                      >
                        <Lightbulb size={12} />
                      </button>
                      {tabs.length > 1 && (
                        <button 
                          onClick={(e) => closeTab(e, tab.id)}
                          className="p-1 hover:bg-red-100 rounded text-zinc-400 hover:text-red-500"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {isSidebarOpen && (
            <div className="p-4 border-t border-zinc-100">
              <div className="bg-indigo-50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Pro Tip</p>
                <p className="text-[10px] text-indigo-700 leading-tight">Double-click a snippet name to rename it for better tracking.</p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] font-bold text-zinc-500 uppercase">Auto-Correct</span>
                <button
                  onClick={() => setAutoCorrectEnabled(!autoCorrectEnabled)}
                  className={`w-8 h-4 rounded-full transition-colors ${autoCorrectEnabled ? 'bg-indigo-600' : 'bg-zinc-300'}`}
                >
                  <div className={`w-3 h-3 bg-white rounded-full transition-transform ${autoCorrectEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-zinc-50/30">
          <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input */}
          <div className="lg:col-span-7 space-y-6">
            <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-zinc-700 font-semibold">
                  <Code2 size={18} className="text-indigo-600" />
                  <span>Code Editor</span>
                </div>
                
                <div className="flex items-center gap-4">
                  {activeTab.result && (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">
                      <Languages size={14} />
                      <span>{activeTab.result.detectedLanguage}</span>
                    </div>
                  )}
                  <button 
                    onClick={handleAutoCorrect}
                    disabled={isCorrecting || !activeTab.code.trim()}
                    className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors disabled:opacity-50"
                    title="Auto-Correct Code"
                  >
                    {isCorrecting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {isCorrecting ? 'Correcting...' : 'Auto-Correct'}
                  </button>
                  <button 
                    onClick={() => copyToClipboard(activeTab.code, 'original')}
                    disabled={!activeTab.code.trim()}
                    className="flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-indigo-600 transition-colors"
                  >
                    {copiedOriginal ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copiedOriginal ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              
              <div className="relative font-mono text-sm flex">
                {/* Line Numbers */}
                <div className="bg-zinc-50 border-r border-zinc-100 p-6 pr-3 text-right text-zinc-300 select-none sticky top-0 h-[400px] overflow-hidden">
                  {activeTab.code.split('\n').map((_, idx) => (
                    <div key={idx} className="h-[1.5rem] leading-[1.5rem]">
                      {idx + 1}
                    </div>
                  ))}
                  {activeTab.code.split('\n').length === 0 && <div className="h-[1.5rem] leading-[1.5rem]">1</div>}
                </div>

                <div className="relative flex-1 h-[400px]">
                  {/* Highlight Layer (Behind Textarea) */}
                  <div 
                    className="absolute inset-0 p-6 pointer-events-none overflow-hidden whitespace-pre break-all text-zinc-900"
                    aria-hidden="true"
                    style={{ lineHeight: '1.5rem' }}
                  >
                    {activeTab.code.split('\n').map((line, idx) => {
                      // Virtualization: only render visible lines
                      if (idx < Math.max(0, scrollTop / 24 - 10) || idx > scrollTop / 24 + 40) {
                        return <div key={idx} className="h-[1.5rem]" />;
                      }
                      
                      const isErrorLine = activeTab.result?.errorLines.includes(idx + 1);
                      const language = activeTab.result?.detectedLanguage?.toLowerCase() || 'javascript';
                      let highlightedLine = '';
                      try {
                        highlightedLine = Prism.highlight(line || ' ', Prism.languages[language] || Prism.languages.javascript, language);
                      } catch (e) {
                        highlightedLine = Prism.highlight(line || ' ', Prism.languages.javascript, 'javascript');
                      }
                      return (
                        <div 
                          key={idx} 
                          className={`h-[1.5rem] ${isErrorLine ? 'bg-red-500/20 border-l-4 border-red-500 -ml-6 pl-[1.25rem]' : ''}`}
                          dangerouslySetInnerHTML={{ __html: highlightedLine }}
                        />
                      );
                    })}
                  </div>

                  {/* Textarea Layer */}
                  <textarea
                    ref={textareaRef}
                    value={activeTab.code}
                    onChange={(e) => {
                      updateActiveTab({ code: e.target.value });
                      if (activeTab.result) updateActiveTab({ result: null }); // Clear result when code changes
                      setSuggestion(''); // Clear suggestion on change
                    }}
                    onKeyDown={handleEditorKeyDown}
                    placeholder="Paste your code here... I'll detect the language automatically!"
                    className="w-full h-full p-6 bg-transparent focus:outline-none resize-none placeholder:text-zinc-300 relative z-10 caret-zinc-900 whitespace-pre overflow-auto text-transparent"
                    style={{ lineHeight: '1.5rem' }}
                    spellCheck={false}
                    onScroll={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      setScrollTop(target.scrollTop);
                      const highlightLayer = target.previousElementSibling as HTMLDivElement;
                      const lineNumbers = target.parentElement?.previousElementSibling as HTMLDivElement;
                      if (highlightLayer) highlightLayer.scrollTop = target.scrollTop;
                      if (lineNumbers) lineNumbers.scrollTop = target.scrollTop;
                    }}
                  />

                  {/* Suggestion Ghost Text Overlay */}
                  {suggestion && (
                    <div 
                      className="absolute inset-0 p-6 pointer-events-none overflow-hidden whitespace-pre break-all text-transparent z-0"
                      style={{ lineHeight: '1.5rem' }}
                    >
                      <span>{activeTab.code}</span>
                      <span className="text-zinc-300 bg-indigo-50/50 rounded">{suggestion}</span>
                      <div className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded animate-pulse">
                        <Sparkles size={10} />
                        <span>Tab to accept</span>
                      </div>
                    </div>
                  )}

                  {isSuggesting && (
                    <div className="absolute top-4 right-4 z-30">
                      <div className="flex items-center gap-2 px-2 py-1 bg-white/80 backdrop-blur-sm border border-indigo-100 rounded-lg text-[10px] font-bold text-indigo-600 shadow-sm">
                        <Loader2 size={10} className="animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="absolute bottom-4 right-4 z-20 flex items-center gap-3">
                  {activeTab.code.trim() && (
                    <button 
                      onClick={() => copyToClipboard(activeTab.code, 'original')}
                      className="flex items-center gap-2 px-4 py-3 bg-white/80 backdrop-blur-sm text-zinc-600 hover:text-indigo-600 rounded-xl font-bold transition-all border border-zinc-200 shadow-sm"
                      title="Copy Original Code"
                    >
                      {copiedOriginal ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Copy size={20} />}
                      <span className="hidden sm:inline">{copiedOriginal ? 'Copied!' : 'Copy'}</span>
                    </button>
                  )}
                  {activeTab.result && activeTab.result.errors.length === 0 && (
                    <button
                      onClick={handleRun}
                      disabled={isRunning}
                      className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl font-bold transition-all shadow-lg shadow-emerald-200"
                    >
                      {isRunning ? (
                        <Loader2 size={20} className="animate-spin" />
                      ) : (
                        <Play size={20} className="fill-current" />
                      )}
                      Run Code
                    </button>
                  )}
                  <button
                    onClick={handleDebug}
                    disabled={isDebugging || !activeTab.code.trim()}
                    className={`
                      flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg
                      ${isDebugging || !activeTab.code.trim() 
                        ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed shadow-none' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0 shadow-indigo-200'}
                    `}
                  >
                    {isDebugging ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Wand2 size={20} />
                        Debug & Resolve
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700"
              >
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <p className="text-sm font-medium">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Right Column: Guidance/Results */}
          <div className="lg:col-span-5 space-y-6">
            <AnimatePresence mode="wait">
              {!activeTab.result && !isDebugging ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-8 text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">
                    <Lightbulb className="text-indigo-600" size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-zinc-900">Ready to resolve!</h3>
                  <p className="text-zinc-600 text-sm leading-relaxed">
                    Paste your code on the left. I'll automatically detect the language, find errors, and provide a full resolution.
                  </p>
                  <div className="pt-4 grid grid-cols-2 gap-3">
                    <div className="bg-white p-3 rounded-xl border border-indigo-100 text-left">
                      <div className="text-indigo-600 mb-1"><Languages size={16} /></div>
                      <p className="text-xs font-bold text-zinc-800">Auto-Detect</p>
                      <p className="text-[10px] text-zinc-500">Detects 20+ languages</p>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-indigo-100 text-left">
                      <div className="text-indigo-600 mb-1"><CheckCircle2 size={16} /></div>
                      <p className="text-xs font-bold text-zinc-800">Full Resolve</p>
                      <p className="text-[10px] text-zinc-500">Working code snippets</p>
                    </div>
                  </div>
                </motion.div>
              ) : isDebugging ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-[400px] flex flex-col items-center justify-center bg-black border border-indigo-500/50 rounded-2xl p-8 text-center space-y-6"
                >
                  <DebugScene errors={[]} />
                  <div className="absolute z-10 bg-black/80 backdrop-blur p-4 rounded-xl border border-indigo-500">
                    <h3 className="text-lg font-bold text-indigo-400">Processing...</h3>
                    <p className="text-zinc-400 text-sm mt-1">Detecting language and resolving logic errors.</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="result"
                  ref={resultRef}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  {/* 3D Visualization of Errors */}
                  {activeTab.result && activeTab.result.errors.length > 0 && (
                    <DebugScene errors={activeTab.result.errors} />
                  )}

                  {/* Error Summary */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    {activeTab.result?.errors.length === 0 ? (
                      <>
                        <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 text-emerald-700 font-bold">
                          <CheckCircle2 size={18} />
                          <span>No Issues Detected</span>
                        </div>
                        <div className="p-5">
                          <p className="text-slate-700 font-medium italic">there is no errors</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-4 bg-red-50 border-b border-red-100 flex items-center gap-2 text-red-700 font-bold">
                          <AlertCircle size={18} />
                          <span>Issues Detected</span>
                        </div>
                        <div className="p-5 space-y-4">
                          {activeTab.result?.errors?.map((err, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-xl border border-red-100 shadow-sm space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">Line {err.line}</span>
                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{err.type}</span>
                              </div>
                              <p className="text-sm text-zinc-800 font-medium">{err.description}</p>
                              <div className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded font-mono">
                                <span className="font-bold uppercase">Fix:</span> {err.suggestion}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Verified Resources */}
                  {activeTab.result?.verifiedResources && activeTab.result.verifiedResources.length > 0 && (
                    <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-2 text-indigo-700 font-bold mb-3">
                        <Globe size={18} />
                        <span>Verified Resources</span>
                      </div>
                      <div className="space-y-2">
                        {activeTab.result.verifiedResources.map((res, idx) => (
                          <a 
                            key={idx} 
                            href={res.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="block p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700 hover:bg-indigo-100 transition-colors font-medium"
                          >
                            {res.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Input Code Console (when correct) */}
                  {activeTab.result?.errors.length === 0 && showConsole && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="bg-black rounded-2xl border border-slate-800 overflow-hidden shadow-xl"
                    >
                      <div className="flex items-center gap-2 px-6 py-3 bg-slate-900/50 border-b border-slate-800">
                        <Monitor className="w-4 h-4 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Virtual Console Output</span>
                      </div>
                      <div className="p-6 font-mono text-sm">
                        {isRunning ? (
                          <div className="flex items-center gap-3 text-slate-500 italic">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Executing {activeTab.result?.detectedLanguage || 'code'}...</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-zinc-600 text-xs">$ {activeTab.result?.detectedLanguage?.toLowerCase() || 'code'} runner output:</div>
                            <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed">
                              {activeTab.result?.expectedOutput?.replace(/\\n/g, '\n') || 'Program executed successfully with no output.'}
                            </pre>
                            <div className="text-emerald-600 font-bold mt-4 text-xs border-t border-slate-900 pt-2">Process finished with exit code 0</div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Plain Explanation */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2 text-indigo-700 font-bold">
                      <Lightbulb size={18} />
                      <span>The Problem</span>
                    </div>
                    <div className="p-5 text-sm text-slate-600 leading-relaxed">
                      <div className="markdown-body">
                        <Markdown>{activeTab.result?.explanation}</Markdown>
                      </div>
                    </div>
                  </div>

                  {/* Learning Moment */}
                  <div className="bg-indigo-900 text-indigo-100 rounded-2xl p-6 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <BookOpen size={80} />
                    </div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-3 text-indigo-300 font-bold text-sm uppercase tracking-wider">
                        <BookOpen size={16} />
                        <span>Why it happened</span>
                      </div>
                      <div className="text-sm leading-relaxed">
                        <div className="markdown-body">
                          <Markdown>{activeTab.result?.learningMoment}</Markdown>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Full Width Suggested Fix & Breakdown */}
        <AnimatePresence>
          {activeTab.result && activeTab.result.errors.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-12 space-y-8"
            >
              {/* Suggested Fix */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-5 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-700 font-bold">
                    <CheckCircle2 size={20} />
                    <span>Resolution: Corrected Code</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRun}
                      disabled={isRunning}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-bold text-xs disabled:opacity-50"
                    >
                      {isRunning ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                      Run Code
                    </button>
                    <button 
                      onClick={() => copyToClipboard(activeTab.result?.suggestedFix?.replace(/\\n/g, '\n') || '', 'fix')}
                      className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors bg-white px-3 py-1.5 rounded-lg border border-slate-200"
                    >
                      {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      {copied ? 'Copied!' : 'Copy Resolved Code'}
                    </button>
                  </div>
                </div>
                <div className="p-0">
                  <div className={`grid grid-cols-1 ${showConsole ? 'lg:grid-cols-2' : ''}`}>
                    <div className="bg-slate-900 max-h-[600px] overflow-auto">
                      <pre className="p-6 text-indigo-300 font-mono text-sm overflow-x-auto">
                        <code>{activeTab.result?.suggestedFix?.replace(/\\n/g, '\n') || ''}</code>
                      </pre>
                    </div>
                    
                    {showConsole && (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-black border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col"
                      >
                        <div className="flex items-center gap-2 px-6 py-3 bg-slate-900/50 border-b border-slate-800">
                          <Monitor className="w-4 h-4 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Virtual Console Output</span>
                        </div>
                        <div className="p-6 font-mono text-sm flex-1">
                          {isRunning ? (
                            <div className="flex items-center gap-3 text-slate-500 italic">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Executing {activeTab.result.detectedLanguage || 'code'}...</span>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-slate-600 text-xs">$ {activeTab.result.detectedLanguage?.toLowerCase() || 'code'} runner output:</div>
                              <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed">
                                {activeTab.result?.expectedOutput?.replace(/\\n/g, '\n') || 'Program executed successfully with no output.'}
                              </pre>
                              <div className="text-emerald-600 font-bold mt-4 text-xs border-t border-slate-900 pt-2">Process finished with exit code 0</div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>

              {/* Code Breakdown */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center gap-2 text-slate-700 font-bold">
                  <Terminal size={20} className="text-indigo-600" />
                  <span>Step-by-Step Breakdown</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {activeTab.result?.codeBreakdown?.map((item, idx) => (
                    <div key={idx} className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 hover:bg-slate-50/50 transition-colors">
                      <div className="md:col-span-4">
                        <code className="text-xs font-mono bg-slate-100 p-2 rounded block text-indigo-700 border border-slate-200">
                          {item.line}
                        </code>
                      </div>
                      <div className="md:col-span-8">
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {item.explanation}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  </div>
</div>
  );
}
