import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { prepareLegacy } from './legacy-data.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = option('--file');
const sourceUrl = option('--source-url') || process.env.LEGACY_SHEET_URL;
let source;
if (file) source = JSON.parse(await readFile(resolve(file), 'utf8'));
else {
    if (!sourceUrl || !sourceUrl.startsWith('https://script.google.com/')) throw new Error('Isi LEGACY_SHEET_URL atau gunakan --file backup.json.');
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Sumber lama menolak permintaan: HTTP ${response.status}`);
    source = await response.json();
}
const prepared = source.datasets ? prepareLegacy({ ...source.datasets, masters: source.masters, users: source.users }) : prepareLegacy(source);
const counts = Object.fromEntries(Object.entries(prepared.datasets).map(([name, rows]) => [name, rows.length]));
const backupDir = resolve('migration-backups');
await mkdir(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `legacy-${Date.now()}.json`);
await writeFile(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), ...prepared }, null, 2), { mode: 0o600, flag: 'wx' });
console.log('Backup (tanpa password):', backupPath);
console.log('Jumlah baris sumber:', counts);
console.log(`Daftar akun lama: ${prepared.users.length}. Buat ulang di Supabase Auth dengan password baru.`);
if (!args.includes('--apply')) {
    console.log('Pratinjau selesai. Tambahkan --apply untuk mengimpor ke Supabase.');
    process.exit(0);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Isi kredensial server di .env lokal untuk --apply.');
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw result.error; return result.data; };
// A rerun must not silently replace transactions submitted since the first migration.
const { count, error: countError } = await client.from('dashboard_records').select('id', { count: 'exact', head: true });
if (countError) throw countError;
if (count && !args.includes('--replace-existing')) throw new Error('Tujuan sudah berisi data. Periksa backup lalu gunakan --replace-existing hanya jika penggantian memang dikehendaki.');
const job = checked(await client.from('dashboard_imports').insert({ expected_counts: counts }).select('id').single());
try {
    for (const [dataset, rows] of Object.entries(prepared.datasets)) {
        for (let offset = 0; offset < rows.length; offset += 250) {
            checked(await client.from('dashboard_import_rows').insert(rows.slice(offset, offset + 250).map((payload, i) => ({
                import_id: job.id, dataset, position: offset + i, payload
            }))));
        }
    }
    checked(await client.rpc('commit_dashboard_import', { p_import_id: job.id }));
} catch (error) {
    await client.from('dashboard_imports').delete().eq('id', job.id);
    throw error;
}
for (const [kind, values] of Object.entries(prepared.masters)) {
    const current = checked(await client.from('dashboard_master').select('version').eq('kind', kind).single());
    checked(await client.rpc('save_dashboard_master', { p_kind: kind, p_values: values, p_expected_version: current.version }));
}
for (const [dataset, expected] of Object.entries(counts)) {
    const { count, error } = await client.from('dashboard_records').select('id', { count: 'exact', head: true }).eq('dataset', dataset);
    if (error || count !== expected) throw new Error(`Verifikasi gagal untuk ${dataset}. Periksa tujuan sebelum mencoba ulang.`);
}
console.log('Migrasi selesai; jumlah baris tujuan sesuai sumber. Database lama tidak diubah.');
