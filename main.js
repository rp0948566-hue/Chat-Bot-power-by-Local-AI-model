// ─── State & Intelligence Configuration ──────────────────────────────────────
import { db } from './db.js';

const OLLAMA_URL   = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3';

let messages         = [];
let isGenerating     = false;
let messageQueue     = [];
let currentAiEl      = null;
let currentSessionId = null; 

// ── SYSTEM PROMPTS (PhD-Level Phrasing) ──────────────────────────────────────
// ── SYSTEM PROMPTS (PhD-Level Computer Use) ──────────────────────────────────
const COMPUTER_USE_DIRECTIVE = `
YOU HAVE COMPUTER CONTROL CAPABILITIES.
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

Always proceed step-by-step. If you need to see the screen, take a screenshot first. If you need to find a file, search first.
`;

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
const newChatBtn       = getEl('new-chat-btn');

// ─── Global Constants Dependent on DOM ──────────────────────────────────────
const modelOptions = document.querySelectorAll('.model-option');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');

const modalOverlay = getEl('custom-modal-overlay');
const modalTitle   = getEl('modal-title');
const modalText    = getEl('modal-text');
const modalCancel  = getEl('modal-cancel-btn');
const modalConfirm = getEl('modal-confirm-btn');

/**
 * Custom Modal Utility
 * @param {Object} options - { title, text, confirmText, onConfirm }
 */
function showModal({ title, text, confirmText, onConfirm }) {
    modalTitle.innerText = title;
    modalText.innerText = text;
    modalConfirm.innerText = confirmText || 'Confirm';
    modalOverlay.classList.add('active');

    const cleanup = () => {
        modalOverlay.classList.remove('active');
        modalConfirm.onclick = null;
        modalCancel.onclick  = null;
    };

    modalConfirm.onclick = () => { onConfirm(); cleanup(); };
    modalCancel.onclick  = cleanup;
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) cleanup(); };
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
        // Task Lists
        .replace(/^\[x\] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" checked disabled> <span>$1</span></li>')
        .replace(/^\[ \] (.*$)/gim, '<li class="task-list-item"><input type="checkbox" disabled> <span>$1</span></li>')
        // Lists
        .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
        .replace(/^\* (.*$)/gim, '<li>$1</li>')
        // Blockquotes
        .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Simple Table Support
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

    // Handle paragraphs and line breaks better
    html = html.split('\n\n').map(p => {
        if (p.trim().startsWith('<')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return html;
}

function setGeneratingUI(active) {
    const stopSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
    const sendSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    const queueSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

    // DO NOT disable inputs, allow continuous typing/queuing
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
async function sendMessage(userText, isQueued = false) {
    if (isGenerating && !isQueued) {
        messageQueue.push(userText);
        appendUserMessage(userText, true); // true = queued state
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
        // Find the queued message and make it active
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
    
    // Check for action blocks in final AI response
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
                const feedback = `Action: ${action.type} succeeded. Screenshot received.`;
                messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: ${feedback}` });
                sendMessage("I've taken a screenshot. Analyzing it now...", true);
            } else {
                finalizeActionResult(resultArea, `Success: ${data.output}`);
                const feedback = `Action: ${action.type} succeeded. Result: ${data.output}`;
                messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: ${feedback}` });
                sendMessage("Action complete. Continuing...", true);
            }
        } else {
            finalizeActionResult(resultArea, `Error: ${data.error}`, true);
            const feedback = `Action: ${action.type} failed. Error: ${data.error}`;
            messages.push({ role: 'user', content: `[SYSTEM FEEDBACK]: ${feedback}` });
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
    
    switchToHome();
    if (messagesArea) messagesArea.innerHTML = '';
    if (chatTitleText) chatTitleText.textContent = 'New Chat';
    
    await db.setMemory('current_session', null);
    setGeneratingUI(false);
    renderHistory();
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
        </div>
    `;
    
    row.querySelector('.msg-delete-btn').onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Delete this message?')) {
            const msgs = await db.getMessages(currentSessionId);
            const msgObj = msgs.find(m => m.content === text && m.role === 'user');
            if (msgObj?.id) {
                await db.deleteMessage(msgObj.id);
                row.remove();
                await syncSessionToDisk(currentSessionId);
            }
        }
    };
    
    row.querySelector('.msg-copy-btn').onclick = (e) => copyToClipboard(text, e.currentTarget);
    
    messagesArea?.appendChild(row);
    scrollBottom();
    if (currentSessionId && !isQueued) {
        await db.addMessage(currentSessionId, 'user', text, activeModel);
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
        </div>
    `;
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
        if (confirm('Delete this message?')) {
            const msgs = await db.getMessages(currentSessionId);
            const msgObj = msgs.find(m => m.content === text && m.role === 'assistant');
            if (msgObj?.id) {
                await db.deleteMessage(msgObj.id);
                row.remove();
                await syncSessionToDisk(currentSessionId);
            }
        }
    };
    row.querySelector('.ai-content').appendChild(delBtn);

    const note = document.createElement('div');
    note.className = 'upgrade-note';
    note.innerHTML = `Mode: <strong>${model}</strong>`;
    el.parentElement.appendChild(note);
}

async function generateSessionTitle(id, text, ctx) {
    try {
        // Premium Intelligence Injection for title generation
        const systemPrompt = "You are a world-class AI assistant with PhD-level intelligence, specializing in clear, structured, and sophisticated communication. You reason deeply and provide accurate, helpful, and beautifully formatted responses. Use headers, tables, task lists, and blockquotes whenever they improve clarity. Your persona is professional yet accessible, much like Claude or GPT-4. Always prioritize detail and accuracy.";
        
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                model: OLLAMA_MODEL, 
                system: systemPrompt + " Summarize in 3 words (Max 5 words): " + ctx, 
                messages: [{ role:'user', content: text }], 
                stream: false 
            })
        });
        const data = await res.json();
        let title = (data.message?.content || text.slice(0, 20)).replace(/"/g,'');
        // Final word limit enforcement
        title = title.split(' ').slice(0, 7).join(' ') + (title.split(' ').length > 7 ? '...' : '');
        await db.updateSession(id, { title });
        if (currentSessionId === id && chatTitleText) chatTitleText.textContent = title;
        renderHistory();
    } catch {}
}

