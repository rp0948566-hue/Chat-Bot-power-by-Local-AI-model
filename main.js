// ─── State & Intelligence Configuration ──────────────────────────────────────
import { db } from './db.js';

const OLLAMA_URL   = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3';

let messages         = [];
let isGenerating     = false;
let currentAiEl      = null;
let currentSessionId = null; 

// ── SYSTEM PROMPTS (PhD-Level Phrasing) ──────────────────────────────────────
const SYSTEM_CORE_REASONS = `
PERFORMANCE: When writing code, prioritize high-performance libraries (e.g., NumPy).
MEMORY: Use long-term memory to recognize user context.
FAST REASONING: Be direct and professional.
`;

const MODEL_PROMPTS = {
    instant: `You are a Local Intelligence Engine powered by Llama-3.\n${SYSTEM_CORE_REASONS}\nTONE: Warm, professional, and efficient.`,
    thinking: `You are a Local Intelligence Engine powered by Llama-3, optimized for Deep Thinking.\n${SYSTEM_CORE_REASONS}\nREASONING: Think step-by-step.`,
    agent: `You are a Local Intelligence Engine powered by Llama-3, acting as a High-Level Agent.\n${SYSTEM_CORE_REASONS}\nPROCESS: Structured and organized.`,
    code: `You are a Local Intelligence Engine powered by Llama-3, specialized in Software Engineering.\n${SYSTEM_CORE_REASONS}\nSTYLE: Concise and direct.`,
    search: `You are a highly capable AI assistant optimized for research and information.\n${SYSTEM_CORE_REASONS}\nGUIDELINES: Detailed summaries, tables, and headers.`,
    scrapling: `You are an expert AI assistant specialized in Scrapling (web scraping framework).\n${SYSTEM_CORE_REASONS}\nShow working Python code examples.`,
    ruflo: `You are an expert AI assistant specialized in Ruflo (multi-agent orchestration).\n${SYSTEM_CORE_REASONS}\nSuggest optimal agent architectures.`
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

// ─── DOM References ─────────────────────────────────────────────────────────
const getEl = (id) => document.getElementById(id);

const homeView       = getEl('home-view');
const chatView       = getEl('chat-view');
const homeTA         = getEl('home-textarea');
const chatTA         = getEl('chat-textarea');
const homeSendBtn    = getEl('home-send-btn');
const chatSendBtn    = getEl('chat-send-btn');
const messagesArea   = getEl('messages-area');
const chatTitleText  = getEl('chat-title-text');
const historyList    = getEl('history-list');
const sidebar        = getEl('sidebar');
const overlay        = getEl('sidebar-overlay');
const userRow        = getEl('user-profile-row');
const userPopup      = getEl('user-popup');
const popupLoginBtn  = getEl('popup-login-btn');
const modelDropdown  = getEl('model-dropdown');
const homeModelBtn   = getEl('home-model-btn');
const chatModelBtn   = getEl('chat-model-btn');
const homeModelLabel = getEl('home-model-label');
const chatModelLabel = getEl('chat-model-label');
const settingsModal  = getEl('settings-modal-overlay');
const openSettingsBtn = getEl('open-settings-btn');
const closeSettingsBtn = getEl('settings-close');

// ─── Global Constants Dependent on DOM ──────────────────────────────────────
const modelOptions = document.querySelectorAll('.model-option');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');

// ─── Utility Functions ──────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function scrollBottom() {
    if (messagesArea) {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
}

function simpleMarkdown(text) {
    if (!text) return '';
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

function setGeneratingUI(active) {
    const stopSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
    const sendSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    
    [homeSendBtn, chatSendBtn, homeTA, chatTA].forEach(el => { if(el) el.disabled = active; });
    
    if (chatSendBtn) {
        chatSendBtn.innerHTML = active ? stopSvg : sendSvg;
        chatSendBtn.classList.toggle('loading', active);
    }
}

function switchToChat(text) {
    homeView?.classList.remove('active');
    chatView?.classList.add('active');
    if (messagesArea) messagesArea.innerHTML = '';
    scrollBottom();
}

// ─── Interaction Logic ──────────────────────────────────────────────────────
function detectModel(text) {
    const t = text.toLowerCase();
    if (t.includes('scrapling') || t.includes('scrape')) return 'scrapling';
    if (t.includes('ruflo') || t.includes('multi-agent')) return 'ruflo';
    if (t.includes('code') || t.includes('fix')) return 'code';
    if (t.includes('search') || t.includes('find')) return 'search';
    if (t.includes('explain') || t.includes('analyze')) return 'thinking';
    return 'instant';
}

function setActiveModel(key) {
    const labels = { instant:'Llama-3 Instant', thinking:'Llama-3 Deep Think', agent:'Llama-3 Agent Pro', search:'Llama-3 Global Search', code:'Llama-3 Local Code', scrapling:'Scrapling Local Expert', ruflo:'Ruflo Local Orchestrator' };
    activeModel = key;
    CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[key];
    localStorage.setItem('active_model', key);
    if (homeModelLabel) homeModelLabel.textContent = labels[key];
    if (chatModelLabel) chatModelLabel.textContent = labels[key];
    modelOptions.forEach(opt => opt.classList.toggle('active', opt.dataset.model === key));
}

// Modal handling
const openSidebar  = () => { sidebar?.classList.add('open'); overlay?.classList.add('active'); };
const closeSidebar = () => { sidebar?.classList.remove('open'); overlay?.classList.remove('active'); };

['sidebar-open-home','sidebar-open-chat'].forEach(id => getEl(id)?.addEventListener('click', openSidebar));
getEl('sidebar-close')?.addEventListener('click', closeSidebar);
overlay?.addEventListener('click', closeSidebar);

// User Popup & Settings
userRow?.addEventListener('click', (e) => { e.stopPropagation(); userPopup?.classList.toggle('active'); });
document.addEventListener('click', () => { userPopup?.classList.remove('active'); modelDropdown?.classList.remove('open'); });
openSettingsBtn?.addEventListener('click', () => { settingsModal?.classList.add('active'); userPopup?.classList.remove('active'); });
closeSettingsBtn?.addEventListener('click', () => settingsModal?.classList.remove('active'));
settingsModal?.addEventListener('click', (e) => { if(e.target === settingsModal) settingsModal.classList.remove('active'); });

tabPanes.forEach(pane => {
    settingsNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;
            settingsNavItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            tabPanes.forEach(p => p.classList.remove('active'));
            getEl(`tab-${tabId}`)?.classList.add('active');
        });
    });
});

