(function () {
    'use strict';
    const DATASETS = ['pencairan', 'estimasi', 'kol1', 'lar', 'npl', 'klaim', 'report'];
    const MASTER_KINDS = ['ao', 'produk', 'admin', 'cabang', 'npl', 'arrumExp'];
    const PAGE_SIZE = 500;
    let client;
    const masterVersions = new Map();

    function getClient() {
        if (client) return client;
        const config = window.SUPABASE_CONFIG || {};
        if (!config.url || !config.publishableKey) {
            throw new Error('Supabase belum dikonfigurasi. Isi assets/supabase-config.js terlebih dahulu.');
        }
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url)) {
            throw new Error('Project URL Supabase tidak valid.');
        }
        const key = config.publishableKey;
        if (key.startsWith('sb_secret_')) throw new Error('Gunakan publishable/anon key, bukan secret key.');
        if (key.startsWith('eyJ')) {
            try {
                const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (payload.role !== 'anon') throw new Error('wrong-role');
            } catch (_) { throw new Error('Gunakan anon key yang valid, bukan service_role key.'); }
        } else if (!key.startsWith('sb_publishable_')) {
            throw new Error('Publishable/anon key Supabase tidak valid.');
        }
        if (!window.supabase) throw new Error('Pustaka Supabase gagal dimuat. Periksa koneksi lalu muat ulang.');
        client = window.supabase.createClient(config.url, key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        return client;
    }

    function checked(result) {
        if (result.error) throw new Error(result.error.message || 'Permintaan Supabase gagal.');
        return result.data;
    }

    async function allRows(table, columns, configure = q => q) {
        const rows = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const page = checked(await configure(getClient().from(table).select(columns))
                .range(offset, offset + PAGE_SIZE - 1));
            rows.push(...page);
            if (page.length < PAGE_SIZE) return rows;
        }
    }

    async function getProfile() {
        const { user } = checked(await getClient().auth.getUser());
        if (!user) return null;
        return checked(await getClient().from('app_profiles')
            .select('user_id,username,role').eq('user_id', user.id).single());
    }

    async function signIn(username, password) {
        const clean = username.trim().toLowerCase();
        if (!/^[a-z0-9._-][a-z0-9 ._-]{1,62}[a-z0-9._-]$/.test(clean)) throw new Error('Username harus 3–64 karakter: huruf, angka, spasi, titik, garis bawah, atau tanda hubung.');
        const result = await getClient().auth.signInWithPassword({ email: `${encodeURIComponent(clean)}@dashboard.local`, password });
        if (result.error) throw new Error('Login gagal. Periksa username, password, dan koneksi Supabase.');
        try {
            const profile = await getProfile();
            if (!profile) throw new Error('Akun belum diberi akses dashboard oleh admin.');
            return profile;
        } catch (error) {
            await getClient().auth.signOut({ scope: 'local' });
            throw error;
        }
    }

    async function restoreSession() {
        const { session } = checked(await getClient().auth.getSession());
        return session ? getProfile() : null;
    }

    async function readDataset(dataset) {
        if (!DATASETS.includes(dataset)) throw new Error('Dataset tidak dikenal.');
        const rows = await allRows('dashboard_records', 'id,payload', q =>
            q.eq('dataset', dataset).order('created_at', { ascending: false }).order('id'));
        return rows.map(row => ({ ...row.payload, _id: row.id }));
    }

    async function loadAll() {
        // Publish the snapshot only after every request succeeds.
        const results = await Promise.all(DATASETS.map(readDataset));
        const masters = checked(await getClient().from('dashboard_master').select('kind,values,version'));
        const profile = await getProfile();
        const users = profile?.role === 'admin'
            ? await allRows('app_profiles', 'user_id,username,role', q => q.order('username')) : [];
        masterVersions.clear();
        masters.forEach(row => masterVersions.set(row.kind, row.version));
        return {
            ...Object.fromEntries(DATASETS.map((name, index) => [name, results[index]])),
            masters: Object.fromEntries(masters.map(row => [row.kind, row.values])), users, profile
        };
    }

    async function addRecord(dataset, record) {
        if (!['pencairan', 'estimasi'].includes(dataset)) throw new Error('Dataset input tidak valid.');
        const { _id, ...payload } = record;
        const row = checked(await getClient().from('dashboard_records')
            .insert({ dataset, payload }).select('id,payload').single());
        return { ...row.payload, _id: row.id };
    }

    async function deleteRecord(dataset, id) {
        if (!id) throw new Error('ID data tidak tersedia. Muat ulang data dari Supabase.');
        const deleted = checked(await getClient().from('dashboard_records')
            .delete().eq('dataset', dataset).eq('id', id).select('id'));
        if (deleted.length !== 1) throw new Error('Data tidak ditemukan atau Anda tidak memiliki izin menghapus.');
    }

    async function saveMaster(kind, values) {
        if (!MASTER_KINDS.includes(kind)) {
            throw new Error('Master belum dimuat. Sinkronkan Supabase terlebih dahulu.');
        }
        const expectedVersion = masterVersions.has(kind) ? masterVersions.get(kind) : 1;
        const version = checked(await getClient().rpc('save_dashboard_master', {
            p_kind: kind, p_values: values, p_expected_version: expectedVersion
        }));
        masterVersions.set(kind, version);
    }

    async function replaceDatasets(datasets) {
        const names = Object.keys(datasets);
        if (!names.length || names.some(name => !DATASETS.includes(name) || !Array.isArray(datasets[name]))) {
            throw new Error('Format impor dataset tidak valid.');
        }
        const expected = Object.fromEntries(names.map(name => [name, datasets[name].length]));
        const job = checked(await getClient().from('dashboard_imports')
            .insert({ expected_counts: expected }).select('id').single());
        try {
            for (const dataset of names) {
                const rows = datasets[dataset];
                for (let offset = 0; offset < rows.length; offset += 250) {
                    checked(await getClient().from('dashboard_import_rows').insert(
                        rows.slice(offset, offset + 250).map((record, index) => {
                            const { _id, ...payload } = record;
                            return { import_id: job.id, dataset, position: offset + index, payload };
                        })
                    ));
                }
            }
            return checked(await getClient().rpc('commit_dashboard_import', { p_import_id: job.id }));
        } catch (error) {
            // Old live records are retained when staging or commit fails.
            try { await getClient().from('dashboard_imports').delete().eq('id', job.id); } catch (_) { /* retry/cleanup later */ }
            throw error;
        }
    }

    async function manageUser(action, values) {
        const result = await getClient().functions.invoke('manage-users', { body: { action, ...values } });
        if (result.error) {
            let message = 'Pengelolaan akun gagal. Periksa deployment fungsi manage-users.';
            try { message = (await result.error.context.json()).error || message; } catch (_) { /* generic network error */ }
            throw new Error(message);
        }
        if (result.data?.error) throw new Error(result.data.error);
        return result.data;
    }

    function subscribeAuth(callback) {
        return getClient().auth.onAuthStateChange((event, session) => {
            // Do not await Supabase queries inside the auth callback.
            if (event === 'SIGNED_OUT' || !session) callback(null);
        }).data.subscription;
    }

    async function listFollowups() {
        return allRows('credit_followups','*',q => q.eq('status','submitted').order('captured_at',{ascending:false}).order('id'));
    }

    async function saveFollowup(capture) {
        if(!window.FollowupCore)throw new Error('Modul tindak lanjut belum siap. Muat ulang halaman.');
        const details=window.FollowupCore.validateFollowupDetails(capture.notes,capture.officerName);
        const record = capture.customer;
        const finalNotes = (capture.dataset === 'arrumExp' || capture.dataset === 'arrum') && !/ARRUM\s*EXPR?ES\s*LOAN/i.test(details.notes)
            ? `[Arrum Exspres Loan] ${details.notes}`
            : details.notes;
        let draft;
        try {
            draft = checked(await getClient().rpc('begin_credit_followup', {
                p_id:capture.id, p_dataset:capture.dataset, p_source_record_id:record.sourceId,
                p_credit_no:record.creditNo, p_branch:record.branch, p_captured_at:capture.capturedAt,
                p_latitude:capture.location.latitude, p_longitude:capture.location.longitude,
                p_accuracy_m:capture.location.accuracy, p_map_included:capture.mapIncluded, p_notes:finalNotes, p_officer_name:details.officerName
            }));
        } catch (rpcError) {
            if ((capture.dataset === 'arrumExp' || capture.dataset === 'arrum') && record?._dataset && record._dataset !== capture.dataset) {
                draft = checked(await getClient().rpc('begin_credit_followup', {
                    p_id:capture.id, p_dataset:record._dataset, p_source_record_id:record.sourceId,
                    p_credit_no:record.creditNo, p_branch:record.branch, p_captured_at:capture.capturedAt,
                    p_latitude:capture.location.latitude, p_longitude:capture.location.longitude,
                    p_accuracy_m:capture.location.accuracy, p_map_included:capture.mapIncluded, p_notes:finalNotes, p_officer_name:details.officerName
                }));
            } else {
                throw rpcError;
            }
        }
        if (draft.deleted_at) throw new Error('Bukti tindak lanjut sudah dihapus oleh admin.');
        if (draft.status === 'submitted') return draft;
        const storage = getClient().storage.from('credit-followups');
        const upload = await storage.upload(draft.photo_path,capture.blob,{ contentType:'image/jpeg',upsert:false,cacheControl:'3600' });
        // A response may be lost after a successful upload. Never overwrite evidence on retry.
        if (upload.error && !['409','Duplicate'].includes(String(upload.error.statusCode))
            && !/already exists|duplicate/i.test(upload.error.message || '')) {
            throw new Error(upload.error.message || 'Unggah foto gagal. Coba simpan kembali.');
        }
        return checked(await getClient().rpc('submit_credit_followup',{p_id:capture.id}));
    }

    async function followupPhotoUrl(path) {
        const result = checked(await getClient().storage.from('credit-followups').createSignedUrl(path,300));
        return result.signedUrl;
    }

    async function deleteFollowup(id) {
        const deleted = checked(await getClient().rpc('delete_credit_followup',{p_id:id}));
        if (deleted !== id) throw new Error('Bukti belum dihapus. Muat ulang rekap lalu coba lagi.');
    }

    async function legacySyncStatus() { return checked(await getClient().rpc('legacy_sync_status')); }
    async function requestLegacySync() { checked(await getClient().rpc('request_legacy_sync')); }
    async function setLegacySyncEnabled(enabled) { checked(await getClient().rpc('set_legacy_sync_enabled',{p_enabled:enabled})); }

    window.DashboardDB = Object.freeze({
        getClient, signIn, restoreSession, getProfile, loadAll, readDataset,
        addRecord, deleteRecord, saveMaster, replaceDatasets, manageUser, subscribeAuth,
        listFollowups, saveFollowup, followupPhotoUrl, deleteFollowup,
        legacySyncStatus, requestLegacySync, setLegacySyncEnabled,
        signOut: async () => { checked(await getClient().auth.signOut({ scope: 'local' })); },
        changePassword: async password => {
            if (password.length < 10) throw new Error('Password minimal 10 karakter.');
            checked(await getClient().auth.updateUser({ password }));
        }
    });
}());
