import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { prepareLegacy } from '../scripts/legacy-data.mjs';

const source = await readFile(new URL('../assets/supabase-client.js', import.meta.url), 'utf8');
function adapter(config, sdk) {
    const context = vm.createContext({ window: { SUPABASE_CONFIG: config, supabase: sdk }, atob });
    new vm.Script(source).runInContext(context);
    return context.window.DashboardDB;
}
const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };

test('Password changes require 10 characters before contacting Auth', async () => {
    const lengths = [];
    const db = adapter(config, {createClient: () => ({auth: {
        updateUser: async ({password}) => {lengths.push(password.length); return {data:{}};}
    }})});
    await assert.rejects(db.changePassword('123456789'), /minimal 10 karakter/);
    assert.deepEqual(lengths, []);
    await db.changePassword('1234567890');
    assert.deepEqual(lengths, [10]);
});

test('Client rejects missing configuration and server secrets', () => {
    assert.throws(() => adapter({}).getClient(), /belum dikonfigurasi/);
    assert.throws(() => adapter({...config, publishableKey:'sb_secret_test'}).getClient(), /bukan secret/);
    const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`;
    assert.throws(() => adapter({...config,publishableKey:key}).getClient(), /bukan service_role/);
});

test('Dataset pagination loads beyond the default API row limit and retains UUIDs', async () => {
    const records = Array.from({length:1203}, (_, index) => ({id:`id-${index}`,payload:{NoKredit:String(index).padStart(16,'0')}}));
    const ranges = [];
    const db = adapter(config, { createClient: () => ({from: () => {
        const q = {select: () => q, eq: () => q, order: () => q,
            range: async (start,end) => {ranges.push([start,end]); return {data:records.slice(start,end+1)};}};
        return q;
    }}) });
    const rows = await db.readDataset('pencairan');
    assert.equal(rows.length,1203);
    assert.equal(rows[1202]._id,'id-1202');
    assert.equal(rows[0].NoKredit,'0000000000000000');
    assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
});

test('Failed insert and denied delete propagate errors to the UI', async () => {
    const db = adapter(config, {createClient: () => ({from: () => {
        const q = {insert: () => q, delete: () => q, eq: () => q,
            select: () => q, single: async () => ({error:{message:'connection lost'}}),
            then: resolve => resolve({data:[]})};
        return q;
    }})});
    await assert.rejects(db.addRecord('pencairan',{Nama:'A'}), /connection lost/);
    await assert.rejects(db.deleteRecord('pencairan','id'), /tidak ditemukan/);
    await assert.rejects(db.deleteRecord('pencairan',undefined), /ID data/);
});

test('Legacy migration preserves identifiers and missing datasets without carrying passwords', () => {
    const migrated = prepareLegacy({pencairan:[{NoKredit:'000123456789012345',Plafon:'10000000'}],master:[{AO:' Nama ',Cabang:'Cabang A'}],users:[{Username:'Petugas',Password:'old-secret',Role:'ao'}]});
    assert.equal(migrated.datasets.pencairan[0].NoKredit,'000123456789012345');
    assert.equal(Object.hasOwn(migrated.datasets,'klaim'),false);
    assert.deepEqual(migrated.masters.ao,['NAMA']);
    assert.deepEqual(migrated.users,[{username:'petugas',role:'ao'}]);
    assert.equal(JSON.stringify(migrated).includes('old-secret'),false);
    assert.throws(() => prepareLegacy({error:'Deployment failed'}),/valid/);
    assert.throws(() => prepareLegacy({pencairan:[null]}),/daftar objek/);
});