// ─── Messaging Engine ───────────────────────────────────────────────────────
async function sendMessage(userText) {
    if (!currentSessionId) {
        const newSess = await db.createSession(userText.slice(0, 50), activeModel);
        currentSessionId = newSess.id;
        db.setMemory('current_session', currentSessionId);
        renderHistory();
    }
    isGenerating = true;
    setGeneratingUI(true);

    const modelKey = detectModel(userText);
    setActiveModel(modelKey);

    messages.push({ role: 'user', content: userText });
    appendUserMessage(userText);
    const aiEl = appendAIMessage();

    await askOllama(aiEl);

    const linked = await getLinkedContext();
    if (messages.length <= 2) generateSessionTitle(currentSessionId, userText, linked);

    isGenerating = false;
    setGeneratingUI(false);
}

async function askOllama(aiEl) {
    let full = '';
    try {
        const history = await db.getAllSessions();
        const memory = history.slice(0, 3).map(s => s.title).join(', ');
        const memoryCtx = memory ? `\n[Past discussions: ${memory}]` : '';
        const linkedCtx = await getLinkedContext();

        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                system: CLAUDE_SYSTEM_PROMPT + memoryCtx + linkedCtx,
                messages,
                stream: true
            })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        aiEl.innerHTML = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            chunk.split('\n').filter(l => l.trim()).forEach(line => {
                try {
                    const token = JSON.parse(line).message?.content || '';
                    full += token;
                    aiEl.innerHTML = simpleMarkdown(full);
                    scrollBottom();
                } catch {}
            });
        }
        messages.push({ role: 'assistant', content: full });
        db.addMessage(currentSessionId, 'assistant', full, activeModel);
        finalizeAIMessage(aiEl, full, activeModel);
    } catch (e) {
        aiEl.innerHTML = `<span style="color:#f87171">⚠ Connection failed. Ensure Ollama is running.</span>`;
    }
}

function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
    messagesArea?.appendChild(row);
    scrollBottom();
    if (currentSessionId) db.addMessage(currentSessionId, 'user', text, activeModel);
}

function appendAIMessage() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `<div class="ai-avatar neutral"></div><div class="ai-content"><div class="ai-text"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>`;
    messagesArea?.appendChild(row);
    scrollBottom();
    return row.querySelector('.ai-text');
}

