import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';

const coreSource=await readFile(new URL('../assets/followup-core.js',import.meta.url),'utf8');
const clientSource=await readFile(new URL('../assets/supabase-client.js',import.meta.url),'utf8');
const ids={admin:'00000000-0000-0000-0000-000000000001',ao:'00000000-0000-0000-0000-000000000002',other:'00000000-0000-0000-0000-000000000003',outsider:'00000000-0000-0000-0000-000000000004'};
function core(extra={}) {
    const context=vm.createContext({window:{isSecureContext:true},navigator:{},Intl,Date,setTimeout,clearTimeout,...extra});
    new vm.Script(coreSource).runInContext(context);return context.window.FollowupCore;
}
test('Recap filters use WIB days, preserve identifiers, and neutralize spreadsheet formulas',()=>{
    const api=core();
    assert.equal(api.localDay('2026-10-19T18:00:00Z'),'2026-10-20');
    const record=api.customer({_id:'source',CIF:'000001',NO_KONTRAK:'00012345678901234567',CUSTOMER_NM:'Nasabah Uji',CABANG:' CABANG UJI '});
    assert.equal(record.creditNo,'00012345678901234567');assert.equal(record.branch,'CABANG UJI');
    const rows=[{captured_at:'2026-10-19T18:00:00Z',dataset:'kol1',branch:'CABANG UJI',cif:record.cif,credit_no:record.creditNo,customer_name:'=HYPERLINK("bad")',officer_name:'Budi Petugas Lapangan',actor_name:'petugas',latitude:3.5,longitude:98.6,accuracy_m:15,map_included:true,notes:'kunjungan\nbaris 2'},
        {captured_at:'2026-10-19T15:00:00Z',dataset:'npl',branch:'CABANG LAIN',credit_no:'2'}];
    const filtered=api.filterRecap(rows,{branch:'CABANG UJI',dataset:'kol1',start:'2026-10-20',end:'2026-10-20',search:'000123'});
    assert.equal(filtered.length,1);
    const csv=api.recapCsv(filtered);
    assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes(record.creditNo));assert.ok(csv.includes('WIB'));
    assert.ok(csv.includes('Budi Petugas Lapangan'));assert.ok(csv.includes('Akun Pengunggah'));assert.ok(csv.includes('"petugas"'));
    assert.equal(api.filterRecap(rows,{search:'budi petugas'}).length,1);
    assert.equal(api.officerName({actor_name:'akun.lama'}),'akun.lama');
    assert.notEqual(api.officerIdentity({officer_name:'Budi',actor_id:'sama'}),api.officerIdentity({officer_name:'Siti',actor_id:'sama'}));
    assert.equal(api.mapUrl(3.5,98.6),'https://www.openstreetmap.org/?mlat=3.500000&mlon=98.600000#map=18/3.500000/98.600000');
});
test('Followup details require nonblank notes and the entered officer name',()=>{
    const api=core();
    for(const blank of ['',null,' \t\n\r','\u00a0\u200b\ufeff']){
        assert.throws(()=>api.validateFollowupDetails(blank,'Budi'),/Catatan.*wajib/);
        assert.throws(()=>api.validateFollowupDetails('Nasabah ditemui',blank),/Nama petugas wajib/);
    }
    const details=api.validateFollowupDetails('  Nasabah ditemui\nJanji bayar besok \t',' Budi Lapangan ');
    assert.equal(details.notes,'Nasabah ditemui\nJanji bayar besok');assert.equal(details.officerName,'Budi Lapangan');
    assert.throws(()=>api.validateFollowupDetails('x'.repeat(2001),'Budi'),/maksimal/);
    assert.throws(()=>api.validateFollowupDetails('Hasil kunjungan','x'.repeat(121)),/maksimal/);
});
test('GPS rejects denied, invalid and stale positions without inventing a location',async()=>{
    const gps=coords=>core({navigator:{geolocation:{getCurrentPosition:resolve=>resolve(coords)}}});
    const position={coords:{latitude:3.5,longitude:98.6,accuracy:20},timestamp:Date.now()};
    assert.equal((await gps(position).getLocation()).latitude,3.5);
    await assert.rejects(gps({...position,timestamp:Date.now()-120000}).getLocation(),/posisi lama/);
    await assert.rejects(gps({...position,coords:{...position.coords,latitude:999}}).getLocation(),/belum valid/);
    await assert.rejects(core({navigator:{geolocation:{getCurrentPosition:(_ok,error)=>error({code:1})}}}).getLocation(),/Izin lokasi/);
    await assert.rejects(core({window:{isSecureContext:false}}).getLocation(),/HTTPS/);
});
test('Photo rendering burns in coordinates and WIB time; failed maps remain explicitly marked',async()=>{
    for(const mapFails of [false,true]){
        const text=[],tiles=[];
        const context={drawImage(){},fillRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},arc(){},fill(){},stroke(){},fillText:value=>text.push(value)};
        class FakeImage {set src(value){tiles.push(value);queueMicrotask(()=>mapFails?this.onerror():this.onload());}}
        const api=core({Image:FakeImage,document:{createElement:()=>({getContext:()=>context,toBlob:resolve=>resolve(new Blob(['synthetic-test'],{type:'image/jpeg'}))})}});
        const result=await api.stampPhoto({width:1280,height:720},{latitude:3.5,longitude:98.6,accuracy:15},'2026-10-19T18:00:00Z',{branch:'CABANG UJI',creditNo:'0000123'},'petugas');
        assert.equal(result.mapIncluded,!mapFails);assert.equal(result.blob.type,'image/jpeg');
        assert.ok(text.some(value=>value.includes('3.500000, 98.600000')));
        assert.ok(text.some(value=>value.includes('WIB')));assert.ok(text.some(value=>value.includes('0000123')));
        assert.ok(tiles.every(value=>value.startsWith('https://tile.openstreetmap.org/16/')));
        assert.ok(text.includes(mapFails?'Peta tidak tersedia':'© OpenStreetMap contributors'));
    }
});
function clientWith({uploadError=null,submitted=false,deleted=false,deleteError=null}={}){
    const calls=[],rpcCalls=[];
    const sdk={rpc:async(name,args)=>{calls.push(name);rpcCalls.push({name,args});if(name==='delete_credit_followup')return {data:deleteError?null:args.p_id,error:deleteError};return {data:{id:args.p_id,photo_path:'owner/photo.jpg',deleted_at:deleted?'2026-10-20T00:00:00Z':null,status:name==='submit_credit_followup'||submitted?'submitted':'draft'}};},
        storage:{from:()=>({upload:async()=>{calls.push('upload');return {error:uploadError};}})}};
    const context=vm.createContext({window:{SUPABASE_CONFIG:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'},supabase:{createClient:()=>sdk}},atob});
    new vm.Script(coreSource).runInContext(context);new vm.Script(clientSource).runInContext(context);return {db:context.window.DashboardDB,calls,rpcCalls};
}
const capture={id:'photo',dataset:'kol1',customer:{sourceId:'source',creditNo:'0001',branch:'CABANG UJI'},capturedAt:'2026-10-20T00:00:00Z',location:{latitude:3.5,longitude:98.6,accuracy:15},mapIncluded:true,notes:'Nasabah ditemui',officerName:'Petugas Lapangan Uji',blob:new Blob(['test'])};
test('Client rejects missing followup details before drafting/uploading and sends the trimmed name separately',async()=>{
    const client=clientWith();
    await assert.rejects(client.db.saveFollowup({...capture,notes:' \n'}),/Catatan.*wajib/);
    await assert.rejects(client.db.saveFollowup({...capture,officerName:' \t'}),/Nama petugas wajib/);
    assert.deepEqual(client.calls,[]);
    await client.db.saveFollowup({...capture,notes:' Nasabah ditemui ',officerName:' Budi Lapangan '});
    assert.equal(client.rpcCalls[0].args.p_notes,'Nasabah ditemui');assert.equal(client.rpcCalls[0].args.p_officer_name,'Budi Lapangan');
    assert.equal(client.rpcCalls[0].args.p_actor_name,undefined,'Auth identity must never be supplied by client');
});
test('Failed photo upload is never submitted; safe retries reuse an immutable object',async()=>{
    const failure=clientWith({uploadError:{message:'network lost',statusCode:'500'}});
    await assert.rejects(failure.db.saveFollowup(capture),/network lost/);
    assert.deepEqual(failure.calls,['begin_credit_followup','upload']);
    const retry=clientWith({uploadError:{message:'already exists',statusCode:'409'}});
    assert.equal((await retry.db.saveFollowup(capture)).status,'submitted');
    assert.deepEqual(retry.calls,['begin_credit_followup','upload','submit_credit_followup']);
    const done=clientWith({submitted:true});await done.db.saveFollowup(capture);
    assert.deepEqual(done.calls,['begin_credit_followup']);
    const archived=clientWith({submitted:true,deleted:true});
    await assert.rejects(archived.db.saveFollowup(capture),/sudah dihapus/);
    assert.deepEqual(archived.calls,['begin_credit_followup']);
});

test('Delete followup waits for server confirmation and reports permission errors',async()=>{
    const success=clientWith();await success.db.deleteFollowup('evidence-id');
    assert.deepEqual(success.calls,['delete_credit_followup']);
    const failure=clientWith({deleteError:{message:'Hanya admin'}});
    await assert.rejects(failure.db.deleteFollowup('evidence-id'),/Hanya admin/);
});

test('Followup RLS, private photo access, submission, retry and history retention',async()=>{
    const db=new PGlite();
    try{
        await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
            create schema auth;create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
            create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
            grant usage on schema public,auth to anon,authenticated,service_role;
            create schema storage;grant usage on schema storage to anon,authenticated,service_role;
            create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
            create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
            alter table storage.objects enable row level security;
            grant select,insert,delete,update on storage.objects to authenticated;
            grant select on storage.objects to anon;
            grant all on storage.objects to service_role;`);
        for(const file of ['202610200001_dashboard.sql','202610200003_legacy_usernames.sql','202610200004_credit_followups.sql','202610200005_delete_credit_followups.sql','202610200006_legacy_sync.sql','202610200008_active_followup_source.sql','202610200010_required_followup_details.sql','202610210011_excel_dataset_ownership.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
        await db.query('insert into auth.users(id) values ($1),($2),($3),($4)',Object.values(ids));
        for(const [role,id] of Object.entries(ids))if(role!=='outsider')await db.query('insert into app_profiles(user_id,username,role) values ($1,$2,$3)',[id,role==='admin'?'admin':`officer_${role}`,role==='admin'?'admin':'ao']);
        const source=(await db.query('insert into dashboard_records(dataset,payload) values ($1,$2) returning id',['kol1',{CIF:'0000123',NO_KONTRAK:'00000123456789012345',CUSTOMER_NM:'Nasabah Uji',CABANG:'CABANG UJI'}])).rows[0].id;
        const actAs=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id||'',role]);await db.exec(`set role ${role}`);};
        const id='10000000-0000-0000-0000-000000000001';const at=new Date().toISOString();
        const args=[id,'kol1',source,'00000123456789012345','CABANG UJI',at,3.5,98.6,15,true,' kunjungan uji \n',' Budi Petugas Lapangan \t'];
        const beginSql='select begin_credit_followup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result';
        await db.query('update dashboard_records set legacy_hidden=true where id=$1',[source]);
        await actAs(ids.ao);await assert.rejects(db.query(beginSql,args),/Data kredit berubah/);
        await db.exec('reset role');await db.query('update dashboard_records set legacy_hidden=false where id=$1',[source]);
        await actAs(null,'anon');await assert.rejects(db.query('select * from credit_followups'),/permission denied/);
        await assert.rejects(db.query(beginSql,args),/permission denied/);
        await assert.rejects(db.query('select delete_credit_followup($1)',[id]),/permission denied/);
        await actAs(ids.outsider);await assert.rejects(db.query(beginSql,args),/Login petugas/);
        await actAs(ids.ao);
        for(const blank of ['',null,' \t\n','\u00a0\u200b\ufeff']){
            const noNotes=[...args];noNotes[10]=blank;await assert.rejects(db.query(beginSql,noNotes),/Catatan.*wajib/);
            const noName=[...args];noName[11]=blank;await assert.rejects(db.query(beginSql,noName),/Nama petugas wajib/);
        }
        await assert.rejects(db.query('select begin_credit_followup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',args.slice(0,11)),/Nama petugas wajib/,'Cached old client cannot bypass the new required field');
        const tooLong=[...args];tooLong[11]='a'.repeat(121);await assert.rejects(db.query(beginSql,tooLong),/maksimal 120/);
        await assert.rejects(db.query('select delete_credit_followup($1)',[id]),/Hanya admin/);
        await assert.rejects(db.query('insert into credit_followups(id) values ($1)',[id]),/permission denied/);
        await assert.rejects(db.query(beginSql,[...args.slice(0,4),'CABANG PALSU',...args.slice(5)]),/Data kredit berubah/);
        const invalid=[...args];invalid[5]='2020-01-01T00:00:00Z';await assert.rejects(db.query(beginSql,invalid),/Waktu foto/);
        const draft=(await db.query(beginSql,args)).rows[0].result;
        assert.equal(draft.customer_name,'Nasabah Uji');assert.equal(draft.cif,'0000123');assert.equal(draft.credit_no,args[3]);
        assert.equal(draft.actor_id,ids.ao);assert.equal(draft.photo_path,`${ids.ao}/${id}.jpg`);
        assert.equal(draft.officer_name,'Budi Petugas Lapangan');assert.equal(draft.actor_name,'officer_ao');assert.equal(draft.form_version,2);assert.equal(draft.notes,'kunjungan uji');
        assert.equal((await db.query(beginSql,args)).rows[0].result.id,id,'Retry must retain one evidence row');
        const changed=[...args];changed[6]=4;await assert.rejects(db.query(beginSql,changed),/ID bukti/);
        await assert.rejects(db.query('select submit_credit_followup($1)',[id]),/Foto belum selesai/);
        await actAs(ids.other);
        assert.equal((await db.query('select * from credit_followups')).rows.length,0);
        await assert.rejects(db.query('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',['credit-followups',draft.photo_path,{mimetype:'image/jpeg',size:100}]),/row-level security/);
        await assert.rejects(db.query('select submit_credit_followup($1)',[id]),/tidak ditemukan/);
        await actAs(ids.admin);assert.equal((await db.query('select * from credit_followups')).rows.length,0,'Other users drafts must stay out of admin recap');
        await actAs(ids.ao);
        const updated=[...args];updated[10]='Catatan diperbarui sebelum submit';updated[11]='Siti Petugas Lapangan';
        const revised=(await db.query(beginSql,updated)).rows[0].result;
        assert.equal(revised.id,id);assert.equal(revised.officer_name,'Siti Petugas Lapangan');assert.equal(revised.actor_name,'officer_ao');
        await db.query('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',['credit-followups',draft.photo_path,{mimetype:'image/jpeg',size:100}]);
        assert.equal((await db.query('select submit_credit_followup($1) as result',[id])).rows[0].result.status,'submitted');
        assert.equal((await db.query('select submit_credit_followup($1) as result',[id])).rows[0].result.id,id);
        assert.equal((await db.query(beginSql,args)).rows[0].result.officer_name,'Siti Petugas Lapangan','Retry must not rewrite submitted names/notes');
        assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0,'Submitted photos cannot be deleted');
        assert.equal((await db.query("update storage.objects set name='overwrite' returning id")).rows.length,0,'Submitted photos cannot be overwritten');
        await actAs(ids.other);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
        await actAs(null,'anon');assert.equal((await db.query('select * from storage.objects')).rows.length,0);
        await actAs(ids.admin);
        assert.equal((await db.query('select * from credit_followups')).rows.length,1);
        assert.equal((await db.query('select * from storage.objects')).rows.length,1);
        const resetJob=(await db.query('insert into dashboard_imports(expected_counts) values ($1) returning id',[{kol1:0}])).rows[0].id;
        await db.query('select commit_dashboard_import($1)',[resetJob]);
        const history=(await db.query('select * from credit_followups')).rows[0];
        assert.equal(history.source_record_id,null);assert.equal(history.credit_no,args[3]);assert.equal(history.customer_name,'Nasabah Uji');
        assert.equal(history.officer_name,'Siti Petugas Lapangan');assert.equal(history.notes,'Catatan diperbarui sebelum submit');
        await assert.rejects(db.query('delete from credit_followups where id=$1',[id]),/permission denied/);
        assert.equal((await db.query('select delete_credit_followup($1) as result',[id])).rows[0].result,id);
        assert.equal((await db.query('select delete_credit_followup($1) as result',[id])).rows[0].result,id,'Retry delete is idempotent');
        assert.equal((await db.query('select * from credit_followups')).rows.length,0,'Deleted evidence is hidden from admin');
        assert.equal((await db.query('select * from storage.objects')).rows.length,0,'Deleted photo access is revoked');
        await actAs(ids.ao);
        assert.equal((await db.query('select * from credit_followups')).rows.length,0,'Deleted evidence is hidden from owner');
        assert.equal((await db.query('select * from storage.objects')).rows.length,0,'Owner cannot reopen deleted photo');
        await assert.rejects(db.query('select delete_credit_followup($1)',[id]),/Hanya admin/);
        await db.exec('reset role');
        const archived=(await db.query('select * from credit_followups where id=$1',[id])).rows[0];
        assert.ok(archived.deleted_at);assert.equal(archived.deleted_by,ids.admin);
        assert.equal((await db.query('select * from storage.objects')).rows.length,1,'Archive preserves photo for project-owner recovery');
        await db.exec('reset role');assert.equal((await db.query("select public from storage.buckets where id='credit-followups'")).rows[0].public,false);
        const legacyId='20000000-0000-0000-0000-000000000001';
        await db.query(`insert into credit_followups(id,dataset,cif,credit_no,customer_name,branch,actor_id,actor_name,captured_at,latitude,longitude,accuracy_m,map_included,notes,form_version,photo_path)
            values($1,'kol1','0000123',$2,'Nasabah Uji','CABANG UJI',$3,'officer_ao',$4,3.5,98.6,15,true,'',1,$5)`,[legacyId,args[3],ids.ao,at,`${ids.ao}/${legacyId}.jpg`]);
        await db.query('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',['credit-followups',`${ids.ao}/${legacyId}.jpg`,{mimetype:'image/jpeg',size:100}]);
        await actAs(ids.ao);await assert.rejects(db.query('select submit_credit_followup($1)',[legacyId]),/Catatan.*nama petugas wajib/);
        const upgraded=[...args];upgraded[0]=legacyId;
        assert.equal((await db.query(beginSql,upgraded)).rows[0].result.form_version,2);
        assert.equal((await db.query('select submit_credit_followup($1) as result',[legacyId])).rows[0].result.officer_name,'Budi Petugas Lapangan');
    }finally{await db.close();}
});
