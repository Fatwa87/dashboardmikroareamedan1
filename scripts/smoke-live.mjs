import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const context = vm.createContext({window:{}});
new vm.Script(await readFile(new URL('../assets/supabase-config.js', import.meta.url),'utf8')).runInContext(context);
const {url,publishableKey} = context.window.SUPABASE_CONFIG;
assert.ok(url && publishableKey, 'Public Supabase configuration required.');
for (const [table,column] of [['app_profiles','user_id'],['dashboard_records','id'],['dashboard_master','kind'],['dashboard_imports','id'],['dashboard_import_rows','dataset'],['credit_followups','id']]) {
    const response = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=1`, {
        method:'HEAD', headers:{apikey:publishableKey}
    });
    assert.ok([401,403].includes(response.status), `${table}: anonymous access must be denied (got ${response.status})`);
    console.log(`${table}: anonymous access denied (${response.status})`);
}
const deleteResponse = await fetch(`${url}/rest/v1/rpc/delete_credit_followup`,{
    method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify({p_id:null})
});
assert.ok([401,403].includes(deleteResponse.status),`Delete followup must reject anonymous access (got ${deleteResponse.status})`);
console.log(`delete_credit_followup: anonymous access denied (${deleteResponse.status})`);
for(const [name,body] of [
    ['begin_credit_followup',{p_id:null,p_dataset:'kol1',p_source_record_id:null,p_credit_no:'',p_branch:'',p_captured_at:null,p_latitude:0,p_longitude:0,p_accuracy_m:0,p_map_included:false,p_notes:'',p_officer_name:''}],
    ['submit_credit_followup',{p_id:null}]
]){
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.ok([401,403].includes(response.status),`${name}: anonymous access must be denied (got ${response.status})`);
    console.log(`${name}: anonymous access denied (${response.status})`);
}
for(const [name,body] of [['legacy_sync_status',{}],['request_legacy_sync',{}],['set_legacy_sync_enabled',{p_enabled:false}]]){
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.ok([401,403].includes(response.status),`${name}: anonymous access must be denied (got ${response.status})`);
    console.log(`${name}: anonymous access denied (${response.status})`);
}
for (const authorization of [null,'Bearer forged-jwt']) {
    const response = await fetch(`${url}/functions/v1/manage-users`, {
        method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},
        body:JSON.stringify({action:'create'})
    });
    assert.equal(response.status,401,'Function must reject requests without a valid user session.');
    const result = await response.json();
    assert.equal(result.error,authorization ? 'Sesi tidak valid. Silakan login ulang.' : 'Login diperlukan.',
        'Request must reach the custom auth validator; check legacy JWT verification settings.');
    console.log(`manage-users: ${authorization?'forged token':'missing token'} denied (${response.status})`);
}
console.log('Live checks passed. No database rows were changed.');
