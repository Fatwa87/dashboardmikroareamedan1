import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const admin='00000000-0000-0000-0000-000000000001',ao='00000000-0000-0000-0000-000000000002';
async function database(){
    const db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
        create schema auth;create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
        grant usage on schema public,auth to anon,authenticated,service_role;
        create schema extensions;create type extensions.http_response as (status integer,content_type text,headers text[],content text);
        create function extensions.http_get(url text) returns extensions.http_response language sql as $$
            select (coalesce(nullif(current_setting('test.http_status',true),''),'200')::integer,'application/json','{}'::text[],current_setting('test.source',true))::extensions.http_response $$;
        create function extensions.http_set_curlopt(text,text) returns boolean language sql as $$select true$$;
        create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
    for(const file of ['202610200001_dashboard.sql','202610200002_seed_masters.sql','202610200003_legacy_usernames.sql','202610200006_legacy_sync.sql','202610200007_legacy_sync_scheduler.sql','202610200009_sync_import_guard.sql']){
        let sql=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
        sql=sql.replace(/^create extension.*;\r?\n/gm,'');await db.exec(sql);
    }
    await db.query('insert into auth.users(id) values ($1),($2)',[admin,ao]);
    await db.query("insert into app_profiles(user_id,username,role) values ($1,'admin','admin'),($2,'ao1','ao')",[admin,ao]);
    const actAs=async(id,role='authenticated')=>{
        await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id||'',role]);await db.exec('set role '+role);
    };
    return {db,actAs};
}
const credit=(n,name='Nasabah Uji')=>({CABANG:'CABANG UJI',NO_KONTRAK:String(n).padStart(12,'0'),CIF:'000123',CUSTOMER_NM:name,OSL:100});
const tx=(n,amount=100)=>({Tanggal:'2026-10-20',Cabang:'CABANG UJI',Nama:'Nasabah Uji '+n,NoKredit:String(n).padStart(12,'0'),Plafon:amount,Produk:'KUM',AO:'AO UJI'});