// ─── History Sync & UI ───────────────────────────────────────────────────────
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
    } catch (e) {
        console.error('Disk sync failed:', e);
    }
}

async function togglePin(sessionId, e) {
    if (e) e.stopPropagation();
    const session = await db.getSession(sessionId);
    if (!session) return;
    await db.updateSession(sessionId, { isPinned: !session.isPinned });
    await syncSessionToDisk(sessionId);
    renderHistory();
}

async function toggleFolderPin(folderId, e) {
    if (e) e.stopPropagation();
    const folders = await db.getMemory('folders') || [];
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
        folder.isPinned = !folder.isPinned;
        await db.setMemory('folders', folders);
        renderHistory();
    }
}

async function createFolder() {
    const name = prompt('Folder Name:');
    if (!name) return;
    const folders = await db.getMemory('folders') || [];
    const id = `folder_${Date.now()}`;
    folders.push({ id, name, isOpen: true });
    await db.setMemory('folders', folders);
    renderHistory();
}

async function deleteFolder(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Delete folder? Chats will remain.')) return;
    const folders = await db.getMemory('folders') || [];
    const updated = folders.filter(f => f.id !== id);
    await db.setMemory('folders', updated);
    
    // Clear folderId from sessions in this folder
    const sessions = await db.getAllSessions();
    for (const s of sessions) {
        if (s.folderId === id) await db.updateSession(s.id, { folderId: null });
    }
    renderHistory();
}

async function moveSessionToFolder(sessionId, folderId) {
    await db.updateSession(sessionId, { folderId });
    await syncSessionToDisk(sessionId);
    renderHistory();
}

