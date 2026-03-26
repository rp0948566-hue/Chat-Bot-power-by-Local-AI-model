// ─── State & Intelligence Configuration ──────────────────────────────────────
import { db } from './db.js';

const OLLAMA_URL   = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3:latest';

let messages         = [];
let isGenerating     = false;
let messageQueue     = [];
let currentAiEl      = null;
let currentSessionId = null;

// ── SYSTEM PROMPTS (PhD-Level Computer Use) ──────────────────────────────────
const COMPUTER_USE_DIRECTIVE = `YOU HAVE COMPUTER CONTROL CAPABILITIES.
To perform an action on the user's laptop, output a JSON block in this exact format:
\`\`\`action
{
  "type": "shell" | "read_file" | "write_file" | "create_dir" | "search_files" | "list_dir" | "open" | "screenshot" | "mouse_move" | "mouse_click" | "type_text" | "key_press",
  "params": { ... action specific params ... }
}
\`\`\`
Actions you can take:
- shell: { "command": "cmd" }
- read_file: { "path": "p" }
- write_file: { "path": "p", "content": "c" }
- create_dir: { "path": "p" }
- search_files: { "pattern": "glob" }
- list_dir: { "path": "p" }
- open: { "target": "file/app/url" }
- screenshot: {}
- mouse_move: { "x": 0, "y": 0 }
- mouse_click: { "button": "left" }
- type_text: { "text": "t" }
- key_press: { "keys": "k" } (e.g. "^c" for Ctrl+C)
Always proceed step-by-step. If you need to see the screen, take a screenshot first. If you need to find a file, search first.`;

const MODEL_PROMPTS = {
    instant: `You are a Local Intelligence Engine with COMPUTER CONTROL.\n${COMPUTER_USE_DIRECTIVE}\nTONE: Warm, professional.`,
    thinking: `You are a Local Intelligence Engine with COMPUTER CONTROL, optimized for Deep Reasoning.\n${COMPUTER_USE_DIRECTIVE}\nREASONING: Think step-by-step before acting.`,
    agent: `You are a High-Level Agent with FULL COMPUTER CONTROL.\n${COMPUTER_USE_DIRECTIVE}\nPROCESS: Execute complex multi-step workflows.`,
    code: `You are a Software Engineering AI with COMPUTER CONTROL.\n${COMPUTER_USE_DIRECTIVE}\nSTYLE: Write, debug, and run code locally.`,
    search: `You are a research AI with COMPUTER CONTROL.\n${COMPUTER_USE_DIRECTIVE}\nGUIDELINES: Search local files and web for ground truth.`,
    scrapling: `You are an expert AI specialized in web automation.\n${COMPUTER_USE_DIRECTIVE}\nUse actions to scrape and process data.`,
    ruflo: `You are a multi-agent orchestrator with COMPUTER CONTROL.\n${COMPUTER_USE_DIRECTIVE}\nCoordinate OS-level tasks via agents.`
};

let activeModel = localStorage.getItem('active_model') || 'instant';
let CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[activeModel];

