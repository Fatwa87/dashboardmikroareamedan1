(function(){
    const {useState,useEffect,useRef}=React;
    const time=value=>value?new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'medium'}).format(new Date(value))+' WIB':'Belum ada';
    const labels={pencairan:'Pencairan',estimasi:'Estimasi',kol1:'KOL 1',lar:'LAR',npl:'NPL',klaim:'Klaim',report:'Report'};
    function LegacySyncPanel({showToast,onSynced}){
        const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmStop,setConfirmStop]=useState(false);
        const alive=useRef(true),lastCompleted=useRef(null),requestVersion=useRef(0),callback=useRef(onSynced);
        callback.current=onSynced;
        const load=async()=>{
            const version=++requestVersion.current;
            try{
                const result=await DashboardDB.legacySyncStatus();
                if(!alive.current||version!==requestVersion.current)return;
                setStatus(result);setError('');
                if(lastCompleted.current&&result.last_completed_at!==lastCompleted.current)callback.current?.();
                lastCompleted.current=result.last_completed_at;
            }catch(error){if(alive.current&&version===requestVersion.current)setError(error.message);}
        };
        useEffect(()=>{alive.current=true;load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},15000);return()=>{alive.current=false;requestVersion.current++;clearInterval(timer);};},[]);
        const act=async(action)=>{
            setBusy(true);setError('');requestVersion.current++;
            try{
                if(action==='now')await DashboardDB.requestLegacySync();
                else await DashboardDB.setLegacySyncEnabled(action==='start');
                if(alive.current){setConfirmStop(false);showToast(action==='now'?'Permintaan sinkronisasi diterima. Server akan memulai dalam sekitar 1 menit.':action==='start'?'Sinkronisasi otomatis diaktifkan.':'Sinkronisasi otomatis dihentikan.');await load();}
            }catch(error){if(alive.current)setError(error.message);}
            finally{if(alive.current)setBusy(false);}
        };
        const btn='px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed';
        const datasets=Object.entries(status?.last_summary?.datasets||{});
        return <section className="glass-card bg-white p-6 md:p-8 rounded-3xl border border-slate-200 space-y-4" aria-label="Sinkronisasi Otomatis Database Lama">
            <div className="flex flex-wrap justify-between gap-4 items-start"><div><h3 className="font-black text-slate-900 text-lg">Sinkronisasi Otomatis Database Lama</h3><p className="text-xs text-slate-500 mt-2">Dashboard lama → Supabase, setiap {status?.interval_minutes||5} menit. Berjalan di server meskipun komputer mati.</p></div>
                <span className={`px-3 py-1.5 rounded-xl text-xs font-bold ${status?.enabled?'bg-emerald-100 text-emerald-800':'bg-slate-100 text-slate-600'}`}>{status?status.enabled?'Aktif':'Nonaktif':'Memuat...'}</span></div>
            {error&&<p role="alert" className="bg-rose-50 text-rose-700 p-3 rounded-xl text-sm">{error}</p>}
            {status&&<><div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs"><div className="bg-slate-50 p-3 rounded-xl"><p className="text-slate-500">Status terakhir</p><strong className="block mt-1">{status.last_status}</strong>{status.requested&&<p className="text-amber-700 mt-1">Permintaan menunggu giliran server.</p>}</div><div className="bg-slate-50 p-3 rounded-xl"><p className="text-slate-500">Percobaan terakhir</p><strong className="block mt-1">{time(status.last_started_at)}</strong></div><div className="bg-slate-50 p-3 rounded-xl"><p className="text-slate-500">Data terakhir diproses</p><strong className="block mt-1">{time(status.last_completed_at)}</strong></div></div>
                {status.last_error&&<p role="alert" className="bg-amber-50 text-amber-900 p-3 rounded-xl text-xs">{status.last_error}</p>}
                {!status.configured&&<p className="text-sm text-amber-800">Sumber lama belum dikonfigurasi oleh pengelola proyek.</p>}
                {!!datasets.length&&<div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full text-xs text-left"><thead className="bg-slate-50 text-slate-500"><tr>{['Dataset','Baris Sumber','Ditambah','Diarsipkan','Dipulihkan','Benturan','Dilewati'].map(label=><th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{datasets.map(([name,row])=><tr key={name}><td className="p-3 font-bold">{labels[name]||name}</td>{['source','added','archived','restored','conflicts','suppressed'].map(key=><td key={key} className={`p-3 ${['conflicts','suppressed'].includes(key)&&row[key]?'text-amber-800 font-bold':''}`}>{row[key]||0}</td>)}</tr>)}</tbody></table></div>}
                {(status.last_summary?.master_conflicts>0)&&<p className="text-xs text-amber-800">{status.last_summary.master_conflicts} master berubah di kedua sistem; versi Supabase dipertahankan.</p>}
            </>}
            <p className="text-xs text-slate-500">Input baru dan penghapusan di Supabase dipertahankan. Benturan tidak ditimpa otomatis. Dilewati berarti kredit sudah dihapus/diganti di Supabase. Penghapusan di sumber mengarsipkan baris hasil migrasi; bukti tindak lanjut tetap tersedia.</p>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!status?.enabled||status?.requested} onClick={()=>act('now')} className={`${btn} bg-emerald-600 text-white`}>Sinkronkan Sekarang</button><button type="button" disabled={busy} onClick={load} className={`${btn} bg-slate-100`}>Muat Status</button>{status?.enabled?<button type="button" disabled={busy} onClick={()=>setConfirmStop(true)} className={`${btn} bg-rose-50 text-rose-700 border border-rose-200`}>Hentikan Sinkronisasi</button>:<button type="button" disabled={busy||!status?.configured} onClick={()=>act('start')} className={`${btn} bg-slate-900 text-white`}>Aktifkan Sinkronisasi</button>}</div>
            {confirmStop&&<div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3" role="group" aria-label="Konfirmasi hentikan sinkronisasi"><p className="text-sm text-amber-950">Hentikan pembaruan dari dashboard lama? Data yang sudah masuk tetap tersedia. Setelah pindah penuh ke Supabase, biarkan sinkronisasi nonaktif.</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>setConfirmStop(false)} className={`${btn} bg-white`}>Batal</button><button type="button" disabled={busy} onClick={()=>act('stop')} className={`${btn} bg-rose-600 text-white`}>{busy?'Memproses...':'Ya, Hentikan'}</button></div></div>}
            <p className="text-xs text-slate-400">Data pada layar dashboard mengikuti pemuatan terakhir. Sinkronkan dashboard atau buka ulang halaman untuk memuat hasil server terbaru.</p>
        </section>;
    }
    window.LegacySyncPanel=LegacySyncPanel;
}());