async function renderHistory() {
    if (!historyList) return;
    const sessions = await db.getAllSessions();
    const folders  = await db.getMemory('folders') || [];
    
    historyList.innerHTML = '';

    // 1. STARRED (Pinned Folders & Global Pinned Chats)
    const pinnedFolders = folders.filter(f => f.isPinned);
    const globalPinnedChats = sessions.filter(s => s.isPinned && !s.folderId);
    
    if (pinnedFolders.length > 0 || globalPinnedChats.length > 0) {
        appendHistoryHeader('Starred');
        pinnedFolders.forEach(f => renderFolderWithChats(f, sessions));
        globalPinnedChats.forEach(s => historyList.appendChild(createHistoryItem(s)));
    }

    // 2. FOLDERS (Unpinned)
    const otherFolders = folders.filter(f => !f.isPinned);
    if (otherFolders.length > 0) {
        appendHistoryHeader('Categories');
        otherFolders.forEach(f => renderFolderWithChats(f, sessions));
    }

    // 3. RECENT (Smart Categories: Today, Yesterday, Earlier)
    const recent = sessions.filter(s => !s.isPinned && !s.folderId);
    if (recent.length > 0) {
        const groups = groupSessionsByDate(recent);
        if (groups.today.length > 0) {
            appendHistoryHeader('Today');
            groups.today.forEach(s => historyList.appendChild(createHistoryItem(s)));
        }
        if (groups.yesterday.length > 0) {
            appendHistoryHeader('Yesterday');
            groups.yesterday.forEach(s => historyList.appendChild(createHistoryItem(s)));
        }
        if (groups.earlier.length > 0) {
            appendHistoryHeader('Earlier');
            groups.earlier.forEach(s => historyList.appendChild(createHistoryItem(s)));
        }
    }
}

function renderFolderWithChats(folder, allSessions) {
    const folderEl = createFolderUI(folder);
    historyList.appendChild(folderEl);
    
    const folderSessions = allSessions.filter(s => s.folderId === folder.id);
    // Sort pinned chats in folder to the top
    folderSessions.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
    folderSessions.forEach(s => {
        const item = createHistoryItem(s, true);
        historyList.appendChild(item);
    });
}

function groupSessionsByDate(sessions) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = { today: [], yesterday: [], earlier: [] };
    sessions.forEach(s => {
        const d = new Date(s.updatedAt || s.createdAt || Date.now());
        d.setHours(0,0,0,0);
        if (d.getTime() === today.getTime()) groups.today.push(s);
        else if (d.getTime() === yesterday.getTime()) groups.yesterday.push(s);
        else groups.earlier.push(s);
    });
    return groups;
}

function appendHistoryHeader(text) {
    const h = document.createElement('div');
    h.className = 'history-header-divider';
    h.innerText = text;
    historyList.appendChild(h);
}

function createHistoryItem(session, isSub = false) {
    const div = document.createElement('div');
    div.className = `history-item ${session.id === currentSessionId ? 'active' : ''} ${isSub ? 'sub-item' : ''}`;
    div.onclick = () => { loadSession(session.id); closeSidebar(); };
    
    div.innerHTML = `
        <div class="hist-main">
            <span class="history-item-title">${escapeHtml(session.title)}</span>
        </div>
        <div class="hist-actions">
            <button class="hist-action-btn pin-btn" title="${session.isPinned ? 'Unpin' : 'Pin'}">
                ${session.isPinned ? '📍' : '📌'}
            </button>
            <button class="hist-action-btn folder-btn" title="Move to folder">📁</button>
            <button class="hist-action-btn delete-btn" title="Delete">🗑</button>
        </div>
    `;

    div.querySelector('.pin-btn').onclick = (e) => togglePin(session.id, e);
    div.querySelector('.delete-btn').onclick = async (e) => {
        e.stopPropagation();
        showModal({
            title: 'Delete Chat?',
            text: `Are you sure you want to delete "${session.title}"? This cannot be undone.`,
            confirmText: 'Delete',
            onConfirm: async () => {
                await db.deleteSession(session.id);
                await fetch(`http://localhost:3001/api/delete_session/${session.id}`, { method: 'DELETE' }).catch(() => {});
                if (currentSessionId === session.id) startNewChat();
                else renderHistory();
            }
        });
    };
    div.querySelector('.folder-btn').onclick = async (e) => {
        e.stopPropagation();
        const folders = await db.getMemory('folders') || [];
        if (folders.length === 0) return alert('Create a folder first!');
        const folderList = folders.map((f, i) => `${i+1}. ${f.name}`).join('\n');
        const choice = prompt(`Move to folder:\n0. None\n${folderList}`);
        if (choice === null) return;
        const idx = parseInt(choice) - 1;
        await moveSessionToFolder(session.id, idx === -1 ? null : folders[idx].id);
    };

    return div;
}

