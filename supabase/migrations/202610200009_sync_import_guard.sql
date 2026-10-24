-- Native bulk replacement must explicitly stop the legacy bridge first.
begin;
create or replace function public.commit_dashboard_import(p_import_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.dashboard_imports; item record; actual_count bigint;
begin
    if coalesce(public.dashboard_role(), '') <> 'admin' and coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Hanya admin yang boleh mengimpor data.' using errcode = '42501';
    end if;
    if exists(select 1 from dashboard_sync.settings where enabled) then
        raise exception 'Hentikan sinkronisasi database lama sebelum impor/reset Excel atau migrasi penggantian.';
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
commit;
