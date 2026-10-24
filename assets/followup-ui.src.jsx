(function () {
    const { useState, useEffect, useRef, useMemo } = React;

    function getDB() {
        return (typeof window !== 'undefined' && window.DashboardDB) || (typeof DashboardDB !== 'undefined' ? DashboardDB : null);
    }

    function getCore() {
        return (typeof window !== 'undefined' && window.FollowupCore) || {
            LABELS: { kol1: 'KOL 1 (1–10 Hari)', lar: 'LAR (11–30 Hari)', npl: 'NPL (KOL 3–5)' }
        };
    }

    function getLabel(dataset) {
        const key = String(dataset || '').toLowerCase();
        const core = getCore();
        return (core && core.LABELS && (core.LABELS[key] || core.LABELS[dataset])) || key.toUpperCase();
    }

    function generateUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            try { return crypto.randomUUID(); } catch (_) {}
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function hasValidCoords(lat, lon) {
        const nLat = Number(lat), nLon = Number(lon);
        return !isNaN(nLat) && !isNaN(nLon) && nLat !== 0 && nLon !== 0 && nLat >= -90 && nLat <= 90 && nLon >= -180 && nLon <= 180;
    }

    function getGoogleMapsUrl(lat, lon) {
        if (!hasValidCoords(lat, lon)) return '';
        return `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
    }

    const button = 'px-4 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed';
    const field = 'w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500';

    function Modal({title,onClose,busy,children,wide=false}) {
        const ref = useRef(null);
        const closeRef = useRef(onClose);
        const busyRef = useRef(busy);
        closeRef.current=onClose; busyRef.current=busy;
        useEffect(() => {
            const previous = document.activeElement;
            const overflow = document.body ? document.body.style.overflow : '';
            try { if (document.body) document.body.style.overflow = 'hidden'; } catch(_) {}
            try { ref.current?.focus(); } catch(_) {}
            const keydown = event => {
                if (event.key==='Escape' && !busyRef.current) {event.preventDefault();closeRef.current?.();}
                if(event.key==='Tab' && ref.current) {
                    try {
                        const nodes=[...ref.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')].filter(node=>node.getClientRects().length);
                        if(!nodes.length){event.preventDefault();return;}
                        const first=nodes[0],last=nodes[nodes.length-1];
                        if(event.shiftKey && (document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last.focus();}
                        else if(!event.shiftKey && (document.activeElement===last||document.activeElement===ref.current)){event.preventDefault();first.focus();}
                    } catch(_) {}
                }
            };
            document.addEventListener('keydown',keydown);
            return()=>{
                try { if (document.body) document.body.style.overflow = overflow; } catch(_) {}
                document.removeEventListener('keydown',keydown);
                try { previous?.focus?.(); } catch(_) {}
            };
        },[]);
        return <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm">
            <section ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`bg-white rounded-3xl shadow-2xl w-full ${wide?'max-w-6xl':'max-w-3xl'} max-h-[92vh] flex flex-col outline-none`}>
                <header className="flex justify-between items-center gap-3 p-5 border-b border-slate-100">
                    <h2 className="font-black text-slate-900 text-lg">{title}</h2>
                    <button type="button" aria-label="Tutup" onClick={onClose} disabled={busy} className="p-2 text-slate-500 hover:text-rose-600 disabled:opacity-30"><i className="fas fa-times"></i></button>
                </header>
                <div className="p-4 sm:p-5 overflow-y-auto min-h-0">{children}</div>
            </section>
        </div>;
    }

    function CameraCapture({record,dataset,currentUser,onBack,onSaved}) {
        const video=useRef(null), stream=useRef(null), mounted=useRef(true), generation=useRef(0), raw=useRef(null);
        const [facing,setFacing]=useState('environment');
        const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
        const [location,setLocation]=useState(null),[locationBusy,setLocationBusy]=useState(false);
        const [capture,setCapture]=useState(null),[preview,setPreview]=useState(''),[notes,setNotes]=useState('');
        const [officerName,setOfficerName]=useState(()=>{
            try {
                return sessionStorage.getItem(`last_officer_${dataset}`) || sessionStorage.getItem('last_officer_general') || '';
            } catch(_) { return ''; }
        });
        const [isCustomOfficer,setIsCustomOfficer]=useState(false);
        const [officersVersion,setOfficersVersion]=useState(0);
        useEffect(()=>{
            const handler=()=>setOfficersVersion(v=>v+1);
            window.addEventListener('dashboard_officers_updated',handler);
            return()=>window.removeEventListener('dashboard_officers_updated',handler);
        },[]);
        const officerOptions=useMemo(()=>{
            const core = getCore();
            return (core && typeof core.getOfficersForDataset === 'function')
                ? core.getOfficersForDataset(dataset)
                : [];
        },[dataset,officersVersion]);
        const datasetLabel=getLabel(dataset);

        const handleOfficerSelect=(val)=>{
            if(val==='__CUSTOM__'){
                setIsCustomOfficer(true);
                setOfficerName('');
            } else {
                setIsCustomOfficer(false);
                setOfficerName(val);
                try {
                    sessionStorage.setItem(`last_officer_${dataset}`,val);
                    sessionStorage.setItem('last_officer_general',val);
                } catch(_) {}
            }
        };

        const stop=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
        useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;stop();};},[]);
        useEffect(()=>{
            if(!capture) return;
            const url=URL.createObjectURL(capture.blob);setPreview(url);
            return()=>URL.revokeObjectURL(url);
        },[capture?.blob]);
        const readLocation=async()=>{
            setLocationBusy(true);
            try {
                const core = getCore();
                if (!core || typeof core.getLocation !== 'function') throw new Error('Modul lokasi belum siap.');
                const position=await core.getLocation();if(mounted.current)setLocation(position);return position;
            } catch(error){if(mounted.current)setError(error.message);throw error;}
            finally{if(mounted.current)setLocationBusy(false);}
        };
        useEffect(()=>{
            if(capture)return;
            let cancelled=false;
            const thisGeneration=++generation.current;
            setReady(false);setError('');
            const start=async()=>{
                try {
                    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera memerlukan HTTPS/localhost dan browser yang mendukung kamera.');
                    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:960}},audio:false});
                    if(cancelled||thisGeneration!==generation.current){media.getTracks().forEach(track=>track.stop());return;}
                    stream.current=media;video.current.srcObject=media;
                    await video.current.play();
                    if(!cancelled)setReady(true);
                } catch(error){if(!cancelled){stop();setError(error.name==='NotAllowedError'?'Izin kamera belum diberikan. Izinkan kamera pada browser lalu coba lagi.':error.name==='NotFoundError'?'Kamera tidak ditemukan. Gunakan perangkat yang memiliki kamera.':error.message);}}
            };
            start();readLocation().catch(()=>{});
            return()=>{cancelled=true;stop();};
        },[facing,!!capture]);

        const takePhoto=async()=>{
            const core = getCore();
            const cleanName=(core && typeof core.cleanFollowupText === 'function') ? core.cleanFollowupText(officerName) : String(officerName || '').trim();
            if(!cleanName){
                setError('Pilih nama petugas terlebih dahulu sebelum mengambil foto.');
                return;
            }
            setBusy(true);setError('');
            try {
                const position=await readLocation();
                if(!mounted.current)return;
                if(!video.current?.videoWidth||!video.current?.videoHeight)throw new Error('Gambar kamera belum siap. Coba lagi.');
                const canvas=document.createElement('canvas');
                const factor=Math.min(1,1600/Math.max(video.current.videoWidth,video.current.videoHeight));
                canvas.width=Math.round(video.current.videoWidth*factor);canvas.height=Math.round(video.current.videoHeight*factor);
                canvas.getContext('2d').drawImage(video.current,0,0,canvas.width,canvas.height);
                const capturedAt=new Date().toISOString();raw.current=canvas;
                const userName = currentUser?.username || currentUser?.name || currentUser?.role || 'Petugas';
                const result=await core.stampPhoto(canvas,position,capturedAt,record,userName);
                if(!mounted.current)return;
                stop();setReady(false);
                setCapture({id:generateUUID(),dataset,customer:record,capturedAt,location:position,blob:result.blob,mapIncluded:result.mapIncluded});
            }catch(error){if(mounted.current)setError(error.message);}
            finally{if(mounted.current)setBusy(false);}
        };
        const retryMap=async()=>{
            setBusy(true);setError('');
            try {
                const core = getCore();
                const userName = currentUser?.username || currentUser?.name || currentUser?.role || 'Petugas';
                const result=await core.stampPhoto(raw.current,capture.location,capture.capturedAt,record,userName);
                if(mounted.current)setCapture(previous=>({...previous,id:generateUUID(),blob:result.blob,mapIncluded:result.mapIncluded}));
            }catch(error){if(mounted.current)setError(error.message);}
            finally{if(mounted.current)setBusy(false);}
        };
        const save=async()=>{
            let details;
            const core = getCore();
            try{details=core.validateFollowupDetails(notes,officerName);}catch(error){setError(error.message);return;}
            setBusy(true);setError('');
            try {
                const DB = getDB();
                if (!DB || typeof DB.saveFollowup !== 'function') throw new Error('Koneksi database belum siap. Muat ulang halaman.');
                const saved=await DB.saveFollowup({...capture,...details});
                if(mounted.current)onSaved(saved);
            }
            catch(error){if(mounted.current)setError(`Bukti belum tersimpan: ${error.message}`);}
            finally{if(mounted.current)setBusy(false);}
        };
        const cleanOfficer = (getCore()?.cleanFollowupText ? getCore().cleanFollowupText(officerName) : String(officerName || '').trim());
        const cleanNotes = (getCore()?.cleanFollowupText ? getCore().cleanFollowupText(notes) : String(notes || '').trim());

        return <Modal title="Lampirkan Foto Tindak Lanjut" onClose={onBack} busy={busy}>
            <div className="space-y-4">
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-950 flex flex-wrap justify-between items-center gap-2">
                    <div>
                        <p className="font-black text-sm">{record?.name || 'Nasabah'}</p>
                        <p className="mt-1 font-mono">CIF: {record?.cif||'—'} · No Kredit: {record?.creditNo || '—'}</p>
                        <p className="mt-1">{record?.branch || 'Cabang'} · {datasetLabel}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl text-[11px] font-black uppercase bg-emerald-600 text-white shadow-xs">
                        {String(dataset || '').toUpperCase()}
                    </span>
                </div>

                {!capture && (
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <label className="text-xs font-bold text-slate-700 flex items-center">
                                <i className="fas fa-user-check text-emerald-600 mr-2"></i>
                                Pilih Nama Petugas ({datasetLabel}) <span className="text-rose-600 ml-1">* (Wajib sebelum ambil foto)</span>
                            </label>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                {officerOptions.length} Petugas {String(dataset || '').toUpperCase()}
                            </span>
                        </div>
                        <select
                            aria-label="Pilih nama petugas"
                            value={isCustomOfficer ? '__CUSTOM__' : (officerOptions.includes(officerName) ? officerName : (officerName ? '__CUSTOM__' : ''))}
                            onChange={event => handleOfficerSelect(event.target.value)}
                            disabled={busy}
                            className={`${field} py-2.5 font-medium`}
                        >
                            <option value="">-- Pilih Nama Petugas {datasetLabel} --</option>
                            {officerOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                            <option value="__CUSTOM__">+ Ketik Nama Lainnya...</option>
                        </select>
                        {(isCustomOfficer || (officerName && !officerOptions.includes(officerName))) && (
                            <input
                                type="text"
                                placeholder="Ketik nama lengkap petugas..."
                                value={officerName}
                                onChange={event => {
                                    const val = event.target.value;
                                    setOfficerName(val);
                                    try {
                                        sessionStorage.setItem(`last_officer_${dataset}`, val);
                                        sessionStorage.setItem('last_officer_general', val);
                                    } catch(_) {}
                                }}
                                disabled={busy}
                                maxLength={120}
                                className={`${field} py-2 mt-1`}
                            />
                        )}
                        {!cleanOfficer && (
                            <p className="text-[11px] text-amber-800 font-semibold flex items-center bg-amber-50/80 p-2 rounded-xl border border-amber-200">
                                <i className="fas fa-circle-exclamation mr-1.5 text-amber-600"></i>
                                Silakan pilih nama petugas di atas sebelum mengambil foto.
                            </p>
                        )}
                    </div>
                )}

                {error&&<p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs">{error}</p>}
                {!capture ? <>
                    <div className="relative aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center">
                        <video ref={video} playsInline muted className={`w-full h-full object-cover ${ready?'':'hidden'}`} />
                        {!ready&&<p className="text-white text-xs">{error||'Menghubungkan ke kamera...'}</p>}
                        <div className="absolute top-3 left-3 bg-slate-950/70 text-white text-[11px] px-3 py-1.5 rounded-xl font-mono">
                            {locationBusy?'Mencari GPS...':location?`GPS ±${Math.round(location.accuracy)} m`:'GPS belum terkunci'}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-between items-center">
                        <button type="button" onClick={()=>setFacing(current=>current==='environment'?'user':'environment')} disabled={busy} className={`${button} bg-slate-100`}>Ganti Kamera</button>
                        <button type="button" onClick={takePhoto} disabled={busy||!ready||!cleanOfficer} className={`${button} bg-emerald-600 text-white flex items-center shadow-md`}>
                            <i className="fas fa-camera mr-2"></i>Ambil Foto Bukti
                        </button>
                    </div>
                </> : <>
                    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-950">
                        <img src={preview} alt="Pratinjau foto tindak lanjut" className="w-full max-h-[50vh] object-contain" />
                    </div>
                    {!capture.mapIncluded&&<div className="p-3 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs flex justify-between items-center gap-2">
                        <span>Peta belum termuat. Koordinat GPS tetap tercatat.</span>
                        <button type="button" disabled={busy} onClick={retryMap} className={`${button} bg-white border border-amber-300 text-amber-900`}>Muat Ulang Peta</button>
                    </div>}
                    <div className="p-3 bg-emerald-50 text-emerald-950 border border-emerald-200 rounded-xl text-xs space-y-1">
                        <p><strong>Petugas:</strong> {officerName || '—'}</p>
                        <p><strong>Kategori:</strong> {datasetLabel}</p>
                    </div>
                    <label className="block text-xs font-bold text-slate-700">Hasil Kunjungan / Catatan Tindak Lanjut *
                        <textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={2000} rows={3} placeholder="Contoh: Bertemu debitur langsung di lokasi, janji bayar..." className={`${field} mt-1`} />
                    </label>
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button type="button" disabled={busy} onClick={()=>{raw.current=null;setCapture(null);setError('');}} className={`${button} bg-slate-100`}>Foto Ulang</button>
                        <button type="button" disabled={busy||!cleanNotes||!cleanOfficer} onClick={save} className={`${button} bg-emerald-600 text-white`}><i className="fas fa-cloud-arrow-up mr-2"></i>{busy?'Menyimpan Bukti...':'Simpan Tindak Lanjut'}</button>
                    </div>
                </>}
            </div>
        </Modal>;
    }

    function FollowupListDialog({rows,branch,dataset,currentUser,onClose,showToast}) {
        const [search,setSearch]=useState(''),[selected,setSelected]=useState(null),[history,setHistory]=useState([]),[historyError,setHistoryError]=useState('');
        useEffect(()=>{
            let active=true;
            const DB = getDB();
            if (DB && typeof DB.listFollowups === 'function') {
                DB.listFollowups().then(result=>{
                    if(active) setHistory(Array.isArray(result) ? result : []);
                }).catch(error=>{
                    if(active) setHistoryError(error.message);
                });
            }
            return()=>{active=false;};
        },[]);

        const core = getCore();
        const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const customerFn = (core && typeof core.customer === 'function') ? core.customer : (row => ({
            sourceId: row?._id || null,
            cif: String(row?.CIF || row?.cif || ''),
            creditNo: String(row?.NO_KONTRAK || row?.NoKredit || '—'),
            name: String(row?.CUSTOMER_NM || row?.Nama || 'Nasabah'),
            branch: String(row?.CABANG || row?.Cabang || '')
        }));

        const visible = safeRows.map(customerFn).filter(row => {
            if (!search.trim()) return true;
            const q = search.trim().toLowerCase();
            return [row.cif, row.creditNo, row.name].some(value => String(value || '').toLowerCase().includes(q));
        });

        const saved = row => {
            if (!Array.isArray(history)) return 0;
            const b = String(branch || '').toLowerCase();
            const ds = String(dataset || '').toLowerCase();
            const cn = String(row?.creditNo || '');
            return history.filter(item => item && String(item.branch || '').toLowerCase() === b && String(item.dataset || '').toLowerCase() === ds && String(item.credit_no || '') === cn).length;
        };

        const datasetLabel = getLabel(dataset);

        if(selected)return <CameraCapture record={selected} dataset={dataset} currentUser={currentUser} onBack={()=>setSelected(null)} onSaved={result=>{
            setHistory(previous=>[result,...(Array.isArray(previous)?previous:[]).filter(item=>item && item.id!==result.id)]);setSelected(null);showToast?.('Foto tindak lanjut tersimpan dan masuk rekap admin.');
        }} />;

        return <Modal title={`Tindak Lanjut · ${datasetLabel}`} onClose={onClose} wide>
            <div className="space-y-4">
                <div className="flex flex-wrap gap-3 justify-between items-center">
                    <div>
                        <p className="text-sm font-bold text-emerald-800">{branch} <span className="font-normal text-slate-500">· {safeRows.length} nasabah</span></p>
                        <p className="text-xs text-slate-500 mt-0.5">Kategori: <strong className="text-slate-800">{datasetLabel}</strong></p>
                    </div>
                    <input aria-label="Cari nasabah tindak lanjut" className={`${field} sm:max-w-sm`} placeholder="Cari CIF, no kredit, atau nama nasabah" value={search} onChange={event=>setSearch(event.target.value)} />
                </div>
                {historyError&&<p role="alert" className="text-xs text-amber-800 bg-amber-50 p-3 rounded-xl">Riwayat belum dapat dimuat: {historyError}</p>}
                <div className="overflow-x-auto border border-slate-200 rounded-2xl max-h-[56vh]">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['CIF','No Kredit','Nama Nasabah','Foto Tindak Lanjut'].map(label=><th className="p-3 whitespace-nowrap" key={label}>{label}</th>)}</tr></thead>
                        <tbody className="divide-y divide-slate-100">{visible.map((row,index)=><tr key={`${row.sourceId||row.creditNo}:${index}`}>
                            <td className="p-3 font-mono whitespace-nowrap">{row.cif||'—'}</td><td className="p-3 font-mono whitespace-nowrap">{row.creditNo}</td><td className="p-3 font-bold text-slate-800">{row.name}</td>
                            <td className="p-3"><div className="flex flex-wrap gap-2 items-center"><button type="button" onClick={()=>setSelected(row)} className={`${button} bg-emerald-600 text-white whitespace-nowrap`}><i className="fas fa-camera mr-2"></i>Lampirkan Foto</button>{saved(row)>0&&<span className="text-emerald-700 font-bold">{saved(row)} foto tersimpan</span>}</div></td>
                        </tr>)}{!visible.length&&<tr><td colSpan={4} className="p-8 text-center text-slate-500">Tidak ada nasabah sesuai pencarian.</td></tr>}</tbody>
                    </table>
                </div>
                <p className="text-xs text-slate-400">Setiap kunjungan dapat memiliki foto baru. Daftar ini mengikuti cabang yang dipilih.</p>
            </div>
        </Modal>;
    }

    function PhotoDialog({item,onClose}) {
        const [url,setUrl]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
        useEffect(()=>{
            let active=true;
            const DB = getDB();
            setLoading(true);
            setError('');
            setUrl('');

            if (item?.photo_url || item?.photo_data || item?.preview) {
                setUrl(item.photo_url || item.photo_data || item.preview);
                setLoading(false);
                return () => { active = false; };
            }

            if (DB && typeof DB.followupPhotoUrl === 'function' && item?.photo_path) {
                DB.followupPhotoUrl(item.photo_path)
                    .then(value => {
                        if (active) {
                            setUrl(value);
                            setLoading(false);
                        }
                    })
                    .catch(err => {
                        if (active) {
                            setError(err.message || 'Gagal memuat foto.');
                            setLoading(false);
                        }
                    });
            } else {
                setError(item?.photo_path ? 'Koneksi database belum siap.' : 'Foto bukti tidak ditemukan.');
                setLoading(false);
            }
            return () => { active = false; };
        }, [item?.id, item?.photo_path]);

        const core = getCore();
        return <Modal title={`Bukti Foto · ${item?.customer_name || 'Nasabah'}`} onClose={onClose}>
            <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 shadow-sm flex items-center justify-center min-h-[240px] max-h-[60vh]">
                    {loading && (
                        <div className="p-8 flex flex-col items-center justify-center text-slate-300">
                            <i className="fas fa-circle-notch fa-spin text-3xl text-emerald-400 mb-3"></i>
                            <p className="text-xs font-semibold">Memuat gambar bukti foto...</p>
                        </div>
                    )}
                    {error && (
                        <div className="p-6 text-center text-rose-300">
                            <i className="fas fa-triangle-exclamation text-2xl mb-2"></i>
                            <p role="alert" className="text-xs">{error}</p>
                        </div>
                    )}
                    {url && !loading && (
                        <img
                            src={url}
                            alt={`Bukti Foto ${item?.customer_name || ''}`}
                            className="w-full h-auto max-h-[60vh] object-contain rounded-2xl"
                            onError={() => setError('Gambar bukti foto tidak dapat ditampilkan atau link telah kedaluwarsa.')}
                        />
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                        <p className="text-sm font-bold text-slate-900">{core?.formatTime ? core.formatTime(item.captured_at) : item.captured_at}</p>
                        <p className="text-xs text-slate-600 mt-0.5">Petugas: <span className="font-semibold text-slate-800">{(core?.officerName ? core.officerName(item) : (item.officer_name || item.actor_name))}</span></p>
                    </div>
                    {url && !error && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
                            title="Buka foto dalam ukuran penuh di tab baru"
                        >
                            <i className="fas fa-arrow-up-right-from-square"></i> Ukuran Penuh
                        </a>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div><span className="text-slate-400">Akun Pengunggah:</span> <span className="font-semibold">{item?.actor_name}</span></div>
                    <div><span className="text-slate-400">Cabang / Unit:</span> <span className="font-semibold">{item?.branch}</span></div>
                    <div><span className="text-slate-400">No. Rekening / Kredit:</span> <span className="font-mono font-bold text-slate-800">{item?.credit_no}</span></div>
                    <div><span className="text-slate-400">Kategori:</span> <span className="font-bold text-emerald-700">{getLabel(item?.dataset)}</span></div>
                </div>

                {hasValidCoords(item?.latitude, item?.longitude) ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a
                            href={getGoogleMapsUrl(item.latitude, item.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
                            title="Buka titik koordinat di Google Maps"
                        >
                            <i className="fas fa-map-location-dot"></i> Buka Google Maps · ±{Math.round(item?.accuracy_m || 0)} m
                        </a>
                        {core?.mapUrl && (
                            <a
                                href={core.mapUrl(item.latitude, item.longitude)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-slate-500 hover:text-slate-700 underline ml-1"
                                title="Buka titik koordinat di OpenStreetMap"
                            >
                                OpenStreetMap
                            </a>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 italic">Koordinat lokasi tidak tersedia</p>
                )}
                {item?.notes&&<p className="text-sm text-slate-600 whitespace-pre-wrap">{item.notes}</p>}
            </div>
        </Modal>;
    }

    function FollowupAdminView({currentUser,showToast}) {
        const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[photo,setPhoto]=useState(null);
        const [deleteTarget,setDeleteTarget]=useState(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
        const [filters,setFilters]=useState({branch:'',dataset:'',officer:'',start:'',end:'',search:''});
        const [pdfProgress,setPdfProgress]=useState(null),[pdfError,setPdfError]=useState('');
        const pdfController=useRef(null);
        const generation=useRef(0),mounted=useRef(true);

        const load=async()=>{
            const current=++generation.current;setLoading(true);setError('');
            try {
                const DB = getDB();
                if (!DB || typeof DB.listFollowups !== 'function') throw new Error('Koneksi database belum siap.');
                const result=await DB.listFollowups();
                if(mounted.current&&current===generation.current) setRows(Array.isArray(result) ? result : []);
            }
            catch(error){if(mounted.current&&current===generation.current)setError(error.message);}
            finally{if(mounted.current&&current===generation.current)setLoading(false);}
        };
        useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;generation.current++;pdfController.current?.abort();};},[]);

        const core = getCore();
        const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const visible=useMemo(()=>(core && typeof core.filterRecap === 'function' ? core.filterRecap(safeRows,filters) : safeRows),[safeRows,filters]);
        const branches=[...new Set(safeRows.map(row=>row.branch).filter(Boolean))].sort();
        const officersList=useMemo(()=>[...new Set(safeRows.map(r => (core && typeof core.officerName === 'function' ? core.officerName(r) : (r?.officer_name || r?.actor_name || ''))).filter(Boolean))].sort(),[safeRows]);
        const countKol1=useMemo(()=>safeRows.filter(r=>r && r.dataset==='kol1').length,[safeRows]);
        const countLar=useMemo(()=>safeRows.filter(r=>r && r.dataset==='lar').length,[safeRows]);
        const countNpl=useMemo(()=>safeRows.filter(r=>r && r.dataset==='npl').length,[safeRows]);

        const change=(name,value)=>setFilters(previous=>({...previous,[name]:value}));
        const remove=async()=>{
            setDeleting(true);setDeleteError('');
            try {
                const DB = getDB();
                if (!DB || typeof DB.deleteFollowup !== 'function') throw new Error('Koneksi database belum siap.');
                await DB.deleteFollowup(deleteTarget.id);
                generation.current++;
                if(mounted.current){
                    setRows(previous=>previous.filter(row=>row && row.id!==deleteTarget.id));
                    setLoading(false);setDeleteTarget(null);
                    showToast?.('Tindak lanjut berhasil dihapus dari rekap.');
                }
            }catch(error){if(mounted.current)setDeleteError(error.message);}
            finally{if(mounted.current)setDeleting(false);}
        };
        const exportCsv=()=>{
            if (!core || typeof core.recapCsv !== 'function') return;
            const url=URL.createObjectURL(new Blob([core.recapCsv(visible)],{type:'text/csv;charset=utf-8;'}));
            const link=document.createElement('a');link.href=url;link.download=`Rekap_Tindak_Lanjut_${core.localDay(new Date())}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        const exportPdf=async()=>{
            if (!window.FollowupPdf || typeof window.FollowupPdf.exportReport !== 'function') return;
            const controller=new AbortController();pdfController.current=controller;setPdfError('');setPdfProgress({completed:0,total:visible.length});
            try{
                const DB = getDB();
                await window.FollowupPdf.exportReport({
                    rows:[...visible],
                    filters:{...filters},
                    getPhotoUrl: (DB && typeof DB.followupPhotoUrl === 'function') ? DB.followupPhotoUrl : (async () => ''),
                    signal:controller.signal,
                    onProgress:progress=>{if(mounted.current)setPdfProgress(progress);}
                });
                if(mounted.current)showToast?.('Rekap PDF beserta seluruh foto selesai dibuat. Unduhan dimulai.');
            }catch(error){if(mounted.current&&error.name!=='AbortError')setPdfError(error.message);}
            finally{if(mounted.current)setPdfProgress(null);pdfController.current=null;}
        };
        if(currentUser?.role!=='admin')return null;
        return <div className="space-y-5">
            {photo&&<PhotoDialog item={photo} onClose={()=>setPhoto(null)} />}
            {deleteTarget&&<Modal title="Hapus Tindak Lanjut" busy={deleting} onClose={()=>setDeleteTarget(null)}>
                <div className="space-y-4">
                    <p className="text-sm text-slate-600">Hapus bukti tindak lanjut berikut dari rekap?</p>
                    <div className="p-4 rounded-2xl bg-slate-50 text-sm text-slate-800 space-y-1">
                        <p className="font-bold">{deleteTarget.customer_name}</p>
                        <p className="font-mono">CIF: {deleteTarget.cif} · No Kredit: {deleteTarget.credit_no}</p>
                        <p>{deleteTarget.branch} · {getLabel(deleteTarget.dataset)}</p>
                        <p>{core?.formatTime ? core.formatTime(deleteTarget.captured_at) : deleteTarget.captured_at} · {(core?.officerName ? core.officerName(deleteTarget) : (deleteTarget.officer_name || deleteTarget.actor_name))}</p>
                    </div>
                    <p className="text-xs text-slate-500">Bukti tidak tampil lagi di rekap dan foto tidak dapat dibuka kembali dari aplikasi. Arsip tetap disimpan di database. Data kredit nasabah tetap tersedia.</p>
                    {deleteError&&<p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl text-sm">Bukti belum dihapus: {deleteError}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" disabled={deleting} onClick={()=>setDeleteTarget(null)} className={`${button} bg-slate-100`}>Batal</button>
                        <button type="button" disabled={deleting} onClick={remove} className={`${button} bg-rose-600 text-white`}>{deleting?'Menghapus...':'Ya, Hapus'}</button>
                    </div>
                </div>
            </Modal>}
            <div className="bg-white border border-slate-200 p-5 rounded-3xl flex flex-wrap justify-between gap-4 items-center">
                <div><h1 className="text-xl font-black text-slate-900">Rekap Tindak Lanjut</h1><p className="text-xs text-slate-500 mt-1">Bukti kunjungan KOL 1, LAR, dan NPL dari seluruh petugas.</p></div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={loading||!!pdfProgress} onClick={load} className={`${button} bg-slate-100`}><i className="fas fa-rotate mr-2"></i>Muat Ulang</button>
                    <button type="button" disabled={loading||!visible.length||!!error||!!pdfProgress} onClick={exportCsv} className={`${button} bg-emerald-600 text-white`}>Unduh Rekap CSV</button>
                    <button type="button" disabled={loading||!visible.length||!!error||!!pdfProgress} onClick={exportPdf} className={`${button} bg-slate-900 text-white`}>{pdfProgress?`Menyiapkan Foto ${pdfProgress.completed}/${pdfProgress.total}`:'Cetak PDF'}</button>
                    {pdfProgress&&<button type="button" onClick={()=>pdfController.current?.abort()} className={`${button} bg-rose-50 text-rose-700`}>Batalkan PDF</button>}
                </div>
            </div>
            {pdfError&&<p role="alert" className="bg-rose-50 text-rose-700 p-4 rounded-2xl text-sm">PDF belum dibuat: {pdfError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[
                ['Bukti Foto',visible.length],['Nasabah Ditindaklanjuti',new Set(visible.map(row=>`${row.branch}|${row.credit_no}`)).size],['Petugas',new Set(visible.map(r => (core?.officerIdentity ? core.officerIdentity(r) : (r?.officer_name || r?.actor_name || '')))).size]
            ].map(([label,value])=><div key={label} className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="text-2xl font-black text-emerald-700 mt-2">{value}</p></div>)}</div>

            {/* Quick Category Filter Pills */}
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-500 mr-1 flex items-center">
                        <i className="fas fa-filter text-emerald-600 mr-1.5"></i> Kategori:
                    </span>
                    <button
                        type="button"
                        onClick={() => change('dataset', '')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition ${
                            !filters.dataset
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        Semua ({safeRows.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => change('dataset', 'kol1')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${
                            filters.dataset === 'kol1'
                                ? 'bg-amber-600 text-white shadow-xs'
                                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                        }`}
                    >
                        <i className="fas fa-triangle-exclamation mr-1.5 text-[10px]"></i>
                        KOL 1 ({countKol1})
                    </button>
                    <button
                        type="button"
                        onClick={() => change('dataset', 'lar')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${
                            filters.dataset === 'lar'
                                ? 'bg-orange-600 text-white shadow-xs'
                                : 'bg-orange-50 text-orange-800 hover:bg-orange-100 border border-orange-200'
                        }`}
                    >
                        <i className="fas fa-clock-rotate-left mr-1.5 text-[10px]"></i>
                        LAR ({countLar})
                    </button>
                    <button
                        type="button"
                        onClick={() => change('dataset', 'npl')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${
                            filters.dataset === 'npl'
                                ? 'bg-rose-600 text-white shadow-xs'
                                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
                        }`}
                    >
                        <i className="fas fa-circle-exclamation mr-1.5 text-[10px]"></i>
                        NPL ({countNpl})
                    </button>
                </div>
                {filters.dataset && (
                    <button
                        type="button"
                        onClick={() => change('dataset', '')}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center"
                    >
                        <i className="fas fa-times-circle mr-1"></i> Reset Filter Kategori
                    </button>
                )}
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
                <label className="text-xs font-bold text-slate-500">Cabang<select aria-label="Cabang rekap tindak lanjut" value={filters.branch} onChange={event=>change('branch',event.target.value)} className={`${field} mt-1`}><option value="">Semua Cabang</option>{branches.map(branch=><option key={branch}>{branch}</option>)}</select></label>
                <label className="text-xs font-bold text-slate-500">Kategori<select aria-label="Kategori rekap tindak lanjut" value={filters.dataset} onChange={event=>change('dataset',event.target.value)} className={`${field} mt-1`}>
                    <option value="">Semua Kategori (KOL 1, LAR, NPL)</option>
                    <option value="kol1">KOL 1 (1–10 Hari)</option>
                    <option value="lar">LAR (11–30 Hari)</option>
                    <option value="npl">NPL (KOL 3–5)</option>
                </select></label>
                <label className="text-xs font-bold text-slate-500">Petugas<select aria-label="Petugas rekap tindak lanjut" value={filters.officer || ''} onChange={event=>change('officer',event.target.value)} className={`${field} mt-1`}><option value="">Semua Petugas</option>{officersList.map(officer=><option key={officer} value={officer}>{officer}</option>)}</select></label>
                <label className="text-xs font-bold text-slate-500">Mulai tanggal (WIB)<input type="date" value={filters.start} max={filters.end||undefined} onChange={event=>change('start',event.target.value)} className={`${field} mt-1`} /></label>
                <label className="text-xs font-bold text-slate-500">Sampai tanggal (WIB)<input type="date" value={filters.end} min={filters.start||undefined} onChange={event=>change('end',event.target.value)} className={`${field} mt-1`} /></label>
                <label className="text-xs font-bold text-slate-500">Cari nasabah / petugas<input aria-label="Cari rekap tindak lanjut" value={filters.search} onChange={event=>change('search',event.target.value)} placeholder="CIF, kredit, nama, petugas" className={`${field} mt-1`} /></label>
            </div>
            {error&&<p role="alert" className="bg-rose-50 text-rose-700 p-4 rounded-2xl text-sm">Rekap belum dapat dimuat: {error}</p>}
            {loading?<p className="text-sm text-slate-500 p-6">Memuat bukti tindak lanjut...</p>:<div className="bg-white border border-slate-200 rounded-3xl overflow-x-auto">
                <table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Waktu Foto (WIB)','Kategori / Cabang','CIF / No Kredit','Nama Nasabah','Nama Petugas','Lokasi','Bukti / Catatan'].map(label=><th key={label} className="p-4 whitespace-nowrap">{label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{visible.map(row=><tr key={row.id}>
                        <td className="p-4 whitespace-nowrap">{core?.formatTime ? core.formatTime(row.captured_at) : row.captured_at}</td><td className="p-4"><span className="font-bold">{getLabel(row.dataset)}</span><br/>{row.branch}</td>
                        <td className="p-4 font-mono whitespace-nowrap">{row.cif}<br/><strong>{row.credit_no}</strong></td><td className="p-4 font-bold">{row.customer_name}</td><td className="p-4"><p className="font-bold">{(core?.officerName ? core.officerName(row) : (row.officer_name || row.actor_name))}</p><p className="text-slate-400 mt-1">Akun: {row.actor_name}</p>{!row.officer_name&&<p className="text-amber-700 mt-1">Nama belum diisi (data lama)</p>}</td>
                        <td className="p-4 whitespace-nowrap">
                            {hasValidCoords(row.latitude, row.longitude) ? (
                                <div>
                                    <a
                                        href={getGoogleMapsUrl(row.latitude, row.longitude)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold underline"
                                        title="Buka titik koordinat di Google Maps"
                                    >
                                        <i className="fas fa-map-location-dot text-emerald-600"></i> Buka Maps
                                    </a>
                                    <p className="text-slate-400 mt-1 text-[11px]">±{Math.round(row.accuracy_m || 0)} m</p>
                                </div>
                            ) : (
                                <div>
                                    <span className="text-slate-400 italic">Peta</span>
                                    <p className="text-slate-400 mt-1 text-[11px]">±{Math.round(row.accuracy_m || 0)} m</p>
                                </div>
                            )}
                        </td>
                        <td className="p-4 min-w-[180px]"><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>setPhoto(row)} className={`${button} bg-emerald-50 text-emerald-800 border border-emerald-200`}>Lihat Foto</button><button type="button" onClick={()=>{setDeleteError('');setDeleteTarget(row);}} className={`${button} bg-rose-50 text-rose-700 border border-rose-200`}>Hapus</button></div>{row.notes&&<p className="mt-2 text-slate-500 whitespace-pre-wrap">{row.notes}</p>}</td>
                    </tr>)}{!visible.length&&<tr><td colSpan={7} className="p-10 text-center text-slate-500">{error?'Perbaiki koneksi lalu muat ulang.':'Belum ada tindak lanjut sesuai filter.'}</td></tr>}</tbody>
                </table>
            </div>}
        </div>;
    }
    window.FollowupListDialog=FollowupListDialog;
    window.FollowupAdminView=FollowupAdminView;
    window.FollowupListDialogComponent=FollowupListDialog;
    window.FollowupAdminViewComponent=FollowupAdminView;
    if (typeof window !== "undefined") {
        if (!window.FollowupCore) window.FollowupCore = {};
        window.FollowupCore.UI = { FollowupListDialog, FollowupAdminView };
    }
}());
