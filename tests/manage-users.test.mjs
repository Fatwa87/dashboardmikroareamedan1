import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';

const original = await readFile(new URL('../supabase/functions/manage-users/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(original.replace(/^import .*;\r?\n/m, ''));
function handler({validToken=true, role='admin', insertFails=false}={}) {
    let serve;
    const calls = [];
    const sdk = {
        auth: {
            getUser: async token => {
                calls.push(['verify',token]);
                return validToken && token === 'valid-jwt' ? {data:{user:{id:'current-admin'}}} : {data:{user:null},error:{message:'invalid'}};
            },
            admin: {
                createUser: async args => {calls.push(['create',args.email]); return {data:{user:{id:'new-user'}}};},
                deleteUser: async id => {calls.push(['delete',id]); return {};},
                updateUserById: async id => {calls.push(['reset',id]); return {};}
            }
        },
        from: () => {
            let lookup;
            const query = {
                select: () => query,
                eq: (column,value) => {lookup=value; return query;},
                single: async () => ({data:{user_id:lookup,role}}),
                maybeSingle: async () => ({data:null}),
                insert: async row => {calls.push(['profile',row]); return insertFails ? {error:new Error('insert denied')} : {};}
            };
            return query;
        }
    };
    new vm.Script(code).runInContext(vm.createContext({
        createClient: () => sdk, Request, Response, console:{error:()=>{}},
        Deno:{env:{get:()=> 'server-only'},serve: fn => {serve=fn;}}
    }));
    const request = (body,token='valid-jwt',method='POST') => serve(new Request('https://test.local/manage-users', {
        method, headers: token ? {Authorization:`Bearer ${token}`,'Content-Type':'application/json'} : {},
        ...(method==='POST' ? {body:JSON.stringify(body)} : {})
    }));
    return {request,calls};
}

test('User management rejects missing tokens, forged tokens, and AO access', async () => {
    assert.equal((await handler().request({},null)).status,401);
    assert.equal((await handler().request({},'forged-jwt')).status,401);
    assert.equal((await handler({role:'ao'}).request({action:'create'})).status,403);
    assert.equal((await handler().request({},null,'OPTIONS')).status,200);
    assert.equal((await handler().request({},null,'GET')).status,405);
});

test('User management validates role, username, password and blocks self deletion', async () => {
    const {request,calls} = handler();
    assert.equal((await request({action:'create',username:'Valid.User',password:'sufficient-pass',role:'owner'})).status,400);
    assert.equal((await request({action:'create',username:'a@b',password:'sufficient-pass',role:'ao'})).status,400);
    assert.equal((await request({action:'create',username:'officer',password:'short',role:'ao'})).status,400);
    assert.equal((await request({action:'delete',user_id:'current-admin'})).status,400);
    assert.equal(calls.some(([kind]) => kind==='create'||kind==='delete'),false);
});

test('Account creation returns only profile data; failed profile creation removes orphan Auth user', async () => {
    const body={action:'create',username:'Petugas.Baru',password:'Sufficient-password',role:'ao'};
    const success=handler();
    const response=await success.request(body);
    assert.equal(response.status,201);
    const result=await response.json();
    assert.deepEqual(result.user,{user_id:'new-user',username:'petugas.baru',role:'ao'});
    assert.equal(JSON.stringify(result).includes(body.password),false);
    const spaced = handler();
    assert.equal((await spaced.request({...body,username:'Admin Mikro'})).status,201);
    assert.ok(spaced.calls.some(([kind,email])=>kind==='create'&&email==='admin%20mikro@dashboard.local'));
    const failure=handler({insertFails:true});
    assert.equal((await failure.request(body)).status,500);
    assert.ok(failure.calls.some(([kind,id])=>kind==='delete'&&id==='new-user'));
});

test('Create and reset accept exactly 10 characters and reject 9 before mutating Auth', async () => {
    for (const action of ['create', 'reset-password']) {
        const base = {action, username:'petugas', role:'ao', user_id:'other-user'};
        const rejected = handler();
        const response = await rejected.request({...base, password:'123456789'});
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /minimal 10 karakter/);
        assert.equal(rejected.calls.some(([kind]) => kind === 'create' || kind === 'reset'), false);
        const accepted = handler();
        assert.equal((await accepted.request({...base, password:'1234567890'})).status, action === 'create' ? 201 : 200);
        assert.ok(accepted.calls.some(([kind]) => kind === (action === 'create' ? 'create' : 'reset')));
    }
});
