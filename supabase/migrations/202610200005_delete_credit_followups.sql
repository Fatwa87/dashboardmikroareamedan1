begin;

-- Keep an audit archive while removing evidence and photo access from the app.
alter table public.credit_followups
    add column deleted_at timestamptz,
    add column deleted_by uuid references auth.users(id) on delete set null;

drop policy credit_followups_read on public.credit_followups;
create policy credit_followups_read on public.credit_followups for select to authenticated
using (deleted_at is null and (select public.dashboard_role()) in ('admin','ao')
    and (actor_id = (select auth.uid()) or ((select public.dashboard_role()) = 'admin' and status = 'submitted')));

-- Explicitly protect storage as well as relying on the evidence table's RLS.
drop policy credit_photo_read on storage.objects;
create policy credit_photo_read on storage.objects for select to authenticated
using (bucket_id = 'credit-followups' and exists (select 1 from public.credit_followups f
    where f.photo_path = name and f.deleted_at is null and (f.actor_id = (select auth.uid())
        or ((select public.dashboard_role()) = 'admin' and f.status = 'submitted'))));

create function public.delete_credit_followup(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
    if auth.uid() is null or coalesce(public.dashboard_role(),'') <> 'admin' then
        raise exception 'Hanya admin yang dapat menghapus tindak lanjut.' using errcode = '42501';
    end if;
    update public.credit_followups
        set deleted_at = coalesce(deleted_at,now()), deleted_by = coalesce(deleted_by,auth.uid())
        where id = p_id and status = 'submitted' returning id into result;
    if result is null then raise exception 'Bukti tindak lanjut tidak ditemukan.'; end if;
    return result;
end $$;
revoke all on function public.delete_credit_followup(uuid) from public,anon;
grant execute on function public.delete_credit_followup(uuid) to authenticated;

comment on column public.credit_followups.deleted_at is 'Hapus dari rekap dan akses foto aplikasi; arsip tetap tersimpan untuk audit/pemulihan oleh pemilik proyek.';
commit;