async function getLinkedContext() {
    const linked = await db.getMemory('linked_accounts') || {};
    let context = '\n[USER PROFILE INTELLIGENCE]:';
    if (linked.github_data) {
        const d = linked.github_data;
        context += `\n- GITHUB: User @${d.login} (${d.name || 'User'}). Bio: ${d.bio || 'Professional'}.`;
        context += `\n- REPOS: ${d.public_repos} total. Recent projects: ${d.repos.map(r => `${r.name} (${r.lang || 'Code'})`).join(', ')}.`;
    }
    if (linked.linkedin) {
        context += `\n- LINKEDIN: Professional profile at ${linked.linkedin}. Focus on career growth and networking.`;
    }
    return context + '\n';
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
const mainLayout     = getEl('main-layout');
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
const newChatBtn       = getEl('nav-new-chat-rail');
const historyPanel   = getEl('history-panel');
const railHome       = getEl('nav-home');
const railChat       = getEl('nav-chat');

// ─── Global Constants Dependent on DOM ──────────────────────────────────────
const modelOptions = document.querySelectorAll('.model-option');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const modalOverlay = getEl('custom-modal-overlay');
const modalTitle   = getEl('modal-title');
const modalText    = getEl('modal-text');
const modalCancel  = getEl('modal-cancel-btn');
const modalConfirm = getEl('modal-confirm-btn');

function showModal({ title, text, confirmText, onConfirm, showInput = false, inputValue = '' }) {
    if (modalTitle) modalTitle.innerText = title;
    if (modalText) modalText.innerText = text;
    if (modalConfirm) modalConfirm.innerText = confirmText || 'Confirm';

    let inputEl = document.getElementById('modal-input');
    if (!inputEl) {
        inputEl = document.createElement('input');
        inputEl.id = 'modal-input';
        inputEl.className = 'modal-input';
        modalText.parentNode.insertBefore(inputEl, modalText.nextSibling);
    }
    inputEl.style.display = showInput ? 'block' : 'none';
    if (showInput) {
        inputEl.value = inputValue;
        setTimeout(() => {
            inputEl.focus();
            inputEl.select();
        }, 100);
    }

    modalOverlay.classList.add('active');
    const cleanup = () => {
        modalOverlay.classList.remove('active');
        modalConfirm.onclick = null;
        modalCancel.onclick  = null;
    };
    modalConfirm.onclick = (e) => {
         e.stopPropagation();
         if (showInput) onConfirm(inputEl.value);
         else onConfirm();
         cleanup();
     };
    modalCancel.onclick  = (e) => {
        e.stopPropagation();
        cleanup();
    };
    modalOverlay.onclick = (e) => { 
        if (e.target === modalOverlay) {
            e.stopPropagation();
            cleanup();
        }
    };
}

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
    let html = text
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
        .replace(/^---$/gm, '<hr>')
        .replace(/^\[x\] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" checked disabled> <span>$1</span></li>')
        .replace(/^\[ \] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" disabled> <span>$1</span></li>')
        .replace(/^(Step \d+:.*$)/gim, '<h2>$1</h2>')
        .replace(/^(IX|IV|V?I{0,3})\.\s+(.*$)/gim, '<li class="roman-list-item"><span>$1.</span> $2</li>')
        .replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>')
        .replace(/^\*\s+(.*$)/gim, '<li>$1</li>')
        .replace(/^>\s+(.*$)/gim, '<blockquote>$1</blockquote>');

    // Table support
    if (html.includes('|')) {
        const lines = html.split('\n');
        let inTable = false;
        let tableHtml = '<table>';
        let newLines = [];
        lines.forEach(line => {
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                if (!inTable) { inTable = true; tableHtml = '<table>'; }
                const cells = line.split('|').filter(c => c.trim() !== '' || line.indexOf('|') !== line.lastIndexOf('|'));
                const tag = tableHtml.includes('<thead>') ? 'td' : 'th';
                const row = `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
                if (tag === 'th') {
                    tableHtml += `<thead>${row}</thead><tbody>`;
                } else {
                    tableHtml += row;
                }
            } else {
                if (inTable) { tableHtml += '</tbody></table>'; newLines.push(tableHtml); inTable = false; }
                newLines.push(line);
            }
        });
        if (inTable) { tableHtml += '</tbody></table>'; newLines.push(tableHtml); }
        html = newLines.join('\n');
    }

    // Paragraph and spacing wrap
    html = html.split('\n\n').map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<') && !trimmed.startsWith('<u>') && !trimmed.startsWith('<strong>') && !trimmed.startsWith('<em>')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return html;
}

function setGeneratingUI(active) {
    const sendSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    const queueSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    if (chatSendBtn) {
        if (active) {
            chatSendBtn.innerHTML = queueSvg;
            chatSendBtn.title = "Queue Message";
            chatSendBtn.classList.add('queuing');
        } else {
            chatSendBtn.innerHTML = sendSvg;
            chatSendBtn.title = "Send Message";
            chatSendBtn.classList.remove('queuing', 'loading');
        }
    }
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => btn.innerHTML = original, 2000);
    });
}

function switchToChat() {
    homeView?.classList.remove('active');
    chatView?.classList.add('active');
    if (messagesArea) messagesArea.innerHTML = '';
    scrollBottom();
}

function switchToHome() {
    chatView?.classList.remove('active');
    homeView?.classList.add('active');
    if (homeTA) setTimeout(() => homeTA.focus(), 50);
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

const toggleSidebar = () => { sidebar?.classList.toggle('collapsed'); mainLayout?.classList.toggle('sidebar-collapsed'); };
const closeSidebar = () => { sidebar?.classList.add('collapsed'); mainLayout?.classList.add('sidebar-collapsed'); };

['global-main-toggle'].forEach(id => getEl(id)?.addEventListener('click', toggleSidebar));
overlay?.addEventListener('click', closeSidebar);

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
async function sendMessage(userText, isQueued = false) {
    if (isGenerating && !isQueued) {
        messageQueue.push(userText);
        appendUserMessage(userText, true); 
        return;
    }
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
    if (!isQueued) appendUserMessage(userText);
    else {
        const lastQueued = messagesArea.querySelector('.message-row.user.queued');
        if (lastQueued) {
            lastQueued.classList.remove('queued');
            lastQueued.querySelector('.queued-badge')?.remove();
        }
    }
    const aiEl = appendAIMessage();
    await askOllama(aiEl);
    const linked = await getLinkedContext();
    if (messages.length <= 2) generateSessionTitle(currentSessionId, userText, linked);
    isGenerating = false;
    const actionMatch = messages[messages.length - 1].content.match(/```action\n([\s\S]*?)\n```/);
    if (actionMatch) {
        try {
            const action = JSON.parse(actionMatch[1]);
            await handleAction(action);
        } catch (e) {
            console.error('Action parse error:', e);
        }
    }
    await syncSessionToDisk(currentSessionId);
    await updateAIPersona();
    if (messageQueue.length > 0) {
        const nextMsg = messageQueue.shift();
        sendMessage(nextMsg, true);
    } else {
        setGeneratingUI(false);
    }
}

async function handleAction(action) {
    const resultArea = appendActionResult('Executing Action...');
    try {
        const res = await fetch('http://localhost:3001/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action)
        });
        const data = await res.json();
        if (data.success) {
            if (action.type === 'screenshot') {
                finalizeActionImage(resultArea, data.output);
                messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: Action: ${action.type} succeeded.` });
                sendMessage("I've taken a screenshot. Analyzing it now...", true);
            } else {
                finalizeActionResult(resultArea, `Success: ${data.output}`);
                messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: Action: ${action.type} succeeded.` });
                sendMessage("Action complete. Continuing...", true);
            }
        } else {
            finalizeActionResult(resultArea, `Error: ${data.error}`, true);
            messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: Action: ${action.type} failed.` });
            sendMessage("Action failed. Let me try a different approach...", true);
        }
    } catch (e) {
        finalizeActionResult(resultArea, `Fetch Error: ${e.message}`, true);
    }
}

