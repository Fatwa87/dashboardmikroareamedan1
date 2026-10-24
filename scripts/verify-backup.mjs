import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { prepareLegacy } from './legacy-data.mjs';

if (!process.argv[2]) throw new Error('Gunakan: node scripts/verify-backup.mjs migration-backups/legacy-TIMESTAMP.json');
const source = JSON.parse(await readFile(process.argv[2], 'utf8'));
const prepared = prepareLegacy(source.datasets ? {...source.datasets,masters:source.masters,users:source.users} : source);
const db = new PGlite();
try {
    await db.exec('create table source_records(dataset text,payload jsonb)');
    for (const [dataset,rows] of Object.entries(prepared.datasets)) {
        for (let offset=0;offset<rows.length;offset+=250) {
            const batch=rows.slice(offset,offset+250);
            const placeholders=batch.map((_,i)=>`($${i*2+1},$${i*2+2})`).join(',');
            await db.query(`insert into source_records(dataset,payload) values ${placeholders}`,batch.flatMap(row=>[dataset,row]));
        }
    }
    const {rows}=await db.query("select dataset,count(*) as jumlah,md5(string_agg(md5(payload::text),'' order by md5(payload::text))) as checksum from source_records group by dataset order by dataset");
    console.table(rows);
    console.log("Cocokkan dengan SQL: select dataset,count(*) as jumlah,md5(string_agg(md5(payload::text),'' order by md5(payload::text))) as checksum from public.dashboard_records group by dataset order by dataset;");
} finally {await db.close();}
