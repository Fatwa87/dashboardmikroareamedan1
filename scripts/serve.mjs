import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpeg': 'image/jpeg' };
const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'logo.jpeg', 'assets/supabase-config.js', 'assets/supabase-client.js', 'assets/followup-core.js', 'assets/followup-pdf.js', 'assets/followup-ui.js', 'assets/legacy-sync-ui.js'].includes(file)) {
        response.writeHead(404); response.end('Not found'); return;
    }
    try {
        const contents = await readFile(resolve(root, file));
        response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store' });
        response.end(contents);
    } catch (_) { response.writeHead(404); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Dashboard: http://127.0.0.1:4173'));