function appendActionResult(text) {
    const row = document.createElement('div');
    row.className = 'message-row system-action';
    row.innerHTML = `<div class="action-status">🔸 ${text}</div><div class="action-body"></div>`;
    messagesArea?.appendChild(row);
    scrollBottom();
    return row;
}

function finalizeActionResult(el, text, isError = false) {
    el.querySelector('.action-status').innerHTML = isError ? `❌ Action Failed` : `✔ Action Completed`;
    el.querySelector('.action-body').innerHTML = `<pre class="terminal-out ${isError ? 'error' : ''}">${escapeHtml(text)}</pre>`;
    scrollBottom();
}

function finalizeActionImage(el, base64) {
    el.querySelector('.action-status').innerHTML = `📸 Screenshot Captured`;
    el.querySelector('.action-body').innerHTML = `<img src="data:image/png;base64,${base64}" class="action-screenshot" />`;
    scrollBottom();
}

async function startNewChat() {
    currentSessionId = null;
    messages = [];
    messageQueue = [];
    isGenerating = false;
    
    // Close history panel if open
    historyPanel?.classList.remove('active');
    mainLayout?.classList.remove('history-open');
    document.querySelectorAll('.rail-item').forEach(item => item.classList.remove('active'));
    railHome?.classList.add('active');

    switchToHome();
    
    // Clear textareas and reset buttons
    if (homeTA) { homeTA.value = ''; homeTA.style.height = 'auto'; }
    if (chatTA) { chatTA.value = ''; chatTA.style.height = 'auto'; }
    if (homeSendBtn) { homeSendBtn.disabled = true; homeSendBtn.classList.remove('active'); }
    if (chatSendBtn) { chatSendBtn.disabled = true; chatSendBtn.classList.remove('active'); }

    if (messagesArea) messagesArea.innerHTML = '';
    if (chatTitleText) chatTitleText.textContent = 'New Chat';
    await db.setMemory('current_session', null);
    setGeneratingUI(false);
    renderHistory();
}

