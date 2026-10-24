import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ids = {
    admin: '00000000-0000-0000-0000-000000000001',
    ao: '00000000-0000-0000-0000-000000000002',
    outsider: '00000000-0000-0000-0000-000000000003'
};

test('PostgreSQL migration, RLS, atomic imports, and concurrent master edits', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create schema auth;
            create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            create function auth.role() returns text language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
            grant usage on schema auth, public to anon, authenticated, service_role;
            grant execute on all functions in schema auth to anon, authenticated, service_role;
        `);
        await db.exec(await readFile(new URL('../supabase/migrations/202610200001_dashboard.sql', import.meta.url), 'utf8'));
        await db.exec(await readFile(new URL('../supabase/migrations/202610200002_seed_masters.sql', import.meta.url), 'utf8'));
        await db.exec(await readFile(new URL('../supabase/migrations/202610200003_legacy_usernames.sql', import.meta.url), 'utf8'));
        await db.exec(`insert into auth.users(id) values ('${ids.admin}'),('${ids.ao}'),('${ids.outsider}');
            insert into public.app_profiles(user_id,username,role) values
                ('${ids.admin}','admin','admin'),('${ids.ao}','petugas','ao');`);
        const actAs = async (id, role = 'authenticated') => {
            await db.exec('reset role');
            await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id || '', role]);
            await db.exec(`set role ${role}`);
        };
        const query = (...args) => db.query(...args);
        await actAs(null, 'anon');
        await assert.rejects(query('select * from dashboard_records'), /permission denied/);
        await assert.rejects(query('select * from app_profiles'), /permission denied/);
        await assert.rejects(query('select commit_dashboard_import(gen_random_uuid())'), /permission denied/);

        await actAs(ids.outsider);
        assert.equal((await query('select * from dashboard_records')).rows.length, 0);
        await assert.rejects(query("insert into dashboard_records(dataset,payload) values ('pencairan','{}')"), /row-level security/);
        await assert.rejects(query("select save_dashboard_master('ao','[]',1)"), /Hanya admin/);

        await actAs(ids.ao);
        assert.equal((await query('select * from app_profiles')).rows.length, 1);
        const saved = await query(`insert into dashboard_records(dataset,payload) values ('pencairan','{"Nama":"Sama","NoKredit":"000123"}') returning id`);
        const firstId = saved.rows[0].id;
        await query(`insert into dashboard_records(dataset,payload) values ('pencairan','{"Nama":"Sama","NoKredit":"000123"}')`);
        await assert.rejects(query("insert into dashboard_records(dataset,payload) values ('report','{}')"), /row-level security/);
        await assert.rejects(query('insert into dashboard_records(dataset,payload,created_by) values ($1,$2,$3)', ['estimasi', {}, ids.admin]), /row-level security/);
        assert.equal((await query('delete from dashboard_records where id=$1 returning id', [firstId])).rows.length, 0);
        await assert.rejects(query("update app_profiles set role='admin'"), /permission denied/);
        await assert.rejects(query("insert into dashboard_imports(expected_counts) values ('{}')"), /row-level security/);

        await actAs(ids.admin);
        assert.equal((await query('select * from app_profiles')).rows.length, 2);
        assert.equal((await query('delete from dashboard_records where id=$1 returning id', [firstId])).rows.length, 1);
        assert.equal((await query("select * from dashboard_records where payload->>'NoKredit'='000123'")).rows.length, 1, 'Deleting one UUID must retain the matching sibling row');
        assert.equal((await query("select save_dashboard_master('ao','[]',1) as version")).rows[0].version, 2);
        assert.deepEqual((await query("select values from dashboard_master where kind='ao'")).rows[0].values, [], 'Intentionally empty lists must stay empty');
        await assert.rejects(query("select save_dashboard_master('ao','[\"B\"]',1)"), /perangkat lain/);
        await assert.rejects(query("select save_dashboard_master('ao','[\"B\",\"b\"]',2)"), /duplikat/);

        await db.exec('reset role');
        await query("insert into dashboard_records(dataset,payload) values ('kol1','{\"old\":true}'),('lar','{\"old\":true}')");
        await actAs(ids.admin);
        const manifest = { kol1: 2, lar: 0, npl: 0, klaim: 0 };
        const job = (await query('insert into dashboard_imports(expected_counts) values ($1) returning id', [manifest])).rows[0].id;
        await query('insert into dashboard_import_rows(import_id,dataset,position,payload) values ($1,$2,0,$3)', [job,'kol1',{NO_KONTRAK:'00000001'}]);
        await assert.rejects(query('select commit_dashboard_import($1)', [job]), /belum lengkap/);
        assert.equal((await query("select * from dashboard_records where payload->>'old'='true'")).rows.length, 2, 'Incomplete staging must leave all live datasets unchanged');
        await query('insert into dashboard_import_rows(import_id,dataset,position,payload) values ($1,$2,1,$3)', [job,'kol1',{NO_KONTRAK:'00000002'}]);
        const result = (await query('select commit_dashboard_import($1) as counts', [job])).rows[0].counts;
        assert.deepEqual(result, manifest);
        assert.equal((await query("select * from dashboard_records where dataset='kol1'")).rows.length, 2);
        assert.equal((await query("select * from dashboard_records where dataset='lar'")).rows.length, 0);
        assert.equal((await query('select * from dashboard_imports')).rows.length, 0);
        assert.equal((await query('select * from dashboard_import_rows')).rows.length, 0);
        assert.equal((await query("select * from dashboard_records where dataset='pencairan'")).rows.length, 1, 'Replacing monitoring datasets must preserve transactions');
        await assert.rejects(query('select commit_dashboard_import($1)', [job]), /sudah diselesaikan/);

        await actAs(null, 'service_role');
        const serviceJob = (await query('insert into dashboard_imports(expected_counts) values ($1) returning id', [{report:0}])).rows[0].id;
        await query('select commit_dashboard_import($1)', [serviceJob]);
    } finally { await db.close(); }
});
