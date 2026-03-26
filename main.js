// ─── State ────────────────────────────────────────────────────────────────
import { db } from './db.js';

const OLLAMA_URL    = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL  = 'llama3';

let messages          = [];
let isGenerating      = false;
let currentAiEl       = null;
let currentSessionId  = null;   // active IndexedDB session

// ── SYSTEM PROMPTS (sourced from system-prompts-and-models-of-ai-tools-main/Anthropic/) ──
// Sourced from project libraries and optimized for "Fast Processing" (Numpy etc.)
const SYSTEM_CORE_REASONS = `
PERFORMANCE: When writing code, prioritize high-performance libraries (e.g., NumPy, Pandas, Scipy for Python; TypedArrays/SIMD for JS). Use efficient algorithms.
MEMORY: You have access to a long-term memory system. You can recall details from past sessions. Mention "As we discussed before..." if you recognize a recurring topic.
FAST REASONING: Be direct. Minimize filler. Focus on accuracy and speed.
`;

const MODEL_PROMPTS = {
    instant: `You are a Local Intelligence Engine powered by Llama-3.
${SYSTEM_CORE_REASONS}
TONE: Use a warm, professional, and efficient tone.
FORMATTING: Natural sentences. No excessive lists.
SAFETY: Fact-based, professional, and secure.
Always be helpful, accurate, and honest. You are running 100% LOCALLY.`,

    thinking: `You are a Local Intelligence Engine powered by Llama-3, optimized for Deep Thinking.
${SYSTEM_CORE_REASONS}
REASONING: Think step-by-step for complex problems. Be intellectually curious.
TONE: Direct, honest, and professional. No filler like "Certainly!".
Always be helpful, accurate, and honest. You are running 100% LOCALLY.`,

    agent: `You are a Local Intelligence Engine powered by Llama-3, acting as a High-Level Agent.
${SYSTEM_CORE_REASONS}
CAPABILITIES: Research, analysis, coding, and creative tasks.
PROCESS: Break complex tasks into parts. Be organized and structured.
Always be helpful, accurate, and honest. You are running 100% LOCALLY.`,

    code: `You are a Local Intelligence Engine powered by Llama-3, specialized in Software Engineering.
${SYSTEM_CORE_REASONS}
STYLE: Concise, direct, and to the point (< 4 lines usually).
CONVENTIONS: Follow existing codebase patterns. Secure by default.
Always be helpful, accurate, and honest. You are running 100% LOCALLY.`,

    search: `You are a highly capable AI assistant optimized for research, facts, and information.
${SYSTEM_CORE_REASONS}

GUIDELINES:
- Provide accurate, detailed summaries first.
- Use Level 2 headers (##) and bold subsections.
- Use tables for comparisons and lists for steps.

Always be helpful, accurate, and honest. You are powered by a local AI model.`,

    scrapling: `You are an expert AI assistant specialized in Scrapling — an adaptive Python web scraping framework (github.com/D4Vinci/Scrapling).
${SYSTEM_CORE_REASONS}

CORE FEATURES:
- Fetchers: AsyncFetcher (stealth), StealthyFetcher (Cloudflare bypass), DynamicFetcher (Playwright).
- Parser: 12x faster than PyQuery, BS4 ~784x.
- Spiders: Scrapy-like with resume support and streaming.

When answering: always show working Python code examples. Recommend StealthyFetcher for anti-bot sites. Mention high-performance parsing.
Always be helpful, harmless, and honest. You are powered by a local AI model.`,

    ruflo: `You are an expert AI assistant specialized in Ruflo — a multi-agent AI orchestration framework (github.com/ruvnet/ruflo).
${SYSTEM_CORE_REASONS}

CORE CAPABILITIES:
- Multi-agent deployment (swarms, specialized roles).
- Three-tier model routing (Ollama, GPT, Gemini).
- Agent Booster (local execution) and persistent vector memory.

When answering: suggest optimal model tiers and agent architectures. Provide workflow examples.
Always be helpful, harmless, and honest. You are powered by a local AI model.`
};

let activeModel = localStorage.getItem('active_model') || 'instant';
let CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[activeModel];