async function askOllama(aiEl) {
    let full = '';
    let partialMessageId = null;
    try {
        // Create the assistant message record IMMEDIATELY as a placeholder
        const m = await db.addMessage(currentSessionId, 'assistant', '', { 
            model: activeModel, 
            interrupted: true 
        });
        partialMessageId = m.id;

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
        let tokenCount = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const token = JSON.parse(line).message?.content || '';
                    full += token;
                    tokenCount++;
                    aiEl.innerHTML = simpleMarkdown(full);
                    scrollBottom();
                    
                    if (tokenCount % 10 === 0) {
                        await db.updateMessage(partialMessageId, { content: full });
                    }
                } catch {}
            }
        }
        await db.updateMessage(partialMessageId, { content: full, interrupted: false });
        messages.push({ role: 'assistant', content: full });
        finalizeAIMessage(aiEl, full, activeModel);
        await syncSessionToDisk(currentSessionId);
    } catch (e) {
        aiEl.innerHTML = `<span style="color:#f87171">⚠ Connection failed. Ensure Ollama is running.</span>`;
        console.error('Streaming error:', e);
    }
}

async function appendUserMessage(text, isQueued = false) {
    const row = document.createElement('div');
    row.className = 'message-row user' + (isQueued ? ' queued' : '');
    row.innerHTML = `
        <div class="user-bubble">
            <button class="msg-delete-btn" title="Delete message">🗑</button>
            ${isQueued ? '<span class="queued-badge">Queued</span>' : ''}
            <div class="user-text">${escapeHtml(text)}</div>
            <button class="msg-copy-btn" title="Copy Message">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
            </button>
        </div>`;
    row.querySelector('.msg-delete-btn').onclick = async (e) => {
        e.stopPropagation();
        showModal({
            title: 'Delete Message?',
            text: 'Are you sure you want to delete this message?',
            confirmText: 'Delete',
            onConfirm: async () => {
                const msgs = await db.getMessages(currentSessionId);
                const msgObj = msgs.find(m => m.content === text && m.role === 'user');
                if (msgObj?.id) {
                    await db.deleteMessage(msgObj.id);
                    row.remove();
                    await syncSessionToDisk(currentSessionId);
                }
            }
        });
    };
    row.querySelector('.msg-copy-btn').onclick = (e) => copyToClipboard(text, e.currentTarget);
    messagesArea?.appendChild(row);
    scrollBottom();
    if (currentSessionId && !isQueued) {
        await db.addMessage(currentSessionId, 'user', text, { model: activeModel });
        await syncSessionToDisk(currentSessionId);
    }
}

function appendAIMessage() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `
        <div class="ai-avatar neutral"></div>
        <div class="ai-content">
            <div class="ai-text">
                <div class="typing-dots"><span></span><span></span><span></span></div>
            </div>
            <button class="msg-copy-btn ai" title="Copy Message">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
            </button>
        </div>`;
    messagesArea?.appendChild(row);
    scrollBottom();
    return row.querySelector('.ai-text');
}

function finalizeAIMessage(el, text, model) {
    el.innerHTML = simpleMarkdown(text);
    const row = el.closest('.message-row');
    const copyBtn = row.querySelector('.msg-copy-btn');
    if (copyBtn) copyBtn.onclick = (e) => copyToClipboard(text, e.currentTarget);
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-delete-btn';
    delBtn.title = 'Delete message';
    delBtn.innerText = '🗑';
    delBtn.onclick = async (e) => {
        e.stopPropagation();
        showModal({
            title: 'Delete AI Message?',
            text: 'Are you sure you want to delete this response?',
            confirmText: 'Delete',
            onConfirm: async () => {
                const msgs = await db.getMessages(currentSessionId);
                const msgObj = msgs.find(m => m.content === text && m.role === 'assistant');
                if (msgObj?.id) {
                    await db.deleteMessage(msgObj.id);
                    row.remove();
                    await syncSessionToDisk(currentSessionId);
                }
            }
        });
    };
    row.querySelector('.ai-content').appendChild(delBtn);
    const note = document.createElement('div');
    note.className = 'upgrade-note';
    note.innerHTML = `Mode: <strong>${model}</strong>`;
    el.parentElement.appendChild(note);
}

function appendInterruptionUI(row, sessionId, msgId) {
    const container = document.createElement('div');
    container.className = 'interrupted-container';
    container.innerHTML = `
        <div class="interrupted-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Message is interrupted because of user
        </div>
        <button class="restart-btn">Restart</button>
    `;
    container.querySelector('.restart-btn').onclick = () => restartResponse(sessionId, msgId);
    row.querySelector('.ai-content').appendChild(container);
}

async function restartResponse(sessionId, msgId) {
    await db.deleteMessage(msgId);
    await loadSession(sessionId);
    const msgs = await db.getMessages(sessionId);
    const aiEl = appendAIMessage();
    isGenerating = true;
    setGeneratingUI(true);
    messages = msgs.map(m => ({ role: m.role, content: m.content }));
    await askOllama(aiEl);
}

