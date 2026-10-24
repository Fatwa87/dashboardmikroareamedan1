begin;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create function dashboard_sync.tick() returns text
language plpgsql security definer set search_path='' as $$
declare config dashboard_sync.settings; response extensions.http_response; result jsonb; state text; code text;
begin
    if not pg_try_advisory_xact_lock(2026102007) then return 'sedang berjalan'; end if;
    select * into config from dashboard_sync.settings where id for update;
    if not config.enabled then return 'dihentikan'; end if;
    if not config.requested and config.last_started_at>now()-make_interval(mins=>config.interval_minutes) then return 'belum waktunya'; end if;
    update dashboard_sync.settings set last_started_at=now(),requested=false,last_error=null where id;
    begin
        if config.source_url is null or not config.initialized then raise exception 'Sumber belum disiapkan.'; end if;
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
        perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','10000');
        perform extensions.http_set_curlopt('CURLOPT_USERAGENT','DashboardMikroMigration/1.0 (+https://dashboardmikroareamedan1.my.id)');
        response:=extensions.http_get(config.source_url);
        if response.status<>200 then raise exception 'HTTP sumber gagal.'; end if;
        if octet_length(response.content)>25000000 then raise exception 'Respons sumber terlalu besar.'; end if;
        result:=dashboard_sync.apply_snapshot(response.content::jsonb);
        state:=case when (result->>'master_conflicts')::integer>0 or exists(
            select 1 from jsonb_each(result->'datasets') d where (d.value->>'conflicts')::integer>0
                or (d.value->>'suppressed')::integer>0) then 'perlu ditinjau' else 'berhasil' end;
        update dashboard_sync.settings set last_completed_at=now(),last_status=state,last_summary=result,last_error=null where id;
        insert into dashboard_sync.runs(status,summary) values(state,result);
    exception when others then
        get stacked diagnostics code=returned_sqlstate;
        -- Do not persist raw responses or SQL errors that might contain legacy passwords/customer data.
        update dashboard_sync.settings set last_status='gagal',last_error='Sinkronisasi gagal ('||code||'). Data aktif dipertahankan; server akan mencoba lagi.' where id;
        insert into dashboard_sync.runs(status,error) values('gagal','Sinkronisasi gagal ('||code||').');
        state:='gagal';
    end;
    delete from dashboard_sync.runs where id not in(select id from dashboard_sync.runs order by id desc limit 100);
    return state;
end $$;
revoke all on function dashboard_sync.tick() from public,anon,authenticated;
select cron.schedule('dashboard-legacy-sync','* * * * *','select dashboard_sync.tick()');
commit;
