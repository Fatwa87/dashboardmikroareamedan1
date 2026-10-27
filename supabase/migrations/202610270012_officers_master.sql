-- Migration: Add npl and arrumExp to dashboard_master kind constraint
-- and allow save_dashboard_master to manage all officer categories.
begin;

-- 1. Drop existing kind check and allow 'npl' and 'arrumExp'
alter table public.dashboard_master drop constraint if exists dashboard_master_kind_check;
alter table public.dashboard_master add constraint dashboard_master_kind_check
    check (kind in ('ao', 'produk', 'admin', 'cabang', 'npl', 'arrumExp'));

-- 2. Seed initial npl and arrumExp if not already present
insert into public.dashboard_master (kind, values, version)
values
    ('npl', '["HASANUDDIN BATUBARA", "IWAN DESMORI SIMBOLON", "IZHAR EFENDI", "JERRY AKAWIRAWAN", "RIZKI FADLI LUBIS", "HAMZAH", "NOVRIANDA SANTOSO", "JOHNI IMMANUEL SINAGA", "AGUSTIAN", "MUHAMMAD ARIEF MZ", "TENGKU TAUFIK MAHLAN", "ZULFIKA FADLI", "HENDRIK IRWANSYAH", "MHD BAGUS RIZKY ARSYADIN", "M MAULANA NASUTION", "IWAN HENDRA SIMANULLANG", "HENDIKO SITUNGKIR"]'::jsonb, 1),
    ('arrumExp', '["M RIFAL KAUTSAR", "NUR SALIM", "HENDRA PRATAMA S", "PUTRI RAMADHANA", "ARY DAMAITA TARIGAN", "ANDRE WILIANSYAH", "RENOL SINAGA", "DOLLIS PANJAITAN", "HERU KURNIAWAN", "M FAISAL NUR", "DIAN PRATAMA", "IMAM MUNIRO SINURAT", "ANDI SAMUEL SINAGA", "NENCY NATALINA PURBA", "ANGGA PRATAMA", "ASAURI", "M ZUBIR", "AIDIL SYAHPUTRA"]'::jsonb, 1)
on conflict (kind) do nothing;

-- 3. Update save_dashboard_master to support upsert / missing rows smoothly
create or replace function public.save_dashboard_master(p_kind text, p_values jsonb, p_expected_version bigint)
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

    -- Ensure row exists for this kind
    insert into public.dashboard_master(kind, values, version)
    values (p_kind, p_values, 1)
    on conflict (kind) do nothing;

    update public.dashboard_master set values = p_values, version = version + 1
    where kind = p_kind and (version = p_expected_version or p_expected_version is null or p_expected_version = 0)
    returning version into next_version;

    if not found then raise exception 'Master berubah di perangkat lain. Sinkronkan ulang sebelum menyimpan.'; end if;
    return next_version;
end $$;

commit;