test('Legacy sync preserves duplicates, native changes, delete tombstones, history and omitted datasets',async()=>{
    const {db,actAs}=await database();
    try{
        const initial={kol1:[credit(1),credit(2)],pencairan:[tx(1),tx(1)],estimasi:[tx(4)],report:[{NAMA_CABANG:'CABANG UJI'}]};
        for(const [d,rows] of Object.entries(initial))for(const p of rows)await db.query('insert into dashboard_records(dataset,payload) values ($1,$2)',[d,p]);
        await db.query('insert into dashboard_records(dataset,payload,created_by) values ($1,$2,$3)',['pencairan',tx(9),ao]);
        assert.equal((await db.query('select dashboard_sync.bootstrap() as n')).rows[0].n,6);
        assert.equal((await db.query('select dashboard_sync.bootstrap() as n')).rows[0].n,0);
        const apply=async source=>(await db.query('select dashboard_sync.apply_snapshot($1) as result',[source])).rows[0].result;
        const idsBefore=(await db.query('select id from dashboard_records order by id')).rows;
        const same=await apply(initial);assert.equal(same.datasets.pencairan.added,0);
        assert.deepEqual((await db.query('select id from dashboard_records order by id')).rows,idsBefore,'No-op keeps UUIDs and duplicates');
        const changed=await apply({kol1:[credit(1,'Diperbarui'),credit(3)],pencairan:[tx(1),tx(9,999),tx(10)],users:[{Password:'SHOULD_NOT_COPY'}]});
        assert.equal(changed.datasets.kol1.archived,2);assert.equal(changed.datasets.kol1.added,2);
        assert.equal(changed.datasets.pencairan.archived,1);assert.equal(changed.datasets.pencairan.conflicts,1);assert.equal(changed.datasets.pencairan.added,1);
        assert.equal((await db.query("select count(*)::int n from dashboard_records where dataset='pencairan' and not legacy_hidden")).rows[0].n,3);
        assert.equal((await db.query('select payload from dashboard_records where created_by=$1',[ao])).rows[0].payload.Plafon,100,'Native row is not overwritten');
        assert.equal((await db.query("select count(*)::int n from dashboard_records where dataset='estimasi' and not legacy_hidden")).rows[0].n,1,'Omitted dataset is retained');
        await actAs(ao);assert.equal((await db.query("select count(*)::int n from dashboard_records where dataset='kol1'")).rows[0].n,2,'Archived source rows stay out of dashboard RLS');
        await db.exec('reset role');
        const restored=await apply({kol1:initial.kol1});assert.equal(restored.datasets.kol1.restored,2);
        await actAs(admin);await db.query("delete from dashboard_records where dataset='kol1' and payload->>'NO_KONTRAK'=$1",[credit(1).NO_KONTRAK]);
        await db.exec('reset role');
        const removed=await apply({kol1:[credit(1),credit(2),credit(1,'Diubah sumber setelah hapus')]});
        assert.equal(removed.datasets.kol1.suppressed,2,'Native delete blocks old and updated variants');
        const before=(await db.query('select id,payload,legacy_hidden from dashboard_records order by id')).rows;
        await assert.rejects(apply({kol1:[credit(999)],npl:'not-array'}),/Format dataset/);
        assert.deepEqual((await db.query('select id,payload,legacy_hidden from dashboard_records order by id')).rows,before,'Malformed response commits no partial datasets');
        await assert.rejects(apply({users:[{Password:'SHOULD_NOT_COPY'}]}),/Tidak ada dataset/);
        assert.equal((await db.query("select count(*)::int n from dashboard_sync.rows where payload::text like '%SHOULD_NOT_COPY%'")).rows[0].n,0);
        await apply({kol1:[]});
        assert.equal((await db.query("select count(*)::int n from dashboard_records where dataset='kol1' and not legacy_hidden")).rows[0].n,0);
        assert.ok((await db.query("select count(*)::int n from dashboard_records where dataset='kol1' and legacy_hidden")).rows[0].n>0,'Source removals are reversible archives');
    }finally{await db.close();}
});