function createFolderUI(folder) {
    const div = document.createElement('div');
    div.className = `history-folder-item ${folder.isPinned ? 'pinned' : ''}`;
    
    // Smart Icon Detection
    let icon = '📂';
    const name = folder.name.toLowerCase();
    if (name.includes('tech') || name.includes('code')) icon = '💻';
    else if (name.includes('work') || name.includes('comp')) icon = '💼';
    else if (name.includes('small') || name.includes('mini')) icon = '🧊';
    else if (name.includes('big') || name.includes('large')) icon = '🏔️';
    else if (name.includes('brain') || name.includes('ai')) icon = '🧠';

    div.innerHTML = `
        <span class="folder-title">${icon} ${escapeHtml(folder.name)}</span>
        <div class="folder-actions">
            <button class="folder-action-pin" title="${folder.isPinned ? 'Unpin' : 'Pin'}">${folder.isPinned ? '📍' : '📌'}</button>
            <button class="folder-action-del">×</button>
        </div>
    `;
    div.querySelector('.folder-action-pin').onclick = (e) => toggleFolderPin(folder.id, e);
    div.querySelector('.folder-action-del').onclick = (e) => deleteFolder(folder.id, e);
    return div;
}

async function updateAIPersona() {
    const sessions = await db.getAllSessions();
    const recentSummaries = sessions.slice(0, 5).map(s => s.title).join(', ');
    
    let pattern = '';
    if (sessions.length > 5) {
        pattern = `\n[USER PATTERNS/PREFERENCES]: You've noticed the user recently discusses: ${recentSummaries}. Use this context to anticipate their needs and style.`;
    }

    CLAUDE_SYSTEM_PROMPT = MODEL_PROMPTS[activeModel] + pattern;
}

async function loadSession(id) {
    const s = await db.getSession(id);
    if (!s) return;
    currentSessionId = id;
    messages = await db.getMessages(id);
    switchToChat();
    if (messagesArea) {
        messagesArea.innerHTML = '';
        // Efficiently render all messages
        const fragment = document.createDocumentFragment();
        messages.forEach(m => {
            const row = document.createElement('div');
            if (m.role === 'user') {
                row.className = 'message-row user';
                row.innerHTML = `
                    <div class="user-bubble">
                        <button class="msg-delete-btn" title="Delete message">🗑</button>
                        <div class="user-text">${escapeHtml(m.content)}</div>
                    </div>
                `;
                row.querySelector('.msg-delete-btn').onclick = async () => {
                    if (confirm('Delete message?')) {
                        await db.deleteMessage(m.id);
                        row.remove();
                        await syncSessionToDisk(currentSessionId);
                    }
                };
            } else {
                row.className = 'message-row assistant';
                row.innerHTML = `
                    <div class="ai-avatar neutral"></div>
                    <div class="ai-content">
                        <button class="msg-delete-btn" title="Delete message">🗑</button>
                        <div class="ai-text">${simpleMarkdown(m.content)}</div>
                        <div class="upgrade-note">Mode: <strong>${m.model}</strong></div>
                    </div>
                `;
                row.querySelector('.msg-delete-btn').onclick = async () => {
                    if (confirm('Delete message?')) {
                        await db.deleteMessage(m.id);
                        row.remove();
                        await syncSessionToDisk(currentSessionId);
                    }
                };
            }
            fragment.appendChild(row);
        });
        messagesArea.appendChild(fragment);
    }
    if (chatTitleText) chatTitleText.textContent = s.title;
    scrollBottom();
    renderHistory();
    await updateAIPersona();
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
    if (val) { 
        chatTA.value = ''; 
        chatTA.style.height = 'auto';
        sendMessage(val); 
    }
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

newChatBtn?.addEventListener('click', startNewChat);
getEl('back-to-home-btn')?.addEventListener('click', startNewChat);

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startNewChat();
    }
});