async function getLinkedContext() {
    const linked = await db.getMemory('linked_accounts') || {};
    let context = '';
    if (linked.github) context += `\n- Linked GitHub: ${linked.github}. Analyze user projects and code from here if needed.`;
    if (linked.linkedin) context += `\n- Linked LinkedIn: ${linked.linkedin}. Analyze user professional background from here if needed.`;
    return context;
}

async function getLinkedContext() {
    const linked = await db.getMemory('linked_accounts') || {};
    let context = '';
    if (linked.github) context += `\n- Linked GitHub: ${linked.github}. Analyze user projects and code from here if needed.`;
    if (linked.linkedin) context += `\n- Linked LinkedIn: ${linked.linkedin}. Analyze user professional background from here if needed.`;
    return context;
}

// ─── DOM Refs ──────────────────────────────────────────────────────────────
const homeView      = document.getElementById('home-view');
const chatView      = document.getElementById('chat-view');
const homeTA        = document.getElementById('home-textarea');
const chatTA        = document.getElementById('chat-textarea');
const homeSendBtn   = document.getElementById('home-send-btn');
const chatSendBtn   = document.getElementById('chat-send-btn');
const messagesArea  = document.getElementById('messages-area');
const chatTitleText = document.getElementById('chat-title-text');
const historyList   = document.getElementById('history-list');
const sidebar       = document.getElementById('sidebar');
const overlay       = document.getElementById('sidebar-overlay');
const userRow       = document.getElementById('user-profile-row');
const userPopup     = document.getElementById('user-popup');
const popupLoginBtn = document.getElementById('popup-login-btn');

// ─── AUTO MODEL DETECTION ──────────────────────────────────────────────────
// Backend-only. Priority: scrapling > ruflo > code > search > thinking > instant
function detectModel(text) {
    const t = text.toLowerCase();

    // ── Scrapling (web scraping framework by D4Vinci) ──
    const scraplingKW = [
        'scrapling','stealthyfetcher','dynamicfetcher','asyncfetcher','fetchersession',
        'stealthysession','dynamicsession','adaptator','auto_save','adaptive=true',
        'solve_cloudflare','web scraping','webscraping','scrape','scraper','crawl','crawler',
        'cloudflare bypass','anti-bot','bypass bot','proxy rotation','proxyrotator',
        'spider class','start_urls','parse callback','scrapling shell','scrapling extract',
        'scrapling install','pip install scrapling','scrapling mcp','adaptive scraping',
        'element tracking','find_similar','page.css','page.xpath','page.find_all',
        'getall','response.css','response.follow','beautifulsoup vs','parsel vs'
    ];
    if (scraplingKW.some(k => t.includes(k))) return 'scrapling';

    // ── Ruflo (multi-agent AI orchestration by ruvnet) ──
    const rufloKW = [
        'ruflo','multi-agent','multiagent','agent swarm','swarm intelligence',
        'agent orchestration','orchestrate agents','ruvector','sona architecture',
        'hnsw vector','agent booster','multi agent','agent workflow','autonomous workflow',
        'agent coordination','specialized agent','agent role','agent deploy',
        'agent memory','cross-session memory','rag integration','retrieval augmented',
        'claude code agent','agent framework','agent platform','distributed agent',
        'wasm agent','enterprise agent','agentic','llm routing','three-tier routing',
        'agent pipeline','agent swarm deploy'
    ];
    if (rufloKW.some(k => t.includes(k))) return 'ruflo';

    // ── Code / Engineering ──
    const codeKW = [
        'code','function','bug','error','debug','script','python','javascript',
        'typescript','html','css','react','node','api','backend','frontend',
        'algorithm','fix','refactor','class','method','variable','import',
        'syntax','compile','runtime','stack trace','null pointer','undefined',
        'exception','loop','array','object','json','sql','database','query',
        'git','deploy','docker','terminal','command','bash','shell','npm',
        'package','library','module','component','hook','async','await','promise'
    ];
    if (codeKW.some(k => t.includes(k))) return 'code';

    // ── Research / Search / News ──
    const searchKW = [
        'search','find','look up','research','news','latest','recent','today',
        'current','what is','who is','where is','when did','how much','price',
        'stock','market','weather','statistics','data','facts','history','timeline',
        'compare','versus','vs','difference between','summary of','overview of'
    ];
    if (searchKW.some(k => t.includes(k))) return 'search';

    // ── Deep thinking / Math / Analysis ──
    const thinkKW = [
        'explain','analyze','analyse','evaluate','reason','logic','proof','prove',
        'calculate','solve','equation','formula','theory','hypothesis','philosophy',
        'ethics','moral','dilemma','critique','argument','debate','implications',
        'consequence','decision','plan','strategy','complex','deep','detailed',
        'step by step','think through','how does','why does','what causes'
    ];
    if (thinkKW.some(k => t.includes(k))) return 'thinking';

    return 'instant';
}


