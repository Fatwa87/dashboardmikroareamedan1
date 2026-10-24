import { readFile } from 'node:fs/promises';
import { transformSync } from '@babel/core';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)?.[1];
if (!source) throw new Error('React source missing.');
const { code } = transformSync(source, { presets: ['@babel/preset-react'], filename: 'dashboard.jsx' });
new vm.Script(code);
for (const name of ['supabase-config.js', 'supabase-client.js', 'followup-core.js', 'followup-pdf.js']) {
    new vm.Script(await readFile(new URL(`../assets/${name}`, import.meta.url), 'utf8'));
}
const followupSource = await readFile(new URL('../assets/followup-ui.js', import.meta.url), 'utf8');
new vm.Script(transformSync(followupSource,{presets:['@babel/preset-react'],filename:'followup-ui.jsx'}).code);
new vm.Script(transformSync(await readFile(new URL('../assets/legacy-sync-ui.js',import.meta.url),'utf8'),{presets:['@babel/preset-react'],filename:'legacy-sync-ui.jsx'}).code);
if (/DEFAULT_SHEET_URL|syncUsersToSheet|mode:\s*['"]no-cors|u\.password\s*===/.test(html)) {
    throw new Error('Legacy database/auth code still present.');
}
console.log('React JSX and browser JavaScript valid; legacy database and plaintext auth removed.');
const edgeSource = await readFile(new URL('../supabase/functions/manage-users/index.ts', import.meta.url), 'utf8');
new vm.Script(stripTypeScriptTypes(edgeSource.replace(/^import .*;\r?\n/m, '')));
console.log('Edge Function TypeScript valid.');