getEl('new-folder-btn')?.addEventListener('click', createFolder);

// Account Linking Logic (Deep Integration)
async function fetchGitHubProfile(token) {
    try {
        const h = { 'Authorization': `token ${token}` };
        const [uRes, rRes] = await Promise.all([
            fetch('https://api.github.com/user', { headers: h }),
            fetch('https://api.github.com/user/repos?sort=updated&per_page=5', { headers: h })
        ]);
        if (!uRes.ok) throw new Error('Invalid Token');
        const user = await uRes.json();
        const repos = await rRes.json();
        return {
            login: user.login,
            name: user.name,
            bio: user.bio,
            public_repos: user.public_repos,
            repos: repos.map(r => ({ name: r.name, lang: r.language, url: r.html_url }))
        };
    } catch (e) { console.error('GitHub Sync Error:', e); return null; }
}

async function updateLinkUI() {
    const linked = await db.getMemory('linked_accounts') || {};
    
    // GitHub
    const ghMeta = document.getElementById('github-metadata');
    const ghBtn  = document.getElementById('link-github-btn');
    if (linked.github_data && ghMeta && ghBtn) {
        const d = linked.github_data;
        ghMeta.style.display = 'block';
        ghMeta.innerHTML = `Connected as <strong>@${d.login}</strong> • ${d.public_repos} repos`;
        ghBtn.innerText = 'Connected';
        ghBtn.classList.add('connected');
    }

    // LinkedIn
    const liMeta = document.getElementById('linkedin-metadata');
    const liBtn  = document.getElementById('link-linkedin-btn');
    if (linked.linkedin && liMeta && liBtn) {
        liMeta.style.display = 'block';
        liMeta.innerHTML = `Linked: ${linked.linkedin.slice(0, 30)}...`;
        liBtn.innerText = 'Connected';
        liBtn.classList.add('connected');
    }
}

document.getElementById('link-github-btn')?.addEventListener('click', async () => {
    const token = prompt('Enter your GitHub Personal Access Token (classic, with repo scope):');
    if (token) {
        const btn = document.getElementById('link-github-btn');
        const originalText = btn.innerText;
        btn.innerText = 'Syncing...';
        const data = await fetchGitHubProfile(token);
        if (data) {
            const linked = await db.getMemory('linked_accounts') || {};
            linked.github_token = token;
            linked.github_data = data;
            await db.setMemory('linked_accounts', linked);
            updateLinkUI();
            alert(`Success! Successfully connected to @${data.login}.`);
        } else {
            alert('Error: Failed to fetch profile. Check your token.');
            btn.innerText = originalText;
        }
    }
});

document.getElementById('link-linkedin-btn')?.addEventListener('click', async () => {
    const url = prompt('Enter your LinkedIn Profile URL:');
    if (url) {
        const linked = await db.getMemory('linked_accounts') || {};
        linked.linkedin = url;
        await db.setMemory('linked_accounts', linked);
        updateLinkUI();
    }
});

// RUN 
(async () => {
    try {
        await updateLinkUI();
        await updateAIPersona();
        const last = await db.getMemory('current_session');
        if (last) {
            await loadSession(last);
        } else {
            homeView?.classList.add('active');
            await renderHistory();
        }
        setActiveModel(activeModel);
    } catch (err) {
        console.error('Init error:', err);
        // Always show home view as safe fallback
        homeView?.classList.add('active');
        chatView?.classList.remove('active');
    }
})();