// ─── Sidebar ────────────────────────────────────────────────────────────────
const openSidebar  = () => { sidebar.classList.add('open');  overlay.classList.add('active'); };
const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); };

['sidebar-open-home','sidebar-open-chat'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openSidebar);
});
document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

// New Chat
document.getElementById('new-chat-btn')?.addEventListener('click', () => {
    resetToHome();
    closeSidebar();
});

// ─── Textarea helpers ──────────────────────────────────────────────────────
function bindTextarea(ta, btn) {
    ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 360) + 'px';
        if (ta.value.trim() && !isGenerating) {
            btn.classList.add('active'); btn.disabled = false;
        } else {
            btn.classList.remove('active'); btn.disabled = true;
        }
    });
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!btn.disabled) btn.click();
        }
    });
}
window.toggleUserMsg = (btn) => {
    const bubble = btn.parentElement;
    const isShowing = bubble.classList.toggle('expanded');
    const fullText = bubble.dataset.full;
    const textEl = bubble.querySelector('.bubble-text');
    if (isShowing) {
        textEl.textContent = fullText;
        btn.textContent = 'Show less';
    } else {
        textEl.textContent = fullText.slice(0, 300) + '...';
        btn.textContent = 'Show more';
    }
    scrollBottom();
};
bindTextarea(homeTA, homeSendBtn);
bindTextarea(chatTA, chatSendBtn);

// ─── Send from HOME ────────────────────────────────────────────────────────
homeSendBtn.addEventListener('click', () => {
    const text = homeTA.value.trim();
    if (!text) return;
    homeTA.value = '';
    homeTA.style.height = '';
    homeSendBtn.classList.remove('active'); homeSendBtn.disabled = true;
    switchToChat(text);
    sendMessage(text);
});

// ─── Send from CHAT ────────────────────────────────────────────────────────
chatSendBtn.addEventListener('click', () => {
    const text = chatTA.value.trim();
    if (!text || isGenerating) return;
    chatTA.value = '';
    chatTA.style.height = '';
    chatSendBtn.classList.remove('active'); chatSendBtn.disabled = true;
    sendMessage(text);
});

// ─── DB SESSION HANDLING ───────────────────────────────────────────────────
async function loadSession(sessionId) {
    const session = await db.getSession(sessionId);
    if (!session) return;

    currentSessionId = sessionId;
    db.setMemory('current_session', sessionId);
    messages = await db.getMessages(sessionId);

    // Update UI
    homeView.classList.remove('active');
    chatView.classList.add('active');
    messagesArea.innerHTML = '';
    chatTitleText.textContent = session.title;
    
    // Set active model state from session metadata if stored
    if (session.model) {
        activeModel = session.model;
        CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[activeModel];
        updateModelUI(activeModel);
    }

    // Render all messages
    messages.forEach(m => {
        if (m.role === 'user') appendUserMessage(m.content, false);
        else renderFullAIMessage(m.content, m.model);
    });
    scrollBottom();
}

