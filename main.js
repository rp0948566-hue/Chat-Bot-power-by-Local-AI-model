// ─── State ────────────────────────────────────────────────────────────────
const OLLAMA_URL    = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL  = 'llama3';

let messages        = [];   // { role, content }
let isGenerating    = false;
let currentAiEl     = null; // the current streaming AI text element

// ─── DOM Refs ──────────────────────────────────────────────────────────────
const homeView       = document.getElementById('home-view');
const chatView       = document.getElementById('chat-view');
const homeTA         = document.getElementById('home-textarea');
const chatTA         = document.getElementById('chat-textarea');
const homeSendBtn    = document.getElementById('home-send-btn');
const chatSendBtn    = document.getElementById('chat-send-btn');
const messagesArea   = document.getElementById('messages-area');
const chatTitleText  = document.getElementById('chat-title-text');
const historyList    = document.getElementById('history-list');
const sidebar        = document.getElementById('sidebar');
const overlay        = document.getElementById('sidebar-overlay');

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

// ─── View switching ────────────────────────────────────────────────────────
function switchToChat(firstMsg) {
    homeView.classList.remove('active');
    chatView.classList.add('active');
    // Set title to first few words of message
    chatTitleText.textContent = firstMsg.slice(0, 40) + (firstMsg.length > 40 ? '…' : '');
    addHistoryItem(chatTitleText.textContent);
    chatTA.focus();
}

function resetToHome() {
    messages = [];
    messagesArea.innerHTML = '';
    chatTitleText.textContent = 'New Chat';
    chatView.classList.remove('active');
    homeView.classList.add('active');
    homeTA.value = '';
    homeTA.style.height = '';
    homeSendBtn.classList.remove('active'); homeSendBtn.disabled = true;
}

// ─── History items ─────────────────────────────────────────────────────────
function addHistoryItem(title) {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.textContent = title;
    historyList.prepend(el);
}

// ─── Message rendering ─────────────────────────────────────────────────────
function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
    messagesArea.appendChild(row);
    scrollBottom();
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

function setAvatarState(el, state) {
    const avatar = el.closest('.message-row').querySelector('.ai-avatar');
    if (!avatar) return;
    avatar.className = 'ai-avatar ' + state;
}

function finalizeAIMessage(el, fullText) {
    el.innerHTML = simpleMarkdown(fullText);
    // action buttons
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = `
        <button class="msg-action-btn" title="Copy" onclick="copyText(this, \`${fullText.replace(/`/g,'\\`')}\`)">
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

    // subtle note
    const note = document.createElement('div');
    note.className = 'upgrade-note';
    note.innerHTML = `Using local <strong>Llama 3</strong> · <a href="#">Upgrade</a> to cloud models`;
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
    isGenerating = true;
    setGeneratingUI(true);

    messages.push({ role: 'user', content: userText });
    appendUserMessage(userText);

    const aiEl = appendAIMessage();
    let fullResponse = '';

    try {
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
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
                        if (firstChunk) { 
                            aiEl.innerHTML = ''; firstChunk = false; 
                            setAvatarState(aiEl, 'talking');
                        }
                        fullResponse += token;
                        aiEl.innerHTML = simpleMarkdown(fullResponse);
                        scrollBottom();
                        
                        // Adaptive expression based on content
                        if (fullResponse.toLowerCase().includes('happy') || fullResponse.toLowerCase().includes('!')) {
                            setAvatarState(aiEl, 'happy');
                        } else if (fullResponse.toLowerCase().includes('think') || fullResponse.toLowerCase().includes('?')) {
                            setAvatarState(aiEl, 'thinking');
                        }
                    }
                } catch {}
            }
        }

        messages.push({ role: 'assistant', content: fullResponse });
        finalizeAIMessage(aiEl, fullResponse);
        setAvatarState(aiEl, 'neutral');

    } catch (err) {
        aiEl.innerHTML = `<span style="color:#f87171">⚠ Could not connect to Ollama.<br>Make sure it's running: <code>ollama run llama3</code><br><small>${err.message}</small></span>`;
    } finally {
        isGenerating = false;
        setGeneratingUI(false);
        scrollBottom();
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
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}
