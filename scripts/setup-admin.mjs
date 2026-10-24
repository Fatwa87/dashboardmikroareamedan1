import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env lokal.');
const username = (ADMIN_USERNAME || 'admin').trim().toLowerCase();
if (!/^[a-z0-9._-][a-z0-9 ._-]{1,62}[a-z0-9._-]$/.test(username)) throw new Error('Username admin tidak valid.');
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) throw new Error('Isi ADMIN_PASSWORD minimal 10 karakter di .env lokal.');
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing, error: checkError } = await client.from('app_profiles').select('user_id').eq('username', username).maybeSingle();
if (checkError) throw checkError;
if (existing) throw new Error('Username sudah ada. Alat ini tidak mengubah akun atau password yang sudah ada.');
const { data, error } = await client.auth.admin.createUser({ email: `${encodeURIComponent(username)}@dashboard.local`, password: ADMIN_PASSWORD, email_confirm: true });
if (error) throw error;
const { error: insertError } = await client.from('app_profiles').insert({ user_id: data.user.id, username, role: 'admin' });
if (insertError) {
    await client.auth.admin.deleteUser(data.user.id);
    throw insertError;
}
console.log(`Admin '${username}' berhasil dibuat. Login memakai username dan password yang Anda isi sendiri.`);
