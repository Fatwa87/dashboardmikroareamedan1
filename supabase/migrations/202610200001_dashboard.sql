-- Dashboard Mikro Area Medan 1. Apply once through SQL Editor or supabase db push.
begin;

create table public.app_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique check (username ~ '^[a-z0-9._-]{3,64}$'),
    role text not null check (role in ('admin', 'ao')),
    created_at timestamptz not null default now()
);

create function public.dashboard_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.app_profiles where user_id = (select auth.uid()) $$;
revoke all on function public.dashboard_role() from public, anon;
grant execute on function public.dashboard_role() to authenticated, service_role;

create table public.dashboard_records (
    id uuid primary key default gen_random_uuid(),
    dataset text not null check (dataset in ('pencairan','estimasi','kol1','lar','npl','klaim','report')),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
create index dashboard_records_dataset_idx on public.dashboard_records(dataset, created_at desc, id);
create index dashboard_records_contract_idx on public.dashboard_records((payload ->> 'NoKredit')) where dataset = 'pencairan';

create table public.dashboard_master (
    kind text primary key check (kind in ('ao','produk','admin','cabang')),
    values jsonb not null default '[]' check (jsonb_typeof(values) = 'array'),
    version bigint not null default 1
);

-- Uploads are staged in small batches; one SQL transaction activates all datasets.
create table public.dashboard_imports (
    id uuid primary key default gen_random_uuid(),
    expected_counts jsonb not null check (jsonb_typeof(expected_counts) = 'object'),
    created_by uuid default auth.uid() references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
create table public.dashboard_import_rows (
    import_id uuid not null references public.dashboard_imports(id) on delete cascade,
    dataset text not null check (dataset in ('pencairan','estimasi','kol1','lar','npl','klaim','report')),
    position bigint not null check (position >= 0),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    primary key (import_id, dataset, position)
);

alter table public.app_profiles enable row level security;
alter table public.dashboard_records enable row level security;
alter table public.dashboard_master enable row level security;
alter table public.dashboard_imports enable row level security;
alter table public.dashboard_import_rows enable row level security;

revoke all on public.app_profiles, public.dashboard_records, public.dashboard_master,
    public.dashboard_imports, public.dashboard_import_rows from anon, authenticated;
grant select on public.app_profiles, public.dashboard_master to authenticated;
grant select, insert, delete on public.dashboard_records, public.dashboard_imports, public.dashboard_import_rows to authenticated;
grant all on public.app_profiles, public.dashboard_records, public.dashboard_master,
    public.dashboard_imports, public.dashboard_import_rows to service_role;

create policy profiles_read on public.app_profiles for select to authenticated
using (user_id = (select auth.uid()) or (select public.dashboard_role()) = 'admin');
create policy records_read on public.dashboard_records for select to authenticated
using ((select public.dashboard_role()) in ('admin','ao'));
create policy records_insert on public.dashboard_records for insert to authenticated
with check ((select public.dashboard_role()) in ('admin','ao')
    and dataset in ('pencairan','estimasi') and created_by = (select auth.uid()));
create policy records_delete on public.dashboard_records for delete to authenticated
using ((select public.dashboard_role()) = 'admin');
create policy master_read on public.dashboard_master for select to authenticated
using ((select public.dashboard_role()) in ('admin','ao'));
create policy imports_admin on public.dashboard_imports for all to authenticated
using ((select public.dashboard_role()) = 'admin' and created_by = (select auth.uid()))
with check ((select public.dashboard_role()) = 'admin' and created_by = (select auth.uid()));
create policy import_rows_admin on public.dashboard_import_rows for all to authenticated
using ((select public.dashboard_role()) = 'admin' and exists (
    select 1 from public.dashboard_imports j where j.id = import_id and j.created_by = (select auth.uid())))
with check ((select public.dashboard_role()) = 'admin' and exists (
    select 1 from public.dashboard_imports j where j.id = import_id and j.created_by = (select auth.uid())));

create function public.save_dashboard_master(p_kind text, p_values jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_version bigint;
begin
    if coalesce(public.dashboard_role(), '') <> 'admin' and coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Hanya admin yang boleh mengubah master.' using errcode = '42501';
    end if;
    if jsonb_typeof(p_values) is distinct from 'array' then raise exception 'Master harus berupa array.'; end if;
    if exists (select 1 from jsonb_array_elements(p_values) v
               where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) = 0) then
        raise exception 'Nama master tidak boleh kosong.';
    end if;
    if (select count(*) from jsonb_array_elements_text(p_values)) <>
       (select count(distinct upper(trim(v))) from jsonb_array_elements_text(p_values) v) then
        raise exception 'Nama master duplikat.';
    end if;
    update public.dashboard_master set values = p_values, version = version + 1
    where kind = p_kind and version = p_expected_version returning version into next_version;
    if not found then raise exception 'Master berubah di perangkat lain. Sinkronkan ulang sebelum menyimpan.'; end if;
    return next_version;
end $$;
revoke all on function public.save_dashboard_master(text,jsonb,bigint) from public, anon;
grant execute on function public.save_dashboard_master(text,jsonb,bigint) to authenticated, service_role;

create function public.commit_dashboard_import(p_import_id uuid) returns jsonb
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
    -- Serializes replace operations, including simultaneous imports by different admins.
    perform pg_advisory_xact_lock(20261020);
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
    delete from public.dashboard_records where dataset in (select jsonb_object_keys(job.expected_counts));
    insert into public.dashboard_records(dataset,payload,created_by)
    select dataset,payload,job.created_by from public.dashboard_import_rows
    where import_id = p_import_id order by dataset,position;
    delete from public.dashboard_imports where id = p_import_id;
    return job.expected_counts;
end $$;
revoke all on function public.commit_dashboard_import(uuid) from public, anon;
grant execute on function public.commit_dashboard_import(uuid) to authenticated, service_role;

comment on table public.dashboard_records is 'Data dashboard. payload mempertahankan nama kolom Excel/Google Sheet; id UUID dipakai untuk hapus tepat satu baris.';
comment on table public.app_profiles is 'Hak akses server. Password hanya di Supabase Auth, tidak pernah di tabel ini.';

commit;