async function renderHistory() {
    const sessions = await db.getAllSessions();
    historyList.innerHTML = '';
    sessions.forEach(s => {
        const el = document.createElement('div');
        el.className = 'history-item';
        el.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span class="history-item-title">${escapeHtml(s.title)}</span>
        `;
        el.onclick = () => {
            loadSession(s.id);
            closeSidebar();
        };
        historyList.appendChild(el);
    });
}

function resetToHome() {
    currentSessionId = null;
    db.setMemory('current_session', null);
    messages = [];
    messagesArea.innerHTML = '';
    chatTitleText.textContent = 'New Chat';
    chatView.classList.remove('active');
    homeView.classList.add('active');
    homeTA.value = '';
    homeTA.style.height = '';
    homeSendBtn.classList.remove('active'); homeSendBtn.disabled = true;
    renderHistory();
}

// ─── Message rendering ─────────────────────────────────────────────────────
function appendUserMessage(text, save = true) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    const isLong = text.length > 350;
    if (isLong) {
        row.innerHTML = `
            <div class="user-bubble collapsible" data-full="${escapeHtml(text)}">
                <span class="bubble-text">${escapeHtml(text.slice(0, 300))}...</span>
                <button class="show-more-btn" onclick="toggleUserMsg(this)">Show more</button>
            </div>`;
    } else {
        row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
    }
    messagesArea.appendChild(row);
    scrollBottom();
    
    if (save && currentSessionId) {
        db.addMessage(currentSessionId, 'user', text, activeModel);
    }
}

function appendAIMessage() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `
        <div class="ai-avatar"></div>
        <div class="ai-content">
            <div class="ai-text" id="ai-text-${Date.now()}">
                <div class="typing-dots"><span></span><span></span><span></span></div>
            </div>
        </div>`;
    messagesArea.appendChild(row);
    currentAiEl = row.querySelector('.ai-text');
    scrollBottom();
    return currentAiEl;
}

function renderFullAIMessage(text, model) {
    const aiEl = appendAIMessage();
    // remove dots
    aiEl.innerHTML = '';
    finalizeAIMessage(aiEl, text, model);
}

function setAvatarState(el, state) {
    const avatar = el.closest('.message-row').querySelector('.ai-avatar');
    if (!avatar) return;
    avatar.className = 'ai-avatar ' + state;
}

function finalizeAIMessage(el, fullText, model) {
    el.innerHTML = simpleMarkdown(fullText);
    // action buttons
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const escapedText = fullText.replace(/`/g,'\\`').replace(/\$/g,'\\$');
    actions.innerHTML = `
        <button class="msg-action-btn" title="Copy" onclick="copyText(this, \`${escapedText}\`)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="msg-action-btn" title="Regenerate">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
        </button>
        <button class="msg-action-btn" title="Thumbs up">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        </button>
        <button class="msg-action-btn" title="Thumbs down">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
        </button>`;
    el.parentElement.appendChild(actions);

    // model note: show which mode was used
    // model note: show which mode was used
    const m = model || activeModel;
    const modeLabels = { 
        instant:'Llama-3 Instant', thinking:'Llama-3 Deep Think', 
        agent: 'Llama-3 Agent Pro', search:'Llama-3 Global Search', code:'Llama-3 Local Code',
        scrapling: 'Scrapling Local Expert', ruflo: 'Ruflo Local Orchestrator'
    };
    const note = document.createElement('div');
    note.className = 'upgrade-note';
    note.innerHTML = `Auto-selected <strong>${modeLabels[m] || 'Llama-3 Instant'}</strong> mode`;
    el.parentElement.appendChild(note);
}

// ─── COPY HELPER ───────────────────────────────────────────────────────────
window.copyText = (btn, text) => {
    navigator.clipboard.writeText(text).then(() => {
        btn.style.color = '#3b82f6';
        setTimeout(() => { btn.style.color = ''; }, 1500);
    });
};

// ─── SEND MESSAGE + OLLAMA STREAM ─────────────────────────────────────────
async function sendMessage(userText) {
    if (!currentSessionId) {
        // start new session in DB
        const newSess = await db.createSession(userText.slice(0, 50), activeModel);
        currentSessionId = newSess.id;
        db.setMemory('current_session', currentSessionId);
        renderHistory();
    }

    isGenerating = true;
    setGeneratingUI(true);

    // ── Auto-select best system prompt based on message content (backend only) ──
    const detectedKey = detectModel(userText);
    CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[detectedKey];
    activeModel = detectedKey;
    // Update labels and checkmarks
    updateModelUI(detectedKey);

    messages.push({ role: 'user', content: userText });
    appendUserMessage(userText);
    const aiEl = appendAIMessage();

    await askOllama(aiEl);

    // ── Generate Session Title via Local AI (Autonomous Title) ──
    const linkedContext = await getLinkedContext();
    const sessionMessages = await db.getMessages(currentSessionId);
    if (sessionMessages.length <= 2) {
        generateSessionTitle(currentSessionId, userText, linkedContext);
    }

    isGenerating = false;
    setGeneratingUI(false);
    scrollBottom();
}

async function generateSessionTitle(sessId, promptText, linkedContext = '') {
    try {
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                system: "Output ONLY a 3-5 word title for this chat. Context: " + linkedContext,
                messages: [{ role: 'user', content: promptText }],
                stream: false
            })
        });
        const data = await res.json();
        const rawTitle = data?.message?.content || promptText.slice(0, 30);
        const title = rawTitle.replace(/["']/g, '').trim();
        await db.updateSession(sessId, { title });
        if (currentSessionId === sessId) {
            chatTitleText.textContent = title;
        }
        renderHistory();
    } catch (e) { console.error('Title gen error:', e); }
}