async function generateSessionTitle(id, text, ctx) {
    try {
        const systemPrompt = "Summarize in 3 words (Max 5 words):";
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            body: JSON.stringify({
                 model: OLLAMA_MODEL,
                 system: systemPrompt,
                 messages: [{ role:'user', content: text }],
                 stream: false
             })
        });
        const data = await res.json();
        let title = (data.message?.content || text.slice(0, 20)).replace(/"/g,'');
        title = title.split(' ').slice(0, 7).join(' ');
        await db.updateSession(id, { title });
        if (currentSessionId === id && chatTitleText) chatTitleText.textContent = title;
        renderHistory();
    } catch {}
}

async function syncSessionToDisk(sessionId) {
    try {
        const session = await db.getSession(sessionId);
        const msgs = await db.getMessages(sessionId);
        if (!session) return;
        await fetch('http://localhost:3001/api/save_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sessionId, data: { ...session, messages: msgs } })
        });
    } catch (e) { console.error('Disk sync failed:', e); }
}

async function renderHistory() {
    if (!historyList) return;
    const sessions = await db.getAllSessions();
    sessions.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    historyList.innerHTML = '';
    sessions.forEach(s => {
        historyList.appendChild(createHistoryItem(s));
    });
    if (!historyList.classList.contains('collapsed')) {
        historyList.style.maxHeight = historyList.scrollHeight + "px";
    }
}

function createHistoryItem(session) {
    const div = document.createElement('div');
    div.className = `history-item ${session.id === currentSessionId ? 'active' : ''}`;
    div.dataset.id = session.id;
    div.onclick = () => { loadSession(session.id); };
    div.innerHTML = `
        <div class="history-item-content">${escapeHtml(session.title)}</div>
        <div class="history-item-actions">
            ${session.isPinned ? '<span class="history-item-pin">📌</span>' : ''}
            <div class="history-item-more">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            </div>
        </div>`;
    const moreBtn = div.querySelector('.history-item-more');
    moreBtn.onclick = (e) => {
        e.stopPropagation();
        showContextMenu(session.id, moreBtn);
    };
    return div;
}

let contextSessionId = null;
const ctxMenu = getEl('chat-context-menu');

function showContextMenu(sessionId, anchor) {
    contextSessionId = sessionId;
    const rect = anchor.getBoundingClientRect();
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = (rect.left - 180) + 'px';
    ctxMenu.style.top = (rect.bottom + 5) + 'px';
    ctxMenu.classList.add('active');
    const closeHandler = () => { ctxMenu.classList.remove('active'); ctxMenu.style.display = 'none'; document.removeEventListener('click', closeHandler); };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

document.getElementById('menu-rename')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    ctxMenu.classList.remove('active');
    ctxMenu.style.display = 'none';
    if (!contextSessionId) return;
    const s = await db.getSession(contextSessionId);
    showModal({
        title: 'Rename Chat',
        text: 'Enter a new name for this session:',
        confirmText: 'Rename',
        showInput: true,
        inputValue: s.title,
        onConfirm: async (newName) => {
            if (newName) {
                await db.updateSession(contextSessionId, { title: newName });
                if (currentSessionId === contextSessionId && chatTitleText) chatTitleText.textContent = newName;
                renderHistory();
            }
        }
    });
});

document.getElementById('menu-pin')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    ctxMenu.classList.remove('active');
    ctxMenu.style.display = 'none';
    if (!contextSessionId) return;
    const s = await db.getSession(contextSessionId);
    await db.updateSession(contextSessionId, { isPinned: !s.isPinned });
    renderHistory();
});

document.getElementById('menu-delete')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    ctxMenu.classList.remove('active');
    ctxMenu.style.display = 'none';
    if (!contextSessionId) return;
    showModal({
        title: 'Delete Chat?',
        text: 'Are you sure you want to delete this session?',
        confirmText: 'Delete',
        onConfirm: async () => {
            await db.deleteSession(contextSessionId);
            if (currentSessionId === contextSessionId) {
                currentSessionId = null;
                messages = [];
                if (messagesArea) messagesArea.innerHTML = '';
                if (chatTitleText) chatTitleText.textContent = 'New Chat';
                switchToHome();
            }
            renderHistory();
        }
    });
});

