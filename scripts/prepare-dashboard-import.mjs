import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { prepareLegacy } from './legacy-data.mjs';

const input = process.argv[2];
if (!input) throw new Error('Gunakan: node scripts/prepare-dashboard-import.mjs migration-backups/legacy-....json');
const source = JSON.parse(await readFile(resolve(input), 'utf8'));
const prepared = prepareLegacy(source.datasets ? { ...source.datasets, masters: source.masters, users: source.users } : source);
const csv = value => `"${String(value).replaceAll('"','""')}"`;
const rows = ['dataset,payload'];
for (const [dataset, records] of Object.entries(prepared.datasets)) {
    for (const payload of records) rows.push(`${csv(dataset)},${csv(JSON.stringify(payload))}`);
}
const outputDir = dirname(resolve(input));
await writeFile(resolve(outputDir,'dashboard-records.csv'), rows.join('\r\n'), {mode:0o600});
const sql = ['begin;'];
for (const [kind, values] of Object.entries(prepared.masters)) {
    sql.push(`insert into public.dashboard_master(kind,values) values ('${kind}', '${JSON.stringify(values).replaceAll("'","''")}'::jsonb) on conflict (kind) do nothing;`);
}
sql.push('commit;','select dataset,count(*) from public.dashboard_records group by dataset order by dataset;');
await writeFile(resolve(outputDir,'dashboard-masters.sql'), sql.join('\n'), {mode:0o600});
console.log(`Prepared ${rows.length-1} rows for Supabase Table Editor CSV import. Files in ${outputDir}`);
