// ─── ChatDB: Unlimited Persistent Memory via IndexedDB ────────────────────
// Stores every message, session, and model selection permanently.
// No size limits (unlike localStorage's 5 MB). Survives page reloads.
// All operations are async and non-blocking.

const DB_NAME    = 'KimiChatDB';
const DB_VERSION = 2;
const STORES = {
    sessions : 'sessions',  // { id, title, createdAt, updatedAt, model }
    messages : 'messages',  // { id, sessionId, role, content, model, timestamp }
    memory   : 'memory',    // { key, value }  — global KV store for AI context
};

class ChatDB {
    constructor() {
        this._db = null;
        this._ready = this._open();
    }

    // ── Open / upgrade database ───────────────────────────────────────────
    _open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;

                if (!db.objectStoreNames.contains(STORES.sessions)) {
                    const s = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
                    s.createIndex('updatedAt', 'updatedAt');
                }

                if (!db.objectStoreNames.contains(STORES.messages)) {
                    const m = db.createObjectStore(STORES.messages, {
                        keyPath: 'id', autoIncrement: true
                    });
                    m.createIndex('sessionId', 'sessionId');
                    m.createIndex('timestamp', 'timestamp');
                }

                if (!db.objectStoreNames.contains(STORES.memory)) {
                    db.createObjectStore(STORES.memory, { keyPath: 'key' });
                }
            };

            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };

            req.onerror = () => reject(req.error);
        });
    }

    async _tx(stores, mode, fn) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const storeList = Array.isArray(stores) ? stores : [stores];
            const tx  = this._db.transaction(storeList, mode);
            const out = fn(tx);
            tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
            tx.onerror    = () => reject(tx.error);
        });
    }

    _req(req) {
        return new Promise((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror   = () => rej(req.error);
        });
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    
    async createSession(title = 'New Chat', model = 'instant') {
        await this._ready;
        const id  = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        const session = { 
            id, title, model, 
            createdAt: now, updatedAt: now,
            isPinned: false, folderId: null 
        };
        await this._req(
            this._db.transaction(STORES.sessions, 'readwrite')
                    .objectStore(STORES.sessions).put(session)
        );
        await this.setMemory('current_session', id);
        return session;
    }

    async getSession(id) {
        await this._ready;
        return this._req(
            this._db.transaction(STORES.sessions, 'readonly')
                    .objectStore(STORES.sessions).get(id)
        );
    }

    async updateSession(id, patch) {
        await this._ready;
        const session = await this.getSession(id);
        if (!session) return;
        Object.assign(session, patch, { updatedAt: new Date().toISOString() });
        await this._req(
            this._db.transaction(STORES.sessions, 'readwrite')
                    .objectStore(STORES.sessions).put(session)
        );
        return session;
    }

    async getAllSessions() {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx    = this._db.transaction(STORES.sessions, 'readonly');
            const store = tx.objectStore(STORES.sessions);
            const req   = store.index('updatedAt').openCursor(null, 'prev');
            const sessions = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { sessions.push(cursor.value); cursor.continue(); }
                else resolve(sessions);
            };
            req.onerror = () => reject(req.error);
        });
    }

    async deleteSession(id) {
        await this._ready;
        // Delete all messages for session
        const msgs = await this.getMessages(id);
        const tx   = this._db.transaction(
            [STORES.sessions, STORES.messages], 'readwrite'
        );
        tx.objectStore(STORES.sessions).delete(id);
        msgs.forEach(m => tx.objectStore(STORES.messages).delete(m.id));
        return new Promise((res, rej) => {
            tx.oncomplete = res;
            tx.onerror    = () => rej(tx.error);
        });
    }

    // ── Messages ──────────────────────────────────────────────────────────

    async addMessage(sessionId, role, content, extra = {}) {
        await this._ready;
        const timestamp = new Date().toISOString();
        const msg = { sessionId, role, content, timestamp, ...extra };
        const id  = await this._req(
            this._db.transaction(STORES.messages, 'readwrite')
                    .objectStore(STORES.messages).add(msg)
        );
        // Also update session title from first user message
        if (role === 'user') {
            const session = await this.getSession(sessionId);
            if (session && session.title === 'New Chat') {
                await this.updateSession(sessionId, { title: 'New Chat...', model });
            } else {
                await this.updateSession(sessionId, { model });
            }
        }
        return { ...msg, id };
    }

    async getMessages(sessionId) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx     = this._db.transaction(STORES.messages, 'readonly');
            const store  = tx.objectStore(STORES.messages);
            const index  = store.index('sessionId');
            const req    = index.openCursor(IDBKeyRange.only(sessionId));
            const msgs   = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { msgs.push(cursor.value); cursor.continue(); }
                else resolve(msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
            };
            req.onerror = () => reject(req.error);
        });
    }

    // Returns all messages across ALL sessions for AI long-term memory
    async getAllMessages(limit = 500) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx    = this._db.transaction(STORES.messages, 'readonly');
            const store = tx.objectStore(STORES.messages);
            const index = store.index('timestamp');
            const req   = index.openCursor(null, 'prev');
            const msgs  = [];
            let   count = 0;
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && count < limit) {
                    msgs.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    resolve(msgs.reverse()); // chronological order
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async deleteMessage(id) {
        await this._ready;
        return this._req(
            this._db.transaction(STORES.messages, 'readwrite')
                    .objectStore(STORES.messages).delete(id)
        );
    }

    async updateMessage(id, updates) {
        await this._ready;
        const tx = this._db.transaction(STORES.messages, 'readwrite');
        const store = tx.objectStore(STORES.messages);
        const msg = await this._req(store.get(id));
        if (!msg) return;
        Object.assign(msg, updates);
        await this._req(store.put(msg));
        // Simple return once done
        return msg;
    }

    // ── Global KV Memory ──────────────────────────────────────────────────

    async setMemory(key, value) {
        await this._ready;
        await this._req(
            this._db.transaction(STORES.memory, 'readwrite')
                    .objectStore(STORES.memory).put({ key, value })
        );
    }

    async getMemory(key) {
        await this._ready;
        const rec = await this._req(
            this._db.transaction(STORES.memory, 'readonly')
                    .objectStore(STORES.memory).get(key)
        );
        return rec?.value ?? null;
    }

    // ── Export ────────────────────────────────────────────────────────────

    async exportAll() {
        const [sessions, messages] = await Promise.all([
            this.getAllSessions(),
            this.getAllMessages(10000),
        ]);
        const blob = new Blob(
            [JSON.stringify({ exportedAt: new Date().toISOString(), sessions, messages }, null, 2)],
            { type: 'application/json' }
        );
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `kimi-chat-history-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    async getStats() {
        const [sessions, messages] = await Promise.all([
            this.getAllSessions(),
            this.getAllMessages(100000),
        ]);
        return {
            totalSessions  : sessions.length,
            totalMessages  : messages.length,
            totalChars     : messages.reduce((s, m) => s + m.content.length, 0),
            oldestMessage  : messages[0]?.timestamp || null,
            latestMessage  : messages[messages.length - 1]?.timestamp || null,
        };
    }
}

// Singleton export
export const db = new ChatDB();