test('Legacy scheduler enforces roles, intervals, pause, safe error rollback and native master protection',async()=>{
    const {db,actAs}=await database();
    try{
        await db.query('insert into dashboard_records(dataset,payload) values ($1,$2)',['kol1',credit(1)]);
        await db.query('select dashboard_sync.bootstrap()');
        await db.query("update dashboard_sync.settings set source_url='https://script.google.com/macros/s/test-source/exec'");
        for(const [id,role] of [[null,'anon'],[ao,'authenticated']]){
            await actAs(id,role);
            await assert.rejects(db.query('select public.legacy_sync_status()'),/permission denied|Hanya admin/);
            await assert.rejects(db.query('select public.request_legacy_sync()'),/permission denied|Hanya admin/);
            await assert.rejects(db.query('select public.set_legacy_sync_enabled(true)'),/permission denied|Hanya admin/);
            await assert.rejects(db.query('select * from dashboard_sync.settings'),/permission denied/);
            await assert.rejects(db.query('select dashboard_sync.tick()'),/permission denied/);
        }
        await actAs(admin);
        await db.query('select public.set_legacy_sync_enabled(true)');
        const job=(await db.query("insert into dashboard_imports(expected_counts) values ('{\"kol1\":0}') returning id")).rows[0].id;
        await assert.rejects(db.query('select commit_dashboard_import($1)',[job]),/Hentikan sinkronisasi/);
        const safe=(await db.query('select legacy_sync_status() as s')).rows[0].s;
        assert.equal(safe.enabled,true);assert.equal(safe.configured,true);assert.equal(safe.source_url,undefined);
        await db.exec('reset role');
        const currentAo=(await db.query("select values from dashboard_master where kind='ao'")).rows[0].values;
        const incomingAo=[...currentAo,'AO BARU'];
        await db.query("select set_config('test.source',$1,false)",[JSON.stringify({kol1Data:[credit(1),credit(2)],aoList:incomingAo,users:[{Password:'NEVER_STORE_THIS'}]})]);
        assert.equal((await db.query('select dashboard_sync.tick() as s')).rows[0].s,'berhasil');
        assert.ok((await db.query("select values from dashboard_master where kind='ao'")).rows[0].values.includes('AO BARU'));
        assert.equal((await db.query('select dashboard_sync.tick() as s')).rows[0].s,'belum waktunya');
        await actAs(admin);await db.query('select request_legacy_sync()');await db.exec('reset role');
        await db.query("update dashboard_master set values='[\"AO NATIVE\"]',version=version+1 where kind='ao'");
        await db.query("select set_config('test.source',$1,false)",[JSON.stringify({kol1:[],aoList:[...incomingAo,'LAIN']})]);
        assert.equal((await db.query('select dashboard_sync.tick() as s')).rows[0].s,'perlu ditinjau');
        assert.deepEqual((await db.query("select values from dashboard_master where kind='ao'")).rows[0].values,['AO NATIVE']);
        await actAs(admin);await db.query('select request_legacy_sync()');await db.exec('reset role');
        await db.query("select set_config('test.source','<html>Password=NEVER_STORE_THIS</html>',false)");
        assert.equal((await db.query('select dashboard_sync.tick() as s')).rows[0].s,'gagal');
        const status=(await db.query('select * from dashboard_sync.settings')).rows[0];
        assert.equal(status.last_status,'gagal');assert.ok(!JSON.stringify(status).includes('NEVER_STORE_THIS'));
        assert.ok(!(await db.query('select * from dashboard_sync.runs')).rows.some(r=>JSON.stringify(r).includes('NEVER_STORE_THIS')));
        await actAs(admin);await db.query('select set_legacy_sync_enabled(false)');await assert.rejects(db.query('select request_legacy_sync()'),/Aktifkan/);await db.exec('reset role');
        assert.equal((await db.query('select dashboard_sync.tick() as s')).rows[0].s,'dihentikan');
        await actAs(admin);await db.query('select commit_dashboard_import($1)',[job]);
    }finally{await db.close();}
});