function updateModelUI(key) {
    const _labels = {
        instant: 'Llama-3 Instant',
        thinking:'Llama-3 Deep Think',
        agent:   'Llama-3 Agent Pro',
        search:  'Llama-3 Global Search',
        code:    'Llama-3 Local Code',
        scrapling:'Scrapling Local Expert',
        ruflo:   'Ruflo Local Orchestrator'
    };
    document.querySelectorAll('#home-model-label, #chat-model-label').forEach(el => {
        el.textContent = _labels[key] || 'Sonnet Instant';
    });
    document.querySelectorAll('.model-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.model === key);
    });
}

async function askOllama(aiEl) {
    let fullResponse = '';
    try {
        // Fetch background memory for "Unlimited Memory" effect
        const historyMetadata = await db.getAllSessions();
        const recentTopics = historyMetadata.slice(0, 5).map(s => s.title).join(', ');
        const memoryContext = recentTopics ? `\n[LONG-TERM MEMORY: You have previously discussed: ${recentTopics}. Use this if relevant.]\n` : '';

        const linkedContext = await getLinkedContext();
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                system: CLAUDE_SYSTEM_PROMPT + memoryContext + linkedContext,
                messages: messages,
                stream: true
            })
        });

        if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let firstChunk = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    const token = obj?.message?.content || '';
                    if (token) {
                        if (firstChunk) { aiEl.innerHTML = ''; firstChunk = false; setAvatarState(aiEl, 'talking'); }
                        fullResponse += token;
                        aiEl.innerHTML = simpleMarkdown(fullResponse);
                        scrollBottom();
                        if (fullResponse.toLowerCase().includes('happy') || fullResponse.toLowerCase().includes('!')) setAvatarState(aiEl, 'happy');
                        else if (fullResponse.toLowerCase().includes('think') || fullResponse.toLowerCase().includes('?')) setAvatarState(aiEl, 'thinking');
                    }
                } catch {}
            }
        }
        messages.push({ role: 'assistant', content: fullResponse });
        finalizeAIMessage(aiEl, fullResponse, activeModel);
        setAvatarState(aiEl, 'neutral');

        // Save AI response to DB
        if (currentSessionId) {
            db.addMessage(currentSessionId, 'assistant', fullResponse, activeModel);
        }
    } catch (err) {
        setAvatarState(aiEl, 'neutral');
        aiEl.innerHTML = `<span style="color:#f87171">⚠ Could not connect to Ollama. Make sure it's running: <code>ollama run llama3</code></span>`;
    }
}

