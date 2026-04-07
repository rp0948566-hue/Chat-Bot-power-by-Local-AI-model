import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { glob } from 'glob';
import screenshot from 'screenshot-desktop';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Helper to run shell commands
const runShell = (cmd) => {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: stderr || error.message });
            } else {
                resolve({ success: true, output: stdout });
            }
        });
    });
};

// Helper for PowerShell (Better for Windows interaction)
const runPS = (script) => {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', ['-Command', script]);
        let stdout = '';
        let stderr = '';
        ps.stdout.on('data', (data) => stdout += data.toString());
        ps.stderr.on('data', (data) => stderr += data.toString());
        ps.on('close', () => resolve({ success: !stderr, output: stdout, error: stderr }));
    });
};

const HISTORY_DIR = path.join(__dirname, 'history');

// Ensure history directory exists
(async () => {
    try {
        await fs.mkdir(HISTORY_DIR, { recursive: true });
        console.log('History directory ready:', HISTORY_DIR);
    } catch (err) {
        console.error('Failed to create history directory:', err);
    }
})();

app.post('/api/save_session', async (req, res) => {
    const { id, data } = req.body;
    try {
        const filePath = path.join(HISTORY_DIR, `${id}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        res.json({ success: true, output: `Session ${id} saved to file.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/load_all_sessions', async (req, res) => {
    try {
        const files = await fs.readdir(HISTORY_DIR);
        const sessions = await Promise.all(
            files.filter(f => f.endsWith('.json') && !f.startsWith('_')).map(async f => {
                const content = await fs.readFile(path.join(HISTORY_DIR, f), 'utf8');
                return JSON.parse(content);
            })
        );
        res.json({ success: true, output: sessions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/delete_session/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const filePath = path.join(HISTORY_DIR, `${id}.json`);
        await fs.unlink(filePath);
        res.json({ success: true, output: `Session ${id} deleted.` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/global_memory', async (req, res) => {
    try {
        const filePath = path.join(HISTORY_DIR, '_global_memory.json');
        const content = await fs.readFile(filePath, 'utf8');
        res.json({ success: true, output: JSON.parse(content) });
    } catch (err) {
        res.json({ success: true, output: null });
    }
});

app.get('/api/search_sessions', async (req, res) => {
    const query = (req.query.q || '').toLowerCase();
    if (!query) return res.json({ success: true, output: [] });
    try {
        const files = await fs.readdir(HISTORY_DIR);
        const results = [];
        for (const f of files.filter(f => f.endsWith('.json'))) {
            const content = await fs.readFile(path.join(HISTORY_DIR, f), 'utf8');
            const data = JSON.parse(content);
            const titleMatch = data.title && data.title.toLowerCase().includes(query);
            const msgMatches = (data.messages || []).filter(m => m.content && m.content.toLowerCase().includes(query));
            if (titleMatch || msgMatches.length > 0) {
                results.push({
                    sessionId: data.id,
                    title: data.title,
                    titleMatch,
                    matchingMessages: msgMatches.slice(0, 5).map(m => ({
                        role: m.role,
                        content: m.content.substring(0, 200),
                        timestamp: m.timestamp
                    }))
                });
            }
        }
        res.json({ success: true, output: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/action', async (req, res) => {
    const { type, params } = req.body;
    console.log(`[ACTION] ${type}`, params);

    try {
        switch (type) {
            case 'shell':
                return res.json(await runShell(params.command));

            case 'read_file':
                const content = await fs.readFile(params.path, 'utf8');
                return res.json({ success: true, output: content });

            case 'write_file':
                await fs.writeFile(params.path, params.content, 'utf8');
                return res.json({ success: true, output: `File written to ${params.path}` });

            case 'create_dir':
                await fs.mkdir(params.path, { recursive: true });
                return res.json({ success: true, output: `Directory created: ${params.path}` });

            case 'search_files':
                const files = await glob(params.pattern);
                return res.json({ success: true, output: files.join('\n') });

            case 'list_dir':
                const dirContents = await fs.readdir(params.path);
                return res.json({ success: true, output: dirContents.join('\n') });

            case 'open':
                await open(params.target);
                return res.json({ success: true, output: `Opened: ${params.target}` });

            case 'screenshot':
                const img = await screenshot({ format: 'png' });
                return res.json({ success: true, output: img.toString('base64') });

            case 'mouse_move':
                await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${params.x}, ${params.y})`);
                return res.json({ success: true, output: `Mouse moved to (${params.x}, ${params.y})` });

            case 'mouse_click':
                const clickCount = params.count || 1;
                let clickScript = `
                    $sig = '[DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int c, int e);';
                    $type = Add-Type -MemberDefinition $sig -Name "Win32Mouse" -Namespace "Win32" -PassThru;
                `;
                for(let i=0; i<clickCount; i++) {
                    clickScript += `$type::mouse_event(${params.button === 'right' ? '0x0008' : '0x0002'}, 0, 0, 0, 0);`;
                    clickScript += `$type::mouse_event(${params.button === 'right' ? '0x0010' : '0x0004'}, 0, 0, 0, 0);`;
                }
                await runPS(clickScript);
                return res.json({ success: true, output: `${clickCount} ${params.button} click(s) performed` });

            case 'type_text':
                await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${params.text.replace(/'/g, "''")}')`);
                return res.json({ success: true, output: `Typed: ${params.text}` });

            case 'key_press':
                await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${params.keys}')`);
                return res.json({ success: true, output: `Pressed keys: ${params.keys}` });

            case 'delete_file':
                await fs.unlink(params.path);
                return res.json({ success: true, output: `File deleted: ${params.path}` });

            case 'delete_dir':
                await fs.rm(params.path, { recursive: true, force: true });
                return res.json({ success: true, output: `Directory deleted: ${params.path}` });

            case 'copy':
                await fs.cp(params.src, params.dest, { recursive: true });
                return res.json({ success: true, output: `Copied ${params.src} -> ${params.dest}` });

            case 'move':
                await fs.rename(params.src, params.dest);
                return res.json({ success: true, output: `Moved ${params.src} -> ${params.dest}` });

            case 'file_exists':
                try {
                    await fs.access(params.path);
                    return res.json({ success: true, output: `File exists: ${params.path}` });
                } catch {
                    return res.json({ success: false, error: `File not found: ${params.path}` });
                }

            case 'get_system_info':
                const info = {
                    platform: process.platform,
                    arch: process.arch,
                    node: process.version,
                    cwd: process.cwd(),
                    homedir: process.env.HOME || process.env.USERPROFILE || '',
                    username: process.env.USERNAME || process.env.USER || '',
                };
                return res.json({ success: true, output: JSON.stringify(info, null, 2) });

            case 'run_background':
                const child = spawn(params.command, params.args || [], {
                    detached: true,
                    stdio: 'ignore',
                    shell: true
                });
                child.unref();
                return res.json({ success: true, output: `Process started in background (PID: ${child.pid})` });

            case 'webview':
                return res.json({ success: true, output: params.url });

            case 'preview':
                const previewPath = path.isAbsolute(params.path) ? params.path : path.join(__dirname, params.path);
                return res.json({ success: true, output: `http://localhost:${port}/preview?file=${encodeURIComponent(previewPath)}` });

            default:
                res.status(400).json({ success: false, error: 'Unknown action type' });
        }
    } catch (err) {
        console.error(err);
        res.json({ success: false, error: err.message });
    }
});

app.listen(port, () => {
    console.log(`AI Computer Use Backend running at http://localhost:${port}`);
});

// Preview endpoint to serve local HTML files
app.get('/preview', async (req, res) => {
    const filePath = req.query.file;
    if (!filePath) return res.status(400).send('No file specified');
    try {
        const content = await fs.readFile(filePath, 'utf8');
        res.send(content);
    } catch (err) {
        res.status(404).send('File not found: ' + err.message);
    }
});
