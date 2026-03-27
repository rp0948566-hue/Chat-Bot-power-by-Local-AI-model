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
            files.filter(f => f.endsWith('.json')).map(async f => {
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

            case 'delete_file':
                await fs.rm(params.path, { force: true });
                return res.json({ success: true, output: `File deleted: ${params.path}` });

            case 'delete_dir':
                await fs.rm(params.path, { recursive: true, force: true });
                return res.json({ success: true, output: `Directory deleted: ${params.path}` });

            case 'copy':
                await fs.cp(params.src, params.dest, { recursive: true });
                return res.json({ success: true, output: `Copied ${params.src} to ${params.dest}` });

            case 'move':
                await fs.rename(params.src, params.dest);
                return res.json({ success: true, output: `Moved ${params.src} to ${params.dest}` });

            case 'search_files':
                const matches = await glob(params.pattern, { nodir: true });
                return res.json({ success: true, output: matches.join('\n') });

            case 'list_dir':
                const files = await fs.readdir(params.path || '.');
                return res.json({ success: true, output: files.join('\n') });

            case 'open':
                await open(params.target);
                return res.json({ success: true, output: `Opened: ${params.target}` });

            case 'screenshot':
                const img = await screenshot({ format: 'png' });
                return res.json({ success: true, output: img.toString('base64') });

            case 'mouse_move':
                await runPS(`[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${params.x}, ${params.y})`);
                return res.json({ success: true, output: `Moved mouse to ${params.x}, ${params.y}` });

            case 'mouse_click':
                const button = params.button || 'left';
                const count = params.count || 1;
                let flags = button === 'right' ? '0x0008, 0x0010' : '0x0002, 0x0004';
                let script = `
                    $sig = '[DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int c, int e);';
                    $type = Add-Type -MemberDefinition $sig -Name "Win32Mouse" -Namespace "Win32" -PassThru;
                `;
                for(let i=0; i<count; i++) {
                    script += `$type::mouse_event(${button === 'right' ? '0x0008' : '0x0002'}, 0, 0, 0, 0);`;
                    script += `$type::mouse_event(${button === 'right' ? '0x0010' : '0x0004'}, 0, 0, 0, 0);`;
                }
                await runPS(script);
                return res.json({ success: true, output: `${count} ${button} click(s) performed` });

            case 'type_text':
                await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${params.text.replace(/'/g, "''")}')`);
                return res.json({ success: true, output: `Typed: ${params.text}` });

            case 'key_press':
                await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${params.keys}')`);
                return res.json({ success: true, output: `Pressed keys: ${params.keys}` });

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
