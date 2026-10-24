begin;

-- Preserve historical evidence; all new submissions use the stricter form version.
alter table public.credit_followups add column officer_name text,
    add column form_version smallint not null default 1;
alter table public.credit_followups alter column form_version set default 2;

create function public.followup_required_text(p_value text) returns text
language sql immutable set search_path='' as $$
    select btrim(coalesce(p_value,''),E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)
        ||(select string_agg(chr(n),'') from generate_series(8192,8203) n)
        ||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
$$;
revoke all on function public.followup_required_text(text) from public,anon,authenticated;
grant execute on function public.followup_required_text(text) to service_role;
alter table public.credit_followups add constraint credit_followups_form_version_check check(form_version in (1,2)),
    add constraint credit_followups_required_details_check check(form_version=1 or (
        length(public.followup_required_text(notes)) between 1 and 2000
        and length(public.followup_required_text(officer_name)) between 1 and 120));

drop function public.begin_credit_followup(uuid,text,uuid,text,text,timestamptz,double precision,double precision,double precision,boolean,text);
create function public.begin_credit_followup(
    p_id uuid,p_dataset text,p_source_record_id uuid,p_credit_no text,p_branch text,
    p_captured_at timestamptz,p_latitude double precision,p_longitude double precision,
    p_accuracy_m double precision,p_map_included boolean,p_notes text,p_officer_name text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.dashboard_records;result public.credit_followups;account_name text;note_value text;name_value text;
begin
    if auth.uid() is null or coalesce(public.dashboard_role(),'') not in ('admin','ao') then
        raise exception 'Login petugas diperlukan.' using errcode='42501';
    end if;
    if p_dataset is null or p_dataset not in ('kol1','lar','npl') or p_id is null then raise exception 'Kategori tindak lanjut tidak valid.';end if;
    select * into result from public.credit_followups where id=p_id;
    if found then
        if result.actor_id is distinct from auth.uid() or result.dataset is distinct from p_dataset
            or result.credit_no is distinct from p_credit_no or result.branch is distinct from p_branch
            or result.captured_at is distinct from p_captured_at or result.latitude is distinct from p_latitude
            or result.longitude is distinct from p_longitude or result.accuracy_m is distinct from p_accuracy_m
            or result.map_included is distinct from p_map_included then raise exception 'ID bukti sudah digunakan untuk foto lain.';end if;
        if result.deleted_at is not null then raise exception 'Bukti tindak lanjut sudah dihapus oleh admin.';end if;
        -- Idempotent retries do not rewrite already-submitted evidence, including historical records.
        if result.status='submitted' then return to_jsonb(result);end if;
    end if;
    note_value:=public.followup_required_text(p_notes);name_value:=public.followup_required_text(p_officer_name);
    if length(note_value)=0 then raise exception 'Catatan tindak lanjut wajib diisi.';end if;
    if length(note_value)>2000 then raise exception 'Catatan tindak lanjut maksimal 2.000 karakter.';end if;
    if length(name_value)=0 then raise exception 'Nama petugas wajib diisi. Muat ulang halaman bila kolom belum tampil.';end if;
    if length(name_value)>120 then raise exception 'Nama petugas maksimal 120 karakter.';end if;
    if result.id is not null then
        update public.credit_followups set notes=note_value,officer_name=name_value,form_version=2
            where id=p_id returning * into result;
        return to_jsonb(result);
    end if;
    if p_captured_at is null or p_captured_at<now()-interval '15 minutes' or p_captured_at>now()+interval '2 minutes' then
        raise exception 'Waktu foto tidak valid atau foto sudah terlalu lama. Ambil foto ulang.';end if;
    select * into source from public.dashboard_records where not legacy_hidden and dataset=p_dataset
        and payload->>'NO_KONTRAK'=p_credit_no and trim(payload->>'CABANG')=p_branch
        and (p_source_record_id is null or id=p_source_record_id) order by id limit 1;
    if not found then raise exception 'Data kredit berubah. Sinkronkan data lalu buka tindak lanjut kembali.';end if;
    select username into account_name from public.app_profiles where user_id=auth.uid();
    insert into public.credit_followups(id,dataset,source_record_id,cif,credit_no,customer_name,branch,
        actor_id,actor_name,captured_at,latitude,longitude,accuracy_m,map_included,notes,officer_name,form_version,photo_path)
    values(p_id,p_dataset,source.id,coalesce(source.payload->>'CIF',''),p_credit_no,coalesce(source.payload->>'CUSTOMER_NM',''),p_branch,
        auth.uid(),account_name,p_captured_at,p_latitude,p_longitude,p_accuracy_m,p_map_included,note_value,name_value,2,
        auth.uid()::text||'/'||p_id::text||'.jpg') returning * into result;
    return to_jsonb(result);
end $$;

create or replace function public.submit_credit_followup(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.credit_followups;
begin
    if auth.uid() is null or coalesce(public.dashboard_role(),'') not in ('admin','ao') then
        raise exception 'Login petugas diperlukan.' using errcode='42501';end if;
    select * into result from public.credit_followups where id=p_id and actor_id=auth.uid() for update;
    if not found then raise exception 'Bukti tindak lanjut tidak ditemukan.' using errcode='42501';end if;
    if result.deleted_at is not null then raise exception 'Bukti tindak lanjut sudah dihapus oleh admin.';end if;
    if result.status='submitted' then return to_jsonb(result);end if;
    if result.form_version<2 or length(public.followup_required_text(result.notes))=0
        or length(public.followup_required_text(result.officer_name))=0 then
        raise exception 'Catatan tindak lanjut dan nama petugas wajib diisi. Buka kembali formulir lalu lengkapi.';end if;
    if not exists(select 1 from storage.objects where bucket_id='credit-followups' and name=result.photo_path
        and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then
        raise exception 'Foto belum selesai diunggah. Silakan coba simpan kembali.';end if;
    update public.credit_followups set status='submitted',submitted_at=now() where id=p_id returning * into result;
    return to_jsonb(result);
end $$;
revoke all on function public.begin_credit_followup(uuid,text,uuid,text,text,timestamptz,double precision,double precision,double precision,boolean,text,text) from public,anon;
grant execute on function public.begin_credit_followup(uuid,text,uuid,text,text,timestamptz,double precision,double precision,double precision,boolean,text,text) to authenticated;
revoke all on function public.submit_credit_followup(uuid) from public,anon;
grant execute on function public.submit_credit_followup(uuid) to authenticated;
comment on column public.credit_followups.officer_name is 'Nama petugas lapangan yang diisi pada formulir. actor_id/actor_name tetap identitas akun Auth pengunggah.';
notify pgrst,'reload schema';
commit;