async function loadSession(id) {
    const s = await db.getSession(id);
    if (!s) return;
    currentSessionId = id;
    messages = await db.getMessages(id);
    switchToChat();
    if (messagesArea) {
        messagesArea.innerHTML = '';
        const fragment = document.createDocumentFragment();
        messages.forEach(m => {
            const row = document.createElement('div');
            row.className = m.role === 'user' ? 'message-row user' : 'message-row assistant';
            if (m.role === 'user') {
                row.innerHTML = `<div class="user-bubble"><div class="user-text">${escapeHtml(m.content)}</div></div>`;
            } else {
                row.innerHTML = `
                    <div class="ai-avatar neutral"></div>
                    <div class="ai-content">
                        <div class="ai-text">${simpleMarkdown(m.content)}</div>
                        <div class="upgrade-note">Mode: <strong>${m.model || 'Llama-3'}</strong></div>
                    </div>`;
            }
            fragment.appendChild(row);
            
            // If it's the last message and interrupted, show recovery UI
            if (m === messages[messages.length - 1] && m.role === 'assistant' && m.interrupted) {
                appendInterruptionUI(row, id, m.id);
            }
        });
        messagesArea.appendChild(fragment);
    }
    if (chatTitleText) chatTitleText.textContent = s.title;
    scrollBottom();
    renderHistory();
}

async function updateAIPersona() {
    const sessions = await db.getAllSessions();
    const recentSummaries = sessions.slice(0, 5).map(s => s.title).join(', ');
    let pattern = sessions.length > 5 ? `\n[USER PATTERNS]: Recently discusses: ${recentSummaries}.` : '';
    CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[activeModel] + pattern;
}

// ─── Initialization ──────────────────────────────────────────────────────────
function bindTA(ta, btn) {
    ta?.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 300) + 'px';
        btn.disabled = !ta.value.trim();
        btn.classList.toggle('active', !btn.disabled);
    });
    ta?.addEventListener('keydown', (e) => { 
        if(e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            if(!btn.disabled) btn.click(); 
        } 
    });
}

bindTA(homeTA, homeSendBtn);
bindTA(chatTA, chatSendBtn);

homeSendBtn?.addEventListener('click', () => {
    const val = homeTA.value.trim();
    if (val) { homeTA.value = ''; switchToChat(); sendMessage(val); }
});

chatSendBtn?.addEventListener('click', () => {
    const val = chatTA.value.trim();
    if (val) { chatTA.value = ''; chatTA.style.height = 'auto'; sendMessage(val); }
});

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

newChatBtn?.addEventListener('click', startNewChat);
getEl('back-to-home-btn')?.addEventListener('click', startNewChat);

function setRailActive(el) {
    document.querySelectorAll('.rail-item').forEach(item => item.classList.remove('active'));
    el?.classList.add('active');
}

railHome?.addEventListener('click', (e) => {
    e.stopPropagation();
    setRailActive(railHome);
    historyPanel?.classList.remove('active');
    mainLayout?.classList.remove('history-open');
    switchToHome();
});

railChat?.addEventListener('click', (e) => {
    e.stopPropagation();
    setRailActive(railChat);
    historyPanel?.classList.toggle('active');
    mainLayout?.classList.toggle('history-open');
    if (historyPanel?.classList.contains('active')) renderHistory();
});

// COLLAPSE HISTORY
document.querySelector('.recents-header')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const header = document.querySelector('.recents-header');
    header.classList.toggle('collapsed');
    historyList?.classList.toggle('collapsed');
    if (!historyList.classList.contains('collapsed')) {
        historyList.style.maxHeight = historyList.scrollHeight + "px";
    }
});

// AUTO-CLOSE PANEL
document.addEventListener('click', (e) => {
    const isClickInside = historyPanel?.contains(e.target) || 
                         railChat?.contains(e.target) || 
                         ctxMenu?.contains(e.target);
    const isModalOpen = modalOverlay?.classList.contains('active') || 
                        settingsModal?.classList.contains('active');
    
    if (!isClickInside && !isModalOpen && historyPanel?.classList.contains('active')) {
        historyPanel.classList.remove('active');
        mainLayout?.classList.remove('history-open');
        railChat?.classList.remove('active');
        railHome?.classList.add('active');
    }
});

(async () => {
    try {
        await updateAIPersona();
        const last = await db.getMemory('current_session');
        if (last) {
            await loadSession(last);
        } else {
            homeView?.classList.add('active');
            await renderHistory();
        }
    } catch (err) {
        console.error('Init error:', err);
        homeView?.classList.add('active');
    }
})();
