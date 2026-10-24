import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return respond({ error: 'Method tidak diizinkan.' }, 405);
    try {
        const url = Deno.env.get('SUPABASE_URL')!;
        const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
        const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
        if (!token) return respond({ error: 'Login diperlukan.' }, 401);
        const { data: { user }, error: authError } = await admin.auth.getUser(token);
        if (authError || !user) return respond({ error: 'Sesi tidak valid. Silakan login ulang.' }, 401);
        const { data: profile, error: profileError } = await admin.from('app_profiles')
            .select('role').eq('user_id', user.id).single();
        if (profileError || profile?.role !== 'admin') return respond({ error: 'Hanya admin yang boleh mengelola akun.' }, 403);
        const body = await request.json();

        if (body.action === 'create') {
            const username = String(body.username || '').trim().toLowerCase();
            const password = String(body.password || '');
            const role = body.role;
            if (!/^[a-z0-9._-][a-z0-9 ._-]{1,62}[a-z0-9._-]$/.test(username)) return respond({ error: 'Username harus 3–64 karakter: huruf, angka, spasi, titik, garis bawah, atau tanda hubung.' }, 400);
            if (password.length < 10) return respond({ error: 'Password minimal 10 karakter.' }, 400);
            if (!['admin', 'ao'].includes(role)) return respond({ error: 'Role tidak valid.' }, 400);
            const { data: existing, error: findError } = await admin.from('app_profiles')
                .select('user_id').eq('username', username).maybeSingle();
            if (findError) throw findError;
            if (existing) return respond({ error: 'Username sudah terdaftar.' }, 409);
            const { data, error } = await admin.auth.admin.createUser({
                email: `${encodeURIComponent(username)}@dashboard.local`, password, email_confirm: true,
            });
            if (error || !data.user) return respond({ error: error?.message || 'Gagal membuat akun Auth.' }, 400);
            const { error: insertError } = await admin.from('app_profiles').insert({
                user_id: data.user.id, username, role,
            });
            if (insertError) {
                const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
                if (cleanupError) console.error('Auth account cleanup failed:', data.user.id, cleanupError.message);
                throw insertError;
            }
            return respond({ user: { user_id: data.user.id, username, role } }, 201);
        }

        if (body.action === 'delete' || body.action === 'reset-password') {
            if (!body.user_id || body.user_id === user.id) return respond({ error: 'Gunakan menu akun untuk akun sendiri. Akun yang sedang digunakan tidak bisa dihapus.' }, 400);
            const { data: target, error: targetError } = await admin.from('app_profiles')
                .select('user_id,role').eq('user_id', body.user_id).single();
            if (targetError || !target) return respond({ error: 'Akun tidak ditemukan.' }, 404);
            if (body.action === 'delete') {
                const { error } = await admin.auth.admin.deleteUser(target.user_id);
                if (error) throw error;
            } else {
                if (typeof body.password !== 'string' || body.password.length < 10) return respond({ error: 'Password minimal 10 karakter.' }, 400);
                const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: body.password });
                if (error) throw error;
            }
            return respond({ success: true });
        }
        return respond({ error: 'Aksi tidak dikenal.' }, 400);
    } catch (error) {
        // No passwords, tokens, request bodies, or secrets in logs.
        console.error('manage-users:', error instanceof Error ? error.message : 'request failed');
        return respond({ error: 'Pengelolaan akun gagal. Periksa log fungsi dan konfigurasi database.' }, 500);
    }
});