test('Excel/reset owns only its datasets while active legacy sync continues for other data',async()=>{
    const {db,actAs}=await database();
    try{
        await db.exec(await readFile(new URL('../supabase/migrations/202610210011_excel_dataset_ownership.sql',import.meta.url),'utf8'));
        const initial={kol1:[credit(1)],lar:[credit(2)],npl:[credit(3)],klaim:[credit(4)],report:[{NAMA_CABANG:'LAMA'}],pencairan:[tx(1)],estimasi:[tx(2)]};
        for(const [d,rows] of Object.entries(initial))for(const p of rows)await db.query('insert into dashboard_records(dataset,payload) values ($1,$2)',[d,p]);
        await db.query('select dashboard_sync.bootstrap()');
        await db.query('update dashboard_sync.settings set enabled=true');
        await actAs(admin);
        const replace=async datasets=>{
            const counts=Object.fromEntries(Object.entries(datasets).map(([d,rows])=>[d,rows.length]));
            const job=(await db.query('insert into dashboard_imports(expected_counts) values ($1) returning id',[counts])).rows[0].id;
            for(const [d,rows] of Object.entries(datasets))for(const [i,p] of rows.entries())await db.query('insert into dashboard_import_rows(import_id,dataset,position,payload) values ($1,$2,$3,$4)',[job,d,i,p]);
            return (await db.query('select commit_dashboard_import($1) as result',[job])).rows[0].result;
        };
        assert.deepEqual(await replace({kol1:[credit(101,'EXCEL')],lar:[],npl:[credit(103)],klaim:[]}),{kol1:1,lar:0,npl:1,klaim:0});
        await replace({report:[]});
        await replace({kol1:[credit(102,'EXCEL BARU')]});
        const status=(await db.query('select legacy_sync_status() as s')).rows[0].s;
        assert.equal(status.enabled,true,'No global stop; pencairan and estimasi still migrate');
        assert.deepEqual(status.native_datasets,['klaim','kol1','lar','npl','report']);
        await db.exec('reset role');
        const source={kol1:[credit(999)],lar:[credit(998)],npl:[credit(997)],klaim:[credit(996)],report:[{NAMA_CABANG:'SUMBER BARU'}],pencairan:[tx(1),tx(3)],estimasi:[tx(2),tx(4)]};
        const apply=async()=>(await db.query('select dashboard_sync.apply_snapshot($1) as s',[source])).rows[0].s;
        const result=await apply();
        for(const d of status.native_datasets)assert.equal(result.datasets[d].managed_in_supabase,true);
        assert.equal(result.datasets.pencairan.added,1);assert.equal(result.datasets.estimasi.added,1);
        await apply();
        await actAs(admin);
        const rows=(await db.query('select dataset,payload from dashboard_records order by dataset')).rows;
        assert.equal(rows.filter(r=>r.dataset==='kol1').length,1);
        assert.equal(rows.find(r=>r.dataset==='kol1').payload.CUSTOMER_NM,'EXCEL BARU');
        assert.equal(rows.filter(r=>['lar','klaim','report'].includes(r.dataset)).length,0,'Reset stays empty even with new source identities');
        assert.equal(rows.filter(r=>r.dataset==='pencairan').length,2);
        assert.equal(rows.filter(r=>r.dataset==='estimasi').length,2);
    }finally{await db.close();}
});

test('Invalid or unauthorized Excel imports preserve ownership and roll back replacement together',async()=>{
    const {db,actAs}=await database();
    try{
        await db.exec(await readFile(new URL('../supabase/migrations/202610210011_excel_dataset_ownership.sql',import.meta.url),'utf8'));
        await db.query('insert into dashboard_records(dataset,payload) values ($1,$2)',['kol1',credit(1)]);
        await db.query('select dashboard_sync.bootstrap()');
        await db.query('update dashboard_sync.settings set enabled=true');
        await actAs(admin);
        const job=(await db.query('insert into dashboard_imports(expected_counts) values ($1) returning id',[{kol1:1}])).rows[0].id;
        await assert.rejects(db.query('select commit_dashboard_import($1)',[job]),/Unggah belum lengkap/);
        assert.deepEqual((await db.query('select legacy_sync_status() as s')).rows[0].s.native_datasets,[]);
        for(const [id,role] of [[ao,'authenticated'],[null,'anon']]){
            await actAs(id,role);
            await assert.rejects(db.query('select commit_dashboard_import($1)',[job]),/Hanya admin|permission denied/);
        }
        await actAs(admin);
        await db.query('insert into dashboard_import_rows(import_id,dataset,position,payload) values ($1,$2,0,$3)',[job,'kol1',credit(2)]);
        await db.exec('reset role');
        await db.exec(`create function public.test_fail_insert() returns trigger language plpgsql as $$begin raise exception 'simulated write failure'; end$$;
            create trigger test_import_failure before insert on public.dashboard_records for each row execute function public.test_fail_insert();`);
        await actAs(admin);
        await assert.rejects(db.query('select commit_dashboard_import($1)',[job]),/simulated write failure/);
        const status=(await db.query('select legacy_sync_status() as s')).rows[0].s;
        assert.equal(status.enabled,true);assert.deepEqual(status.native_datasets,[],'Write failure rolls back ownership change');
        const rows=(await db.query('select payload from dashboard_records')).rows;
        assert.equal(rows.length,1);assert.equal(rows[0].payload.NO_KONTRAK,credit(1).NO_KONTRAK,'Delete is rolled back too');
    }finally{await db.close();}
});
