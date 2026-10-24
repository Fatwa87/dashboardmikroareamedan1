begin;
create schema dashboard_sync;
revoke all on schema dashboard_sync from public,anon,authenticated;

alter table public.dashboard_records add column legacy_hidden boolean not null default false;
create index dashboard_records_active_idx on public.dashboard_records(dataset) where not legacy_hidden;
drop policy records_read on public.dashboard_records;
create policy records_read on public.dashboard_records for select to authenticated
using (not legacy_hidden and (select public.dashboard_role()) in ('admin','ao'));

create table dashboard_sync.settings (
    id boolean primary key default true check(id),
    source_url text check(source_url ~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$'),
    enabled boolean not null default false,
    initialized boolean not null default false,
    requested boolean not null default false,
    interval_minutes integer not null default 5 check(interval_minutes between 5 and 60),
    last_started_at timestamptz,
    last_completed_at timestamptz,
    last_status text not null default 'belum aktif',
    last_error text,
    last_summary jsonb not null default '{}'
);
insert into dashboard_sync.settings(id) values(true);
create table dashboard_sync.rows (
    dataset text not null,
    source_hash text not null,
    occurrence integer not null,
    business_key text not null,
    payload jsonb not null,
    record_id uuid unique references public.dashboard_records(id) on delete set null,
    hidden boolean not null default false,
    primary key(dataset,source_hash,occurrence)
);
create index legacy_sync_business_idx on dashboard_sync.rows(dataset,business_key);
create table dashboard_sync.masters(kind text primary key,last_values jsonb not null);
create table dashboard_sync.runs (
    id bigint generated always as identity primary key,
    completed_at timestamptz not null default now(),
    status text not null,
    summary jsonb not null default '{}',
    error text
);
revoke all on all tables in schema dashboard_sync from public,anon,authenticated;
alter table dashboard_sync.settings enable row level security;
alter table dashboard_sync.rows enable row level security;
alter table dashboard_sync.masters enable row level security;
alter table dashboard_sync.runs enable row level security;

create function dashboard_sync.business_key(p_dataset text,p jsonb) returns text
language sql immutable set search_path='' as $$
    select case
    when p_dataset='report' then jsonb_build_array(trim(p->>'NAMA_CABANG'))::text
    when p_dataset in ('kol1','lar','npl','klaim') then jsonb_build_array(trim(p->>'CABANG'),trim(p->>'NO_KONTRAK'))::text
    when p_dataset='pencairan' and trim(coalesce(p->>'NoKredit',''))<>'' then jsonb_build_array(trim(p->>'Cabang'),trim(p->>'NoKredit'))::text
    else jsonb_build_array(p->>'Tanggal',trim(p->>'Cabang'),upper(trim(p->>'Nama')),p->>'Produk',p->>'AO')::text end
$$;

-- Attach only original migration rows. Native Auth-created records remain locally owned.
create function dashboard_sync.bootstrap() returns integer
language plpgsql set search_path='' as $$
declare total integer;
begin
    if (select initialized from dashboard_sync.settings where id) then return 0; end if;
    insert into dashboard_sync.rows(dataset,source_hash,occurrence,business_key,payload,record_id)
    select dataset,md5(payload::text),row_number() over(partition by dataset,payload order by id),
        dashboard_sync.business_key(dataset,payload),payload,id
    from public.dashboard_records where created_by is null and not legacy_hidden;
    get diagnostics total=row_count;
    insert into dashboard_sync.masters(kind,last_values) select kind,values from public.dashboard_master;
    update dashboard_sync.settings set initialized=true where id;
    return total;
end $$;

create function dashboard_sync.apply_snapshot(p_source jsonb) returns jsonb
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

create function public.legacy_sync_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
    if coalesce(public.dashboard_role(),'')<>'admin' then raise exception 'Hanya admin.' using errcode='42501'; end if;
    select to_jsonb(s)-'source_url' into result from dashboard_sync.settings s where id;
    return result||jsonb_build_object('configured',(select source_url is not null from dashboard_sync.settings where id),
        'runs',(select coalesce(jsonb_agg(x order by x.id desc),'[]') from (select * from dashboard_sync.runs order by id desc limit 5) x));
end $$;
create function public.set_legacy_sync_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
    if coalesce(public.dashboard_role(),'')<>'admin' then raise exception 'Hanya admin.' using errcode='42501'; end if;
    if p_enabled is null then raise exception 'Status sinkronisasi tidak valid.'; end if;
    if p_enabled and not exists(select 1 from dashboard_sync.settings where source_url is not null and initialized) then raise exception 'Sumber belum disiapkan oleh pengelola proyek.'; end if;
    update dashboard_sync.settings set enabled=p_enabled,requested=p_enabled,last_status=case when p_enabled then 'menunggu' else 'dihentikan' end where id;
end $$;
create function public.request_legacy_sync() returns void
language plpgsql security definer set search_path='' as $$
begin
    if coalesce(public.dashboard_role(),'')<>'admin' then raise exception 'Hanya admin.' using errcode='42501'; end if;
    if not exists(select 1 from dashboard_sync.settings where enabled) then raise exception 'Aktifkan sinkronisasi terlebih dahulu.'; end if;
    update dashboard_sync.settings set requested=true where id;
end $$;
revoke all on all functions in schema dashboard_sync from public,anon,authenticated;
revoke all on function public.legacy_sync_status(),public.set_legacy_sync_enabled(boolean),public.request_legacy_sync() from public,anon;
grant execute on function public.legacy_sync_status(),public.set_legacy_sync_enabled(boolean),public.request_legacy_sync() to authenticated;
comment on schema dashboard_sync is 'Server-only one-way legacy migration sync. Native rows and native delete tombstones take precedence. Passwords/users are never copied.';
commit;
