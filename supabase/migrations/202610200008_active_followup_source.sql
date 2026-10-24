-- Reject stale portfolio rows that legacy sync has archived.
begin;
create or replace function public.begin_credit_followup(
    p_id uuid, p_dataset text, p_source_record_id uuid, p_credit_no text, p_branch text,
    p_captured_at timestamptz, p_latitude double precision, p_longitude double precision,
    p_accuracy_m double precision, p_map_included boolean, p_notes text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare source public.dashboard_records; result public.credit_followups; officer text;
begin
    if auth.uid() is null or coalesce(public.dashboard_role(),'') not in ('admin','ao') then
        raise exception 'Login petugas diperlukan.' using errcode = '42501';
    end if;
    if p_dataset is null or p_dataset not in ('kol1','lar','npl') or p_id is null then
        raise exception 'Kategori tindak lanjut tidak valid.';
    end if;
    -- A retry of the same capture uses one identifier and cannot create duplicate evidence.
    select * into result from public.credit_followups where id = p_id;
    if found then
        if result.actor_id is distinct from auth.uid() or result.dataset is distinct from p_dataset
            or result.credit_no is distinct from p_credit_no or result.branch is distinct from p_branch
            or result.captured_at is distinct from p_captured_at or result.latitude is distinct from p_latitude
            or result.longitude is distinct from p_longitude or result.accuracy_m is distinct from p_accuracy_m
            or result.map_included is distinct from p_map_included then
            raise exception 'ID bukti sudah digunakan untuk foto lain.';
        end if;
        if result.status = 'draft' and result.notes is distinct from coalesce(p_notes,'') then
            update public.credit_followups set notes = coalesce(p_notes,'') where id = p_id returning * into result;
        end if;
        return to_jsonb(result);
    end if;
    if p_captured_at is null or p_captured_at < now() - interval '15 minutes'
        or p_captured_at > now() + interval '2 minutes' then
        raise exception 'Waktu foto tidak valid atau foto sudah terlalu lama. Ambil foto ulang.';
    end if;
    select * into source from public.dashboard_records
    where not legacy_hidden and dataset = p_dataset and payload ->> 'NO_KONTRAK' = p_credit_no
        and trim(payload ->> 'CABANG') = p_branch
        and (p_source_record_id is null or id = p_source_record_id)
    order by id limit 1;
    if not found then raise exception 'Data kredit berubah. Sinkronkan data lalu buka tindak lanjut kembali.'; end if;
    select username into officer from public.app_profiles where user_id = auth.uid();
    insert into public.credit_followups(id,dataset,source_record_id,cif,credit_no,customer_name,branch,
        actor_id,actor_name,captured_at,latitude,longitude,accuracy_m,map_included,notes,photo_path)
    values (p_id,p_dataset,source.id,coalesce(source.payload ->> 'CIF',''),p_credit_no,
        coalesce(source.payload ->> 'CUSTOMER_NM',''),p_branch,auth.uid(),officer,
        p_captured_at,p_latitude,p_longitude,p_accuracy_m,p_map_included,coalesce(p_notes,''),
        auth.uid()::text || '/' || p_id::text || '.jpg') returning * into result;
    return to_jsonb(result);
end $$;

commit;
