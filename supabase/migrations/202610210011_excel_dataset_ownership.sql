-- Excel/reset takes ownership only of datasets in its validated manifest.
-- Other legacy datasets keep syncing; a failed import never changes ownership.
begin;
alter table dashboard_sync.settings add column native_datasets text[] not null default '{}'
    check (native_datasets <@ array['pencairan','estimasi','kol1','lar','npl','klaim','report']::text[]);
comment on column dashboard_sync.settings.native_datasets is
    'Datasets owned by Supabase after an atomic Excel/reset commit; excluded from legacy merges.';

create or replace function dashboard_sync.apply_snapshot(p_source jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare source jsonb; d text; old_key text; rows_json jsonb; entry record; mapped dashboard_sync.rows;
    current_row public.dashboard_records; new_id uuid; current_master public.dashboard_master;
    baseline jsonb; new_values jsonb; master_key text; summary jsonb:='{}'; details jsonb;
    present text[]:='{}'; n integer; added integer; archived integer; restored integer; conflicts integer;
    suppressed integer; master_conflicts integer:=0; master_updated integer:=0;
begin
    if jsonb_typeof(p_source) is distinct from 'object' or p_source ? 'error' then
        raise exception 'Respons sumber bukan database yang valid.';
    end if;
    source:=case when jsonb_typeof(p_source->'datasets')='object' then p_source->'datasets' else p_source end;
    drop table if exists pg_temp.legacy_sync_snapshot;
    create temporary table legacy_sync_snapshot(
        dataset text,source_hash text,occurrence integer,payload jsonb,business_key text,
        primary key(dataset,source_hash,occurrence)
    ) on commit drop;
    foreach d in array array['pencairan','estimasi','kol1','lar','npl','klaim','report'] loop
        old_key:=case d when 'pencairan' then 'dataPencairan' when 'estimasi' then 'dataEstimasi'
            when 'kol1' then 'kol1Data' when 'lar' then 'larData' when 'npl' then 'nplData'
            when 'klaim' then 'klaimData' else 'reportData' end;
        if not (source ? d or source ? old_key) then continue; end if;
        rows_json:=coalesce(source->d,source->old_key);
        if jsonb_typeof(rows_json) is distinct from 'array' or jsonb_array_length(rows_json)>100000 then
            raise exception 'Format dataset % tidak valid.',d;
        end if;
        if exists(select 1 from jsonb_array_elements(rows_json) e where jsonb_typeof(e)<>'object'
            or (d in ('kol1','lar','npl','klaim') and trim(coalesce(e->>'NO_KONTRAK',''))='')
            or (d in ('pencairan','estimasi') and (not e ? 'Nama' or not e ? 'Tanggal'))
            or (d='report' and trim(coalesce(e->>'NAMA_CABANG',''))='')) then
            raise exception 'Kolom wajib dataset % belum lengkap.',d;
        end if;
        present:=array_append(present,d);
        insert into pg_temp.legacy_sync_snapshot(dataset,source_hash,occurrence,payload,business_key)
        select d,md5(p::text),row_number() over(partition by p order by position),p,dashboard_sync.business_key(d,p)
        from (select value-'_id' as p,ordinality as position from jsonb_array_elements(rows_json) with ordinality) a;
    end loop;
    if cardinality(present)=0 then raise exception 'Tidak ada dataset sumber yang dikenali.'; end if;

    -- Same lock order as atomic imports. Short table lock protects native writes during the merge.
    perform pg_advisory_xact_lock(20261020);
    lock table public.dashboard_records in share row exclusive mode;
    foreach d in array present loop
        -- Read ownership after the shared import lock: an earlier Excel commit wins.
        if exists(select 1 from dashboard_sync.settings where d = any(native_datasets)) then
            select count(*) into n from pg_temp.legacy_sync_snapshot where dataset=d;
            summary:=summary||jsonb_build_object(d,jsonb_build_object(
                'source',n,'added',0,'archived',0,'restored',0,'conflicts',0,'suppressed',0,
                'managed_in_supabase',true));
            continue;
        end if;
        added:=0;archived:=0;restored:=0;conflicts:=0;suppressed:=0;
        for entry in select m.* from dashboard_sync.rows m
            join public.dashboard_records r on r.id=m.record_id
            where m.dataset=d and not m.hidden
                and not exists(select 1 from pg_temp.legacy_sync_snapshot s
                    where s.dataset=m.dataset and s.source_hash=m.source_hash and s.occurrence=m.occurrence)
        loop
            select * into current_row from public.dashboard_records where id=entry.record_id;
            if current_row.payload is distinct from entry.payload then conflicts:=conflicts+1;continue; end if;
            update public.dashboard_records set legacy_hidden=true where id=entry.record_id;
            update dashboard_sync.rows set hidden=true where dataset=d and source_hash=entry.source_hash and occurrence=entry.occurrence;
            archived:=archived+1;
        end loop;
        for entry in select * from pg_temp.legacy_sync_snapshot s where s.dataset=d order by source_hash,occurrence loop
            select * into mapped from dashboard_sync.rows m where m.dataset=d and m.source_hash=entry.source_hash and m.occurrence=entry.occurrence;
            if found then
                if mapped.payload is distinct from entry.payload then raise exception 'Identitas isi sumber tidak cocok.'; end if;
                -- A native delete/import intentionally wins over recurring source snapshots.
                if mapped.record_id is null then suppressed:=suppressed+1;continue; end if;
                select * into current_row from public.dashboard_records where id=mapped.record_id;
                if current_row.payload is distinct from mapped.payload then conflicts:=conflicts+1;continue; end if;
                if mapped.hidden then
                    update public.dashboard_records set legacy_hidden=false where id=mapped.record_id;
                    update dashboard_sync.rows set hidden=false where dataset=d and source_hash=mapped.source_hash and occurrence=mapped.occurrence;
                    restored:=restored+1;
                end if;
            else
                if exists(select 1 from dashboard_sync.rows m where m.dataset=d and m.business_key=entry.business_key and m.record_id is null) then
                    suppressed:=suppressed+1;continue;
                end if;
                if exists(select 1 from public.dashboard_records r where r.dataset=d and not r.legacy_hidden and r.created_by is not null
                    and dashboard_sync.business_key(d,r.payload)=entry.business_key) then
                    conflicts:=conflicts+1;continue;
                end if;
                insert into public.dashboard_records(dataset,payload,created_by) values(d,entry.payload,null) returning id into new_id;
                insert into dashboard_sync.rows(dataset,source_hash,occurrence,business_key,payload,record_id)
                    values(d,entry.source_hash,entry.occurrence,entry.business_key,entry.payload,new_id);
                added:=added+1;
            end if;
        end loop;
        select count(*) into n from pg_temp.legacy_sync_snapshot where dataset=d;
        details:=jsonb_build_object('source',n,'added',added,'archived',archived,'restored',restored,'conflicts',conflicts,'suppressed',suppressed);
        summary:=summary||jsonb_build_object(d,details);
    end loop;
    for d,master_key in values ('ao','aoList'),('produk','productList'),('admin','adminList'),('cabang','cabangList') loop
        rows_json:=coalesce(p_source->master_key,p_source->'masters'->d);
        if rows_json is null and jsonb_typeof(p_source->'master')='array' then
            old_key:=case d when 'ao' then 'AO' when 'produk' then 'Produk' when 'admin' then 'AdminMikro' else 'Cabang' end;
            select coalesce(jsonb_agg(value->old_key) filter(where trim(coalesce(value->>old_key,''))<>''),'[]') into rows_json from jsonb_array_elements(p_source->'master');
        end if;
        if rows_json is null then continue; end if;
        if jsonb_typeof(rows_json)<>'array' then raise exception 'Format master tidak valid.'; end if;
        select coalesce(jsonb_agg(v order by first_pos),'[]') into new_values from (
            select upper(trim(value)) v,min(ordinality) first_pos from jsonb_array_elements_text(rows_json) with ordinality
            where trim(value)<>'' group by upper(trim(value))) a;
        select * into current_master from public.dashboard_master where kind=d for update;
        select last_values into baseline from dashboard_sync.masters where kind=d;
        if current_master.values is not distinct from new_values then
            update dashboard_sync.masters set last_values=new_values where kind=d;
        elsif current_master.values is not distinct from baseline then
            update public.dashboard_master set values=new_values,version=version+1 where kind=d;
            update dashboard_sync.masters set last_values=new_values where kind=d;
            master_updated:=master_updated+1;
        elsif new_values is distinct from baseline then master_conflicts:=master_conflicts+1;
        end if;
    end loop;
    return jsonb_build_object('datasets',summary,'master_updated',master_updated,'master_conflicts',master_conflicts);
end $$;

create or replace function public.commit_dashboard_import(p_import_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.dashboard_imports; item record; actual_count bigint;
begin
    if coalesce(public.dashboard_role(), '') <> 'admin' and coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Hanya admin yang boleh mengimpor data.' using errcode = '42501';
    end if;
    select * into job from public.dashboard_imports where id = p_import_id for update;
    if not found then raise exception 'Impor tidak ditemukan atau sudah diselesaikan.'; end if;
    if coalesce(auth.role(), '') <> 'service_role' and job.created_by is distinct from auth.uid() then
        raise exception 'Impor bukan milik akun ini.' using errcode = '42501';
    end if;
    if job.expected_counts = '{}'::jsonb then raise exception 'Dataset impor kosong.'; end if;
    for item in select key, value from jsonb_each(job.expected_counts) loop
        if item.key not in ('pencairan','estimasi','kol1','lar','npl','klaim','report')
           or jsonb_typeof(item.value) <> 'number' or (item.value #>> '{}') !~ '^[0-9]+$' then
            raise exception 'Manifest impor tidak valid.';
        end if;
        select count(*) into actual_count from public.dashboard_import_rows
        where import_id = p_import_id and dataset = item.key;
        if actual_count <> (item.value #>> '{}')::bigint then
            raise exception 'Unggah belum lengkap untuk dataset %.', item.key;
        end if;
    end loop;
    if exists (select 1 from public.dashboard_import_rows
               where import_id = p_import_id and not (job.expected_counts ? dataset)) then
        raise exception 'Dataset tidak tercantum dalam manifest.';
    end if;
    -- Cron locks settings before the import advisory lock. Keep that order.
    -- Ownership changes and row replacement commit together; failures roll both back.
    perform 1 from dashboard_sync.settings where id for update;
    perform pg_advisory_xact_lock(20261020);
    update dashboard_sync.settings s set native_datasets=(
        select array_agg(distinct d order by d)
        from unnest(s.native_datasets || array(select jsonb_object_keys(job.expected_counts))) as x(d)
    ) where id;
    delete from public.dashboard_records where dataset in (select jsonb_object_keys(job.expected_counts));
    insert into public.dashboard_records(dataset,payload,created_by)
    select dataset,payload,job.created_by from public.dashboard_import_rows
    where import_id = p_import_id order by dataset,position;
    delete from public.dashboard_imports where id = p_import_id;
    return job.expected_counts;
end $$;
notify pgrst, 'reload schema';
commit;