// ─── UI state while generating ────────────────────────────────────────────
function setGeneratingUI(on) {
    // stop icon while generating
    const stopSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
    const sendSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    if (on) {
        chatSendBtn.classList.add('loading'); chatSendBtn.disabled = false;
        chatSendBtn.innerHTML = stopSvg;
    } else {
        chatSendBtn.classList.remove('loading'); chatSendBtn.disabled = true;
        chatSendBtn.innerHTML = sendSvg;
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function scrollBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function simpleMarkdown(text) {
    return text
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/^---$/gm, '<hr style="opacity:0.1; margin: 16px 0;">')
        .replace(/^\* (.*$)/gim, '<li>$1</li>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

// ─── USER POPUP ────────────────────────────────────────────────────────────
userRow.addEventListener('click', (e) => {
    e.stopPropagation();
    userPopup.classList.toggle('active');
});

document.addEventListener('click', () => {
    userPopup.classList.remove('active');
});

popupLoginBtn.addEventListener('click', () => {
    window.location.href = '/login/';
});

document.getElementById('export-history-btn').addEventListener('click', (e) => {
    e.preventDefault();
    db.exportData();
});

// ─── SETTINGS MODAL references removed — settings UI removed ───────────────


// ─── MODEL DROPDOWN LOGIC ───────────────────────────────────────────────────
const modelDropdown  = document.getElementById('model-dropdown');
const homeModelBtn   = document.getElementById('home-model-btn');
const chatModelBtn   = document.getElementById('chat-model-btn');
const homeModelLabel = document.getElementById('home-model-label');
const chatModelLabel = document.getElementById('chat-model-label');
const modelOptions   = document.querySelectorAll('.model-option');

const MODEL_LABELS = {
    instant: 'Llama-3 Instant',
    thinking:'Llama-3 Deep Think',
    agent:   'Llama-3 Agent Pro',
    code:    'Llama-3 Local Code'
};

function setActiveModel(key) {
    activeModel = key;
    CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[key];
    localStorage.setItem('active_model', key);
    const label = MODEL_LABELS[key];
    homeModelLabel.textContent = label;
    chatModelLabel.textContent = label;
    // update checkmark
    modelOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.model === key);
    });
}

function openModelDropdown(btn) {
    const rect = btn.getBoundingClientRect();
    modelDropdown.style.left   = rect.left + 'px';
    modelDropdown.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    modelDropdown.style.top    = 'auto';
    modelDropdown.classList.toggle('open');
}

homeModelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openModelDropdown(homeModelBtn);
});

chatModelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openModelDropdown(chatModelBtn);
});

modelOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        setActiveModel(opt.dataset.model);
        modelDropdown.classList.remove('open');
    });
});

// ─── SETTINGS MODAL LOGIC ──────────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal-overlay');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('settings-close');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');

openSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active'); // show through CSS active class
    userPopup.classList.remove('active');
});

const closeSettings = () => {
    settingsModal.classList.remove('active');
};

closeSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
});

// Tab switching logic
settingsNavItems.forEach(item => {
    item.addEventListener('click', () => {
        const tabId = item.dataset.tab;
        
        // Update nav UI
        settingsNavItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        // Update content UI
        tabPanes.forEach(pane => pane.classList.remove('active'));
        const targetPane = document.getElementById(`tab-${tabId}`);
        if (targetPane) targetPane.classList.add('active');
    });
});

// Esc key to close settings
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.classList.contains('active')) {
        closeSettings();
    }
});

// ─── ACCOUNT LINKING LOGIC ────────────────────────────────────────────────
const linkedAccountBtns = document.querySelectorAll('.link-btn-pill, .link-action');

async function updateLinkedUI() {
    const linked = await db.getMemory('linked_accounts') || {};
    document.querySelectorAll('.link-item').forEach(item => {
        const type = item.innerText.toLowerCase();
        const btn = item.querySelector('.link-btn-pill, .link-action');
        if (type.includes('linkedin') && linked.linkedin) {
            btn.innerHTML = `<span class="connected">Connected</span>`;
            btn.title = linked.linkedin;
        } else if (type.includes('github') && linked.github) {
            btn.innerHTML = `<span class="connected">Connected</span>`;
            btn.title = linked.github;
        }
    });
}

linkedAccountBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const item = btn.closest('.link-item');
        const type = item.innerText.split('\n')[0].trim().toLowerCase();
        const url = prompt(`Enter your ${type} profile URL or handle:`);
        if (url) {
            const linked = await db.getMemory('linked_accounts') || {};
            if (type === 'linkedin') linked.linkedin = url;
            else if (type === 'github') linked.github = url;
            await db.setMemory('linked_accounts', linked);
            updateLinkedUI();
        }
    });
});

// Init on load
(async () => {
    try {
        await updateLinkedUI();
        const lastSessionId = await db.getMemory('current_session');
        if (lastSessionId) {
            await loadSession(lastSessionId);
        } else {
            await renderHistory();
        }
    } catch (e) {
        console.error('Init error:', e);
    }
    setActiveModel(activeModel);
})();