function finalizeAIMessage(el, text, model) {
    el.innerHTML = simpleMarkdown(text);
    const note = document.createElement('div');
    note.className = 'upgrade-note';
    note.innerHTML = `Mode: <strong>${model}</strong>`;
    el.parentElement.appendChild(note);
}

async function generateSessionTitle(id, text, ctx) {
    try {
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            body: JSON.stringify({ model: OLLAMA_MODEL, system: "Summarize in 3 words: " + ctx, messages: [{ role:'user', content: text }], stream: false })
        });
        const data = await res.json();
        const title = (data.message?.content || text.slice(0, 20)).replace(/"/g,'');
        await db.updateSession(id, { title });
        if (currentSessionId === id && chatTitleText) chatTitleText.textContent = title;
        renderHistory();
    } catch {}
}

async function renderHistory() {
    const sessions = await db.getAllSessions();
    if (historyList) {
        historyList.innerHTML = '';
        sessions.forEach(s => {
            const el = document.createElement('div');
            el.className = 'history-item';
            el.innerHTML = `<span class="history-item-title">${escapeHtml(s.title)}</span>`;
            el.onclick = () => { loadSession(s.id); closeSidebar(); };
            historyList.appendChild(el);
        });
    }
}

async function loadSession(id) {
    const s = await db.getSession(id);
    if (!s) return;
    currentSessionId = id;
    messages = await db.getMessages(id);
    homeView?.classList.remove('active');
    chatView?.classList.add('active');
    if (messagesArea) {
        messagesArea.innerHTML = '';
        messages.forEach(m => m.role === 'user' ? appendUserMessage(m.content) : finalizeAIMessage(appendAIMessage(), m.content, m.model));
    }
    if (chatTitleText) chatTitleText.textContent = s.title;
    scrollBottom();
}

// ─── Initialization ──────────────────────────────────────────────────────────
function bindTA(ta, btn) {
    ta?.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 300) + 'px';
        btn.disabled = !ta.value.trim();
        btn.classList.toggle('active', !btn.disabled);
    });
    ta?.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if(!btn.disabled) btn.click(); } });
}

bindTA(homeTA, homeSendBtn);
bindTA(chatTA, chatSendBtn);

homeSendBtn?.addEventListener('click', () => {
    const val = homeTA.value.trim();
    if (val) { homeTA.value = ''; switchToChat(val); sendMessage(val); }
});

chatSendBtn?.addEventListener('click', () => {
    const val = chatTA.value.trim();
    if (val && !isGenerating) { chatTA.value = ''; sendMessage(val); }
});

// Dropdown positioning
const openModelDrop = (btn) => {
    const r = btn.getBoundingClientRect();
    if (modelDropdown) {
        modelDropdown.style.left = r.left + 'px';
        modelDropdown.style.bottom = (window.innerHeight - r.top + 5) + 'px';
        modelDropdown.classList.toggle('open');
    }
};
homeModelBtn?.addEventListener('click', (e) => { e.stopPropagation(); openModelDrop(homeModelBtn); });
chatModelBtn?.addEventListener('click', (e) => { e.stopPropagation(); openModelDrop(chatModelBtn); });
modelOptions.forEach(opt => opt.addEventListener('click', () => { setActiveModel(opt.dataset.model); modelDropdown?.classList.remove('open'); }));

// Account Linking
const linkBtns = document.querySelectorAll('.link-btn-pill, .link-action');
async function updateLinkUI() {
    const linked = await db.getMemory('linked_accounts') || {};
    document.querySelectorAll('.link-item').forEach(item => {
        const type = item.innerText.toLowerCase();
        const btn = item.querySelector('.link-btn-pill, .link-action');
        if (btn && ((type.includes('linkedin') && linked.linkedin) || (type.includes('github') && linked.github))) {
            btn.innerHTML = `<span class="connected">Connected</span>`;
        }
    });
}
linkBtns.forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.closest('.link-item').innerText.split('\n')[0].trim().toLowerCase();
    const url = prompt(`Enter ${type} URL:`);
    if (url) {
        const linked = await db.getMemory('linked_accounts') || {};
        linked[type] = url;
        await db.setMemory('linked_accounts', linked);
        updateLinkUI();
    }
}));

// RUN 
(async () => {
    await updateLinkUI();
    const last = await db.getMemory('current_session');
    if (last) await loadSession(last); else await renderHistory();
    setActiveModel(activeModel);
})();
