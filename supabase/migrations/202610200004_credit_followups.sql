begin;

create table public.credit_followups (
    id uuid primary key,
    dataset text not null check (dataset in ('kol1','lar','npl')),
    source_record_id uuid references public.dashboard_records(id) on delete set null,
    cif text not null,
    credit_no text not null,
    customer_name text not null,
    branch text not null,
    actor_id uuid references auth.users(id) on delete set null,
    actor_name text not null,
    captured_at timestamptz not null,
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    accuracy_m double precision not null check (accuracy_m >= 0 and accuracy_m < 'Infinity'::double precision),
    map_included boolean not null,
    notes text not null default '' check (length(notes) <= 2000),
    photo_path text not null unique,
    status text not null default 'draft' check (status in ('draft','submitted')),
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    check ((status = 'submitted') = (submitted_at is not null))
);
create index credit_followups_recap_idx on public.credit_followups(status,captured_at desc,id);
create index credit_followups_actor_idx on public.credit_followups(actor_id,status,captured_at desc,id);
create index credit_followups_contract_idx on public.credit_followups(branch,credit_no,dataset);
alter table public.credit_followups enable row level security;
revoke all on public.credit_followups from anon,authenticated;
grant select on public.credit_followups to authenticated;
grant all on public.credit_followups to service_role;
create policy credit_followups_read on public.credit_followups for select to authenticated
using ((select public.dashboard_role()) in ('admin','ao')
    and (actor_id = (select auth.uid()) or ((select public.dashboard_role()) = 'admin' and status = 'submitted')));

-- Photos are private, immutable after submission, and limited to processed JPEGs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('credit-followups','credit-followups',false,5242880,array['image/jpeg']);

create policy credit_photo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'credit-followups' and (select public.dashboard_role()) in ('admin','ao')
    and exists (select 1 from public.credit_followups f
        where f.photo_path = name and f.actor_id = (select auth.uid()) and f.status = 'draft'));
create policy credit_photo_read on storage.objects for select to authenticated
using (bucket_id = 'credit-followups' and exists (select 1 from public.credit_followups f
    where f.photo_path = name and (f.actor_id = (select auth.uid())
        or ((select public.dashboard_role()) = 'admin' and f.status = 'submitted'))));
create policy credit_photo_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'credit-followups' and exists (select 1 from public.credit_followups f
    where f.photo_path = name and f.actor_id = (select auth.uid()) and f.status = 'draft'));

create function public.begin_credit_followup(
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
    where dataset = p_dataset and payload ->> 'NO_KONTRAK' = p_credit_no
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

create function public.submit_credit_followup(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result public.credit_followups;
begin
    if auth.uid() is null or coalesce(public.dashboard_role(),'') not in ('admin','ao') then
        raise exception 'Login petugas diperlukan.' using errcode = '42501';
    end if;
    select * into result from public.credit_followups where id = p_id and actor_id = auth.uid() for update;
    if not found then raise exception 'Bukti tindak lanjut tidak ditemukan.' using errcode = '42501'; end if;
    if result.status = 'submitted' then return to_jsonb(result); end if;
    if not exists (select 1 from storage.objects where bucket_id = 'credit-followups'
        and name = result.photo_path and metadata ->> 'mimetype' = 'image/jpeg'
        and (metadata ->> 'size')::bigint between 1 and 5242880) then
        raise exception 'Foto belum selesai diunggah. Silakan coba simpan kembali.';
    end if;
    update public.credit_followups set status = 'submitted', submitted_at = now()
        where id = p_id returning * into result;
    return to_jsonb(result);
end $$;

revoke all on function public.begin_credit_followup(uuid,text,uuid,text,text,timestamptz,double precision,double precision,double precision,boolean,text) from public,anon;
revoke all on function public.submit_credit_followup(uuid) from public,anon;
grant execute on function public.begin_credit_followup(uuid,text,uuid,text,text,timestamptz,double precision,double precision,double precision,boolean,text) to authenticated;
grant execute on function public.submit_credit_followup(uuid) to authenticated;
comment on table public.credit_followups is 'Riwayat foto kunjungan; snapshot kredit tetap ada setelah upload/reset dataset mikro. Waktu/GPS berasal dari perangkat, created_at/submitted_at berasal dari server.';

commit;
