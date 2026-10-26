(function () {
  const {
    useState,
    useEffect,
    useRef,
    useMemo
  } = React;
  function getDB() {
    return typeof window !== 'undefined' && window.DashboardDB || (typeof DashboardDB !== 'undefined' ? DashboardDB : null);
  }
  function getCore() {
    return typeof window !== 'undefined' && window.FollowupCore || {
      LABELS: {
        kol1: 'KOL 1 (1–10 Hari)',
        lar: 'LAR (11–30 Hari)',
        npl: 'NPL (KOL 3–5)',
        arrumExp: 'Arrum Exspres Loan'
      }
    };
  }
  function getLabel(dataset) {
    const key = String(dataset || '').toLowerCase();
    const core = getCore();
    if (key === 'arrumexp' || key === 'arrum' || key.includes('arrum')) return 'Arrum Exspres Loan';
    return core && core.LABELS && (core.LABELS[key] || core.LABELS[dataset]) || key.toUpperCase();
  }
  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch (_) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : r & 0x3 | 0x8;
      return v.toString(16);
    });
  }
  function hasValidCoords(lat, lon) {
    const nLat = Number(lat),
      nLon = Number(lon);
    return !isNaN(nLat) && !isNaN(nLon) && nLat !== 0 && nLon !== 0 && nLat >= -90 && nLat <= 90 && nLon >= -180 && nLon <= 180;
  }
  function getGoogleMapsUrl(lat, lon) {
    if (!hasValidCoords(lat, lon)) return '';
    return `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
  }
  const button = 'px-4 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const field = 'w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500';
  function Modal({
    title,
    onClose,
    busy,
    children,
    wide = false
  }) {
    const ref = useRef(null);
    const closeRef = useRef(onClose);
    const busyRef = useRef(busy);
    closeRef.current = onClose;
    busyRef.current = busy;
    useEffect(() => {
      const previous = document.activeElement;
      const overflow = document.body ? document.body.style.overflow : '';
      try {
        if (document.body) document.body.style.overflow = 'hidden';
      } catch (_) {}
      try {
        ref.current?.focus();
      } catch (_) {}
      const keydown = event => {
        if (event.key === 'Escape' && !busyRef.current) {
          event.preventDefault();
          closeRef.current?.();
        }
        if (event.key === 'Tab' && ref.current) {
          try {
            const nodes = [...ref.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')].filter(node => node.getClientRects().length);
            if (!nodes.length) {
              event.preventDefault();
              return;
            }
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
              event.preventDefault();
              first.focus();
            }
          } catch (_) {}
        }
      };
      document.addEventListener('keydown', keydown);
      return () => {
        try {
          if (document.body) document.body.style.overflow = overflow;
        } catch (_) {}
        document.removeEventListener('keydown', keydown);
        try {
          previous?.focus?.();
        } catch (_) {}
      };
    }, []);
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm"
    }, /*#__PURE__*/React.createElement("section", {
      ref: ref,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
      tabIndex: -1,
      className: `bg-white rounded-3xl shadow-2xl w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'} max-h-[92vh] flex flex-col outline-none`
    }, /*#__PURE__*/React.createElement("header", {
      className: "flex justify-between items-center gap-3 p-5 border-b border-slate-100"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "font-black text-slate-900 text-lg"
    }, title), /*#__PURE__*/React.createElement("button", {
      type: "button",
      "aria-label": "Tutup",
      onClick: onClose,
      disabled: busy,
      className: "p-2 text-slate-500 hover:text-rose-600 disabled:opacity-30"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-times"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "p-4 sm:p-5 overflow-y-auto min-h-0"
    }, children)));
  }
  function CameraCapture({
    record,
    dataset,
    currentUser,
    onBack,
    onSaved
  }) {
    const video = useRef(null),
      stream = useRef(null),
      mounted = useRef(true),
      generation = useRef(0),
      raw = useRef(null);
    const [facing, setFacing] = useState('environment');
    const [ready, setReady] = useState(false),
      [busy, setBusy] = useState(false),
      [error, setError] = useState('');
    const [location, setLocation] = useState(null),
      [locationBusy, setLocationBusy] = useState(false);
    const [capture, setCapture] = useState(null),
      [preview, setPreview] = useState(''),
      [notes, setNotes] = useState('');
    const [officerName, setOfficerName] = useState(() => {
      try {
        return sessionStorage.getItem(`last_officer_${dataset}`) || sessionStorage.getItem('last_officer_general') || '';
      } catch (_) {
        return '';
      }
    });
    const [isCustomOfficer, setIsCustomOfficer] = useState(false);
    const [officersVersion, setOfficersVersion] = useState(0);
    useEffect(() => {
      const handler = () => setOfficersVersion(v => v + 1);
      window.addEventListener('dashboard_officers_updated', handler);
      return () => window.removeEventListener('dashboard_officers_updated', handler);
    }, []);
    const officerOptions = useMemo(() => {
      const core = getCore();
      return core && typeof core.getOfficersForDataset === 'function' ? core.getOfficersForDataset(dataset) : [];
    }, [dataset, officersVersion]);
    const datasetLabel = getLabel(dataset);
    const handleOfficerSelect = val => {
      if (val === '__CUSTOM__') {
        setIsCustomOfficer(true);
        setOfficerName('');
      } else {
        setIsCustomOfficer(false);
        setOfficerName(val);
        try {
          sessionStorage.setItem(`last_officer_${dataset}`, val);
          sessionStorage.setItem('last_officer_general', val);
        } catch (_) {}
      }
    };
    const stop = () => {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
    };
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        generation.current++;
        stop();
      };
    }, []);
    useEffect(() => {
      if (!capture) return;
      const url = URL.createObjectURL(capture.blob);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }, [capture?.blob]);
    const readLocation = async () => {
      setLocationBusy(true);
      try {
        const core = getCore();
        if (!core || typeof core.getLocation !== 'function') throw new Error('Modul lokasi belum siap.');
        const position = await core.getLocation();
        if (mounted.current) setLocation(position);
        return position;
      } catch (error) {
        if (mounted.current) setError(error.message);
        throw error;
      } finally {
        if (mounted.current) setLocationBusy(false);
      }
    };
    useEffect(() => {
      if (capture) return;
      let cancelled = false;
      const thisGeneration = ++generation.current;
      setReady(false);
      setError('');
      const start = async () => {
        try {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Kamera memerlukan HTTPS/localhost dan browser yang mendukung kamera.');
          const media = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                ideal: facing
              },
              width: {
                ideal: 1280
              },
              height: {
                ideal: 960
              }
            },
            audio: false
          });
          if (cancelled || thisGeneration !== generation.current) {
            media.getTracks().forEach(track => track.stop());
            return;
          }
          stream.current = media;
          video.current.srcObject = media;
          await video.current.play();
          if (!cancelled) setReady(true);
        } catch (error) {
          if (!cancelled) {
            stop();
            setError(error.name === 'NotAllowedError' ? 'Izin kamera belum diberikan. Izinkan kamera pada browser lalu coba lagi.' : error.name === 'NotFoundError' ? 'Kamera tidak ditemukan. Gunakan perangkat yang memiliki kamera.' : error.message);
          }
        }
      };
      start();
      readLocation().catch(() => {});
      return () => {
        cancelled = true;
        stop();
      };
    }, [facing, !!capture]);
    const isPhotoAllowed = getCore() && typeof getCore().isPhotoAccessAllowed === 'function' ? getCore().isPhotoAccessAllowed() : (() => {
      const hour = new Date().getHours();
      return hour >= 6 && hour < 18;
    })();
    const takePhoto = async () => {
      const core = getCore();
      if (!isPhotoAllowed) {
        setError('Lampiran foto tindak lanjut tidak dapat diambil melewati jam 18.00 WIB dan kembali dibuka jam 06.00 WIB pagi.');
        return;
      }
      const cleanName = core && typeof core.cleanFollowupText === 'function' ? core.cleanFollowupText(officerName) : String(officerName || '').trim();
      if (!cleanName) {
        setError('Pilih nama petugas terlebih dahulu sebelum mengambil foto.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const position = await readLocation();
        if (!mounted.current) return;
        if (!video.current?.videoWidth || !video.current?.videoHeight) throw new Error('Gambar kamera belum siap. Coba lagi.');
        const canvas = document.createElement('canvas');
        const factor = Math.min(1, 1600 / Math.max(video.current.videoWidth, video.current.videoHeight));
        canvas.width = Math.round(video.current.videoWidth * factor);
        canvas.height = Math.round(video.current.videoHeight * factor);
        canvas.getContext('2d').drawImage(video.current, 0, 0, canvas.width, canvas.height);
        const capturedAt = new Date().toISOString();
        raw.current = canvas;
        const userName = currentUser?.username || currentUser?.name || currentUser?.role || 'Petugas';
        const result = await core.stampPhoto(canvas, position, capturedAt, record, userName);
        if (!mounted.current) return;
        stop();
        setReady(false);
        setCapture({
          id: generateUUID(),
          dataset,
          customer: record,
          capturedAt,
          location: position,
          blob: result.blob,
          mapIncluded: result.mapIncluded
        });
      } catch (error) {
        if (mounted.current) setError(error.message);
      } finally {
        if (mounted.current) setBusy(false);
      }
    };
    const retryMap = async () => {
      setBusy(true);
      setError('');
      try {
        const core = getCore();
        const userName = currentUser?.username || currentUser?.name || currentUser?.role || 'Petugas';
        const result = await core.stampPhoto(raw.current, capture.location, capture.capturedAt, record, userName);
        if (mounted.current) setCapture(previous => ({
          ...previous,
          id: generateUUID(),
          blob: result.blob,
          mapIncluded: result.mapIncluded
        }));
      } catch (error) {
        if (mounted.current) setError(error.message);
      } finally {
        if (mounted.current) setBusy(false);
      }
    };
    const save = async () => {
      if (!isPhotoAllowed) {
        setError('Lampiran foto tindak lanjut tidak dapat disimpan melewati jam 18.00 WIB dan kembali dibuka jam 06.00 WIB pagi.');
        return;
      }
      let details;
      const core = getCore();
      try {
        details = core.validateFollowupDetails(notes, officerName);
      } catch (error) {
        setError(error.message);
        return;
      }
      setBusy(true);
      setError('');
      try {
        const DB = getDB();
        if (!DB || typeof DB.saveFollowup !== 'function') throw new Error('Koneksi database belum siap. Muat ulang halaman.');
        const saved = await DB.saveFollowup({
          ...capture,
          ...details
        });
        if (mounted.current) onSaved(saved);
      } catch (error) {
        if (mounted.current) setError(`Bukti belum tersimpan: ${error.message}`);
      } finally {
        if (mounted.current) setBusy(false);
      }
    };
    const cleanOfficer = getCore()?.cleanFollowupText ? getCore().cleanFollowupText(officerName) : String(officerName || '').trim();
    const cleanNotes = getCore()?.cleanFollowupText ? getCore().cleanFollowupText(notes) : String(notes || '').trim();
    return /*#__PURE__*/React.createElement(Modal, {
      title: "Lampirkan Foto Tindak Lanjut",
      onClose: onBack,
      busy: busy
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-950 flex flex-wrap justify-between items-center gap-2"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      className: "font-black text-sm"
    }, record?.name || 'Nasabah'), /*#__PURE__*/React.createElement("p", {
      className: "mt-1 font-mono"
    }, "CIF: ", record?.cif || '—', " \xB7 No Kredit: ", record?.creditNo || '—'), /*#__PURE__*/React.createElement("p", {
      className: "mt-1"
    }, record?.branch || 'Cabang', " \xB7 ", datasetLabel)), /*#__PURE__*/React.createElement("span", {
      className: "px-2.5 py-1 rounded-xl text-[11px] font-black uppercase bg-emerald-600 text-white shadow-xs"
    }, String(dataset || '').toUpperCase())), !isPhotoAllowed && /*#__PURE__*/React.createElement("div", {
      className: "p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl text-xs font-semibold flex items-center gap-2.5"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-lock text-amber-600 text-sm"
    }), /*#__PURE__*/React.createElement("span", null, "Lampiran foto ditutup melewati jam 18.00 WIB dan kembali dibuka jam 06.00 WIB pagi.")), !capture && /*#__PURE__*/React.createElement("div", {
      className: "rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center justify-between gap-1"
    }, /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-700 flex items-center"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-user-check text-emerald-600 mr-2"
    }), "Pilih Nama Petugas (", datasetLabel, ") ", /*#__PURE__*/React.createElement("span", {
      className: "text-rose-600 ml-1"
    }, "* (Wajib sebelum ambil foto)")), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"
    }, officerOptions.length, " Petugas ", String(dataset || '').toUpperCase())), /*#__PURE__*/React.createElement("select", {
      "aria-label": "Pilih nama petugas",
      value: isCustomOfficer ? '__CUSTOM__' : officerOptions.includes(officerName) ? officerName : officerName ? '__CUSTOM__' : '',
      onChange: event => handleOfficerSelect(event.target.value),
      disabled: busy,
      className: `${field} py-2.5 font-medium`
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Pilih Nama Petugas ", datasetLabel, " --"), officerOptions.map(name => /*#__PURE__*/React.createElement("option", {
      key: name,
      value: name
    }, name)), /*#__PURE__*/React.createElement("option", {
      value: "__CUSTOM__"
    }, "+ Ketik Nama Lainnya...")), (isCustomOfficer || officerName && !officerOptions.includes(officerName)) && /*#__PURE__*/React.createElement("input", {
      type: "text",
      placeholder: "Ketik nama lengkap petugas...",
      value: officerName,
      onChange: event => {
        const val = event.target.value;
        setOfficerName(val);
        try {
          sessionStorage.setItem(`last_officer_${dataset}`, val);
          sessionStorage.setItem('last_officer_general', val);
        } catch (_) {}
      },
      disabled: busy,
      maxLength: 120,
      className: `${field} py-2 mt-1`
    }), !cleanOfficer && /*#__PURE__*/React.createElement("p", {
      className: "text-[11px] text-amber-800 font-semibold flex items-center bg-amber-50/80 p-2 rounded-xl border border-amber-200"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-circle-exclamation mr-1.5 text-amber-600"
    }), "Silakan pilih nama petugas di atas sebelum mengambil foto.")), error && /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "p-3 bg-rose-50 text-rose-700 rounded-xl text-xs"
    }, error), !capture ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "relative aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center"
    }, /*#__PURE__*/React.createElement("video", {
      ref: video,
      playsInline: true,
      muted: true,
      className: `w-full h-full object-cover ${ready ? '' : 'hidden'}`
    }), !ready && /*#__PURE__*/React.createElement("p", {
      className: "text-white text-xs"
    }, error || 'Menghubungkan ke kamera...'), /*#__PURE__*/React.createElement("div", {
      className: "absolute top-3 left-3 bg-slate-950/70 text-white text-[11px] px-3 py-1.5 rounded-xl font-mono"
    }, locationBusy ? 'Mencari GPS...' : location ? `GPS ±${Math.round(location.accuracy)} m` : 'GPS belum terkunci')), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-2 justify-between items-center"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setFacing(current => current === 'environment' ? 'user' : 'environment'),
      disabled: busy,
      className: `${button} bg-slate-100`
    }, "Ganti Kamera"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: takePhoto,
      disabled: busy || !ready || !cleanOfficer || !isPhotoAllowed,
      className: `${button} bg-emerald-600 text-white flex items-center shadow-md`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-camera mr-2"
    }), "Ambil Foto Bukti"))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "rounded-2xl overflow-hidden border border-slate-200 bg-slate-950"
    }, /*#__PURE__*/React.createElement("img", {
      src: preview,
      alt: "Pratinjau foto tindak lanjut",
      className: "w-full max-h-[50vh] object-contain"
    })), !capture.mapIncluded && /*#__PURE__*/React.createElement("div", {
      className: "p-3 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs flex justify-between items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", null, "Peta belum termuat. Koordinat GPS tetap tercatat."), /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: busy,
      onClick: retryMap,
      className: `${button} bg-white border border-amber-300 text-amber-900`
    }, "Muat Ulang Peta")), /*#__PURE__*/React.createElement("div", {
      className: "p-3 bg-emerald-50 text-emerald-950 border border-emerald-200 rounded-xl text-xs space-y-1"
    }, /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Petugas:"), " ", officerName || '—'), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Kategori:"), " ", datasetLabel)), /*#__PURE__*/React.createElement("label", {
      className: "block text-xs font-bold text-slate-700"
    }, "Hasil Kunjungan / Catatan Tindak Lanjut *", /*#__PURE__*/React.createElement("textarea", {
      value: notes,
      onChange: event => setNotes(event.target.value),
      maxLength: 2000,
      rows: 3,
      placeholder: "Contoh: Bertemu debitur langsung di lokasi, janji bayar...",
      className: `${field} mt-1`
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-2 justify-end"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: busy,
      onClick: () => {
        raw.current = null;
        setCapture(null);
        setError('');
      },
      className: `${button} bg-slate-100`
    }, "Foto Ulang"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: busy || !cleanNotes || !cleanOfficer || !isPhotoAllowed,
      onClick: save,
      className: `${button} bg-emerald-600 text-white`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-cloud-arrow-up mr-2"
    }), busy ? 'Menyimpan Bukti...' : 'Simpan Tindak Lanjut')))));
  }
  function FollowupListDialog({
    rows,
    branch,
    dataset,
    currentUser,
    onClose,
    showToast
  }) {
    const [search, setSearch] = useState(''),
      [selected, setSelected] = useState(null),
      [history, setHistory] = useState([]),
      [historyError, setHistoryError] = useState('');
    const [lockedModalOpen, setLockedModalOpen] = useState(false);
    useEffect(() => {
      let active = true;
      const DB = getDB();
      if (DB && typeof DB.listFollowups === 'function') {
        DB.listFollowups().then(result => {
          if (active) setHistory(Array.isArray(result) ? result : []);
        }).catch(error => {
          if (active) setHistoryError(error.message);
        });
      }
      return () => {
        active = false;
      };
    }, []);
    const core = getCore();
    const isPhotoAllowed = core && typeof core.isPhotoAccessAllowed === 'function' ? core.isPhotoAccessAllowed() : (() => {
      const hour = new Date().getHours();
      return hour >= 6 && hour < 18;
    })();
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const customerFn = core && typeof core.customer === 'function' ? core.customer : row => ({
      sourceId: row?._id || null,
      cif: String(row?.CIF || row?.cif || ''),
      creditNo: String(row?.NO_KONTRAK || row?.NoKredit || '—'),
      name: String(row?.CUSTOMER_NM || row?.Nama || 'Nasabah'),
      branch: String(row?.CABANG || row?.Cabang || '')
    });
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
      return history.filter(item => {
        if (!item) return false;
        if (String(item.branch || '').toLowerCase() !== b) return false;
        if (String(item.credit_no || '') !== cn) return false;
        if (ds === 'arrumexp' || ds === 'arrum' || ds.includes('arrum')) return true;
        return String(item.dataset || '').toLowerCase() === ds;
      }).length;
    };
    const datasetLabel = getLabel(dataset);
    const handleAttachPhotoClick = row => {
      if (!isPhotoAllowed) {
        setLockedModalOpen(true);
        return;
      }
      setSelected(row);
    };
    if (selected) return /*#__PURE__*/React.createElement(CameraCapture, {
      record: selected,
      dataset: dataset,
      currentUser: currentUser,
      onBack: () => setSelected(null),
      onSaved: result => {
        setHistory(previous => [result, ...(Array.isArray(previous) ? previous : []).filter(item => item && item.id !== result.id)]);
        setSelected(null);
        showToast?.('Foto tindak lanjut tersimpan dan masuk rekap admin.');
      }
    });
    return /*#__PURE__*/React.createElement(Modal, {
      title: `Tindak Lanjut · ${datasetLabel}`,
      onClose: onClose,
      wide: true
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4"
    }, lockedModalOpen && /*#__PURE__*/React.createElement(Modal, {
      title: "Lampirkan Foto Ditutup",
      onClose: () => setLockedModalOpen(false)
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4 text-center py-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-16 h-16 mx-auto rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-3xl border border-amber-200"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-lock"
    })), /*#__PURE__*/React.createElement("h3", {
      className: "text-base font-black text-slate-900"
    }, "Waktu Pengisian Tindak Lanjut Telah Berakhir"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-600 max-w-md mx-auto leading-relaxed"
    }, "Fitur ", /*#__PURE__*/React.createElement("strong", null, "Lampirkan Foto"), " saat mau tindak lanjut untuk kategori ", /*#__PURE__*/React.createElement("strong", null, datasetLabel), " tidak dapat dilakukan melewati jam 18.00 WIB."), /*#__PURE__*/React.createElement("div", {
      className: "p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-semibold text-amber-900 inline-flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-clock text-amber-600"
    }), "Jam Operasional Lampirkan Foto: ", /*#__PURE__*/React.createElement("strong", null, "06.00 \u2013 18.00 WIB")), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 max-w-md mx-auto"
    }, "Akses untuk melampirkan foto tindak lanjut akan kembali dibuka besok pagi pada pukul ", /*#__PURE__*/React.createElement("strong", null, "06.00 WIB"), ". Rekap tindak lanjut tetap dapat dilihat kapan pun."), /*#__PURE__*/React.createElement("div", {
      className: "pt-2 flex justify-center"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setLockedModalOpen(false),
      className: `${button} bg-slate-900 text-white px-6`
    }, "Saya Mengerti")))), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-3 justify-between items-center"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-bold text-emerald-800"
    }, branch, " ", /*#__PURE__*/React.createElement("span", {
      className: "font-normal text-slate-500"
    }, "\xB7 ", safeRows.length, " nasabah")), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 mt-0.5"
    }, "Kategori: ", /*#__PURE__*/React.createElement("strong", {
      className: "text-slate-800"
    }, datasetLabel))), /*#__PURE__*/React.createElement("input", {
      "aria-label": "Cari nasabah tindak lanjut",
      className: `${field} sm:max-w-sm`,
      placeholder: "Cari CIF, no kredit, atau nama nasabah",
      value: search,
      onChange: event => setSearch(event.target.value)
    })), !isPhotoAllowed && /*#__PURE__*/React.createElement("div", {
      className: "p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 text-sm border border-amber-200"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-clock"
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex-1"
    }, /*#__PURE__*/React.createElement("p", {
      className: "font-bold text-amber-950 flex items-center gap-1.5"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-lock text-amber-600"
    }), "Lampirkan Foto Ditutup (Melewati Jam 18.00 WIB)"), /*#__PURE__*/React.createElement("p", {
      className: "mt-0.5 text-amber-800 leading-relaxed"
    }, "Sesuai ketentuan, pengambilan dan lampiran foto saat mau tindak lanjut untuk kategori ", /*#__PURE__*/React.createElement("strong", null, datasetLabel), " tidak dapat dilakukan melewati jam 18.00 WIB dan kembali bisa dibuka pukul 06.00 WIB pagi."))), historyError && /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "text-xs text-amber-800 bg-amber-50 p-3 rounded-xl"
    }, "Riwayat belum dapat dimuat: ", historyError), /*#__PURE__*/React.createElement("div", {
      className: "overflow-x-auto border border-slate-200 rounded-2xl max-h-[56vh]"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-left text-xs"
    }, /*#__PURE__*/React.createElement("thead", {
      className: "bg-slate-50 text-slate-500 sticky top-0"
    }, /*#__PURE__*/React.createElement("tr", null, ['CIF', 'No Kredit', 'Nama Nasabah', 'Foto Tindak Lanjut'].map(label => /*#__PURE__*/React.createElement("th", {
      className: "p-3 whitespace-nowrap",
      key: label
    }, label)))), /*#__PURE__*/React.createElement("tbody", {
      className: "divide-y divide-slate-100"
    }, visible.map((row, index) => /*#__PURE__*/React.createElement("tr", {
      key: `${row.sourceId || row.creditNo}:${index}`
    }, /*#__PURE__*/React.createElement("td", {
      className: "p-3 font-mono whitespace-nowrap"
    }, row.cif || '—'), /*#__PURE__*/React.createElement("td", {
      className: "p-3 font-mono whitespace-nowrap"
    }, row.creditNo), /*#__PURE__*/React.createElement("td", {
      className: "p-3 font-bold text-slate-800"
    }, row.name), /*#__PURE__*/React.createElement("td", {
      className: "p-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-2 items-center"
    }, isPhotoAllowed ? /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => handleAttachPhotoClick(row),
      className: `${button} bg-emerald-600 text-white whitespace-nowrap`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-camera mr-2"
    }), "Lampirkan Foto") : /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => handleAttachPhotoClick(row),
      className: `${button} bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 whitespace-nowrap`,
      title: "Lampirkan foto ditutup melewati jam 18.00 WIB (Buka 06.00 WIB)"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-lock mr-2 text-amber-600"
    }), "Lampirkan Foto (Terkunci)"), saved(row) > 0 && /*#__PURE__*/React.createElement("span", {
      className: "text-emerald-700 font-bold"
    }, saved(row), " foto tersimpan"))))), !visible.length && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: 4,
      className: "p-8 text-center text-slate-500"
    }, "Tidak ada nasabah sesuai pencarian."))))), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-400"
    }, "Setiap kunjungan dapat memiliki foto baru. Daftar ini mengikuti cabang yang dipilih.")));
  }
  function PhotoDialog({
    item,
    onClose
  }) {
    const [url, setUrl] = useState(''),
      [error, setError] = useState(''),
      [loading, setLoading] = useState(true);
    const core = getCore();
    useEffect(() => {
      let active = true;
      const DB = getDB();
      setLoading(true);
      setError('');
      setUrl('');
      if (item?.photo_url || item?.photo_data || item?.preview) {
        setUrl(item.photo_url || item.photo_data || item.preview);
        setLoading(false);
        return () => {
          active = false;
        };
      }
      if (DB && typeof DB.followupPhotoUrl === 'function' && item?.photo_path) {
        DB.followupPhotoUrl(item.photo_path).then(value => {
          if (active) {
            setUrl(value);
            setLoading(false);
          }
        }).catch(err => {
          if (active) {
            setError(err.message || 'Gagal memuat foto.');
            setLoading(false);
          }
        });
      } else {
        setError(item?.photo_path ? 'Koneksi database belum siap.' : 'Foto bukti tidak ditemukan.');
        setLoading(false);
      }
      return () => {
        active = false;
      };
    }, [item?.id, item?.photo_path]);
    return /*#__PURE__*/React.createElement(Modal, {
      title: `Bukti Foto · ${item?.customer_name || 'Nasabah'}`,
      onClose: onClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 shadow-sm flex items-center justify-center min-h-[240px] max-h-[60vh]"
    }, loading && /*#__PURE__*/React.createElement("div", {
      className: "p-8 flex flex-col items-center justify-center text-slate-300"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-circle-notch fa-spin text-3xl text-emerald-400 mb-3"
    }), /*#__PURE__*/React.createElement("p", {
      className: "text-xs font-semibold"
    }, "Memuat gambar bukti foto...")), error && /*#__PURE__*/React.createElement("div", {
      className: "p-6 text-center text-rose-300"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-triangle-exclamation text-2xl mb-2"
    }), /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "text-xs"
    }, error)), url && !loading && /*#__PURE__*/React.createElement("img", {
      src: url,
      alt: `Bukti Foto ${item?.customer_name || ''}`,
      className: "w-full h-auto max-h-[60vh] object-contain rounded-2xl",
      onError: () => setError('Gambar bukti foto tidak dapat ditampilkan atau link telah kedaluwarsa.')
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      className: "text-sm font-bold text-slate-900"
    }, core?.formatTime ? core.formatTime(item.captured_at) : item.captured_at), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-600 mt-0.5"
    }, "Petugas: ", /*#__PURE__*/React.createElement("span", {
      className: "font-semibold text-slate-800"
    }, core?.officerName ? core.officerName(item) : item.officer_name || item.actor_name))), url && !error && /*#__PURE__*/React.createElement("a", {
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      className: "inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition",
      title: "Buka foto dalam ukuran penuh di tab baru"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-arrow-up-right-from-square"
    }), " Ukuran Penuh")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-3 rounded-2xl border border-slate-100"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400"
    }, "Akun Pengunggah:"), " ", /*#__PURE__*/React.createElement("span", {
      className: "font-semibold"
    }, item?.actor_name)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400"
    }, "Cabang / Unit:"), " ", /*#__PURE__*/React.createElement("span", {
      className: "font-semibold"
    }, item?.branch)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400"
    }, "No. Rekening / Kredit:"), " ", /*#__PURE__*/React.createElement("span", {
      className: "font-mono font-bold text-slate-800"
    }, item?.credit_no)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400"
    }, "Kategori:"), " ", /*#__PURE__*/React.createElement("span", {
      className: "font-bold text-emerald-700"
    }, getLabel(item?.dataset)))), hasValidCoords(item?.latitude, item?.longitude) ? /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center gap-2 pt-1"
    }, /*#__PURE__*/React.createElement("a", {
      href: getGoogleMapsUrl(item.latitude, item.longitude),
      target: "_blank",
      rel: "noopener noreferrer",
      className: "inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition",
      title: "Buka titik koordinat di Google Maps"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-map-location-dot"
    }), " Buka Google Maps \xB7 \xB1", Math.round(item?.accuracy_m || 0), " m"), core?.mapUrl && /*#__PURE__*/React.createElement("a", {
      href: core.mapUrl(item.latitude, item.longitude),
      target: "_blank",
      rel: "noopener noreferrer",
      className: "text-xs text-slate-500 hover:text-slate-700 underline ml-1",
      title: "Buka titik koordinat di OpenStreetMap"
    }, "OpenStreetMap")) : /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-400 italic"
    }, "Koordinat lokasi tidak tersedia"), item?.notes && /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-600 whitespace-pre-wrap"
    }, item.notes)));
  }
  function FollowupAdminView({
    currentUser,
    showToast,
    arrumExpData
  }) {
    const [rows, setRows] = useState([]),
      [loading, setLoading] = useState(true),
      [error, setError] = useState(''),
      [photo, setPhoto] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null),
      [deleting, setDeleting] = useState(false),
      [deleteError, setDeleteError] = useState('');
    const [filters, setFilters] = useState({
      branch: '',
      dataset: '',
      officer: '',
      start: '',
      end: '',
      search: ''
    });
    const [pdfProgress, setPdfProgress] = useState(null),
      [pdfError, setPdfError] = useState('');
    const [notifyScope, setNotifyScope] = useState('today');
    const [isNotifyOpen, setIsNotifyOpen] = useState(true);
    const [copiedCategory, setCopiedCategory] = useState('');
    const pdfController = useRef(null);
    const generation = useRef(0),
      mounted = useRef(true);
    const core = getCore();
    const arrumCreditNos = useMemo(() => {
      const list = arrumExpData || typeof window !== 'undefined' && window.arrumCreditNos || [];
      if (list instanceof Set) return list;
      return new Set((Array.isArray(list) ? list : []).map(r => String(r?.NO_KONTRAK || r?.NoKredit || r?.credit_no || '').trim()).filter(Boolean));
    }, [arrumExpData]);
    const isRowArrumExp = r => {
      if (!r) return false;
      const ds = String(r.dataset || '').toLowerCase();
      if (ds === 'arrumexp' || ds === 'arrum' || ds.includes('arrum')) return true;
      if (arrumCreditNos.has(String(r.credit_no || '').trim())) return true;
      if (/ARRUM\s*EXPR?ES\s*LOAN/i.test(r.notes || '') || /ARRUM\s*EXPR?ES\s*LOAN/i.test(r.product || '')) return true;
      return false;
    };
    const load = async () => {
      const current = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const DB = getDB();
        if (!DB || typeof DB.listFollowups !== 'function') throw new Error('Koneksi database belum siap.');
        const result = await DB.listFollowups();
        if (mounted.current && current === generation.current) setRows(Array.isArray(result) ? result : []);
      } catch (error) {
        if (mounted.current && current === generation.current) setError(error.message);
      } finally {
        if (mounted.current && current === generation.current) setLoading(false);
      }
    };
    useEffect(() => {
      mounted.current = true;
      load();
      return () => {
        mounted.current = false;
        generation.current++;
        pdfController.current?.abort();
      };
    }, []);
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const visible = useMemo(() => {
      const activeFilters = {
        ...filters,
        arrumCreditNos
      };
      return core && typeof core.filterRecap === 'function' ? core.filterRecap(safeRows, activeFilters) : safeRows;
    }, [safeRows, filters, arrumCreditNos]);
    const branches = [...new Set(safeRows.map(row => row.branch).filter(Boolean))].sort();
    const officersList = useMemo(() => [...new Set(safeRows.map(r => core && typeof core.officerName === 'function' ? core.officerName(r) : r?.officer_name || r?.actor_name || '').filter(Boolean))].sort(), [safeRows]);
    const countKol1 = useMemo(() => safeRows.filter(r => r && r.dataset === 'kol1').length, [safeRows]);
    const countLar = useMemo(() => safeRows.filter(r => r && r.dataset === 'lar').length, [safeRows]);
    const countNpl = useMemo(() => safeRows.filter(r => r && r.dataset === 'npl').length, [safeRows]);
    const countArrumExp = useMemo(() => safeRows.filter(isRowArrumExp).length, [safeRows, arrumCreditNos]);
    const todayDay = core?.localDay ? core.localDay(new Date()) : new Date().toISOString().slice(0, 10);
    const pendingData = useMemo(() => {
      if (!core || typeof core.getPendingOfficers !== 'function') return null;
      return core.getPendingOfficers(safeRows, {
        scope: notifyScope,
        date: todayDay,
        start: filters.start,
        end: filters.end,
        arrumCreditNos
      });
    }, [core, safeRows, notifyScope, todayDay, filters.start, filters.end, arrumCreditNos]);
    const getScopeLabel = () => {
      if (notifyScope === 'today') return `Hari Ini (${todayDay})`;
      if (notifyScope === 'filtered') {
        if (filters.start && filters.end) return `${filters.start} s/d ${filters.end}`;
        if (filters.start) return `Mulai ${filters.start}`;
        if (filters.end) return `Sampai ${filters.end}`;
        return 'Sesuai Filter';
      }
      return 'Seluruh Riwayat';
    };
    const copyCategoryList = (catKey, catTitle, officers) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return;
      const count = officers.length;
      const scopeLabel = getScopeLabel();
      let text = `📢 *NOTIFIKASI PETUGAS BELUM ISI TINDAK LANJUT*\n`;
      text += `📂 Kategori: *${catTitle}*\n`;
      text += `📅 Periode: ${scopeLabel}\n`;
      text += `⚠️ Jumlah Belum Mengisi: *${count} Petugas*\n\n`;
      if (count > 0) {
        text += `*Daftar Nama Petugas:*\n`;
        officers.forEach((name, idx) => {
          text += `${idx + 1}. ${name}\n`;
        });
        text += `\nMohon rekan-rekan petugas di atas untuk segera mengisi tindak lanjut. Terima kasih. 🙏`;
      } else {
        text += `✅ *Alhamdulillah, seluruh petugas pada kategori ${catTitle} sudah mengisi tindak lanjut.*`;
      }
      navigator.clipboard.writeText(text).then(() => {
        setCopiedCategory(catKey);
        showToast?.(`Daftar petugas ${catTitle} disalin ke clipboard!`);
        setTimeout(() => setCopiedCategory(''), 2500);
      }).catch(() => {
        showToast?.('Gagal menyalin ke clipboard.');
      });
    };
    const copyAllCategoriesSummary = () => {
      if (typeof navigator === 'undefined' || !navigator.clipboard || !pendingData) return;
      const scopeLabel = getScopeLabel();
      const catConfigs = [{
        key: 'kol1',
        title: 'KOL 1 (1–10 Hari)',
        icon: '🔴'
      }, {
        key: 'lar',
        title: 'LAR (11–30 Hari)',
        icon: '🟠'
      }, {
        key: 'npl',
        title: 'NPL (KOL 3–5)',
        icon: '🔴'
      }, {
        key: 'arrumExp',
        title: 'ARRUM EXPRES LOAN',
        icon: '⚡'
      }];
      let text = `📢 *REKAP NOTIFIKASI PETUGAS BELUM ISI TINDAK LANJUT*\n`;
      text += `📅 Periode: ${scopeLabel}\n`;
      text += `📊 Total Belum Mengisi: *${pendingData.totalPending} dari ${pendingData.totalOfficers} Petugas*\n`;
      text += `──────────────────────\n\n`;
      catConfigs.forEach(({
        key,
        title,
        icon
      }) => {
        const catData = pendingData.byCategory[key] || {
          pendingOfficers: [],
          pendingCount: 0,
          totalOfficers: 0
        };
        text += `${icon} *${title}* (${catData.pendingCount} Belum / ${catData.totalOfficers} Petugas)\n`;
        if (catData.pendingCount > 0) {
          catData.pendingOfficers.forEach((name, idx) => {
            text += `   ${idx + 1}. ${name}\n`;
          });
        } else {
          text += `   ✅ Lengkap (Semua sudah isi)\n`;
        }
        text += `\n`;
      });
      text += `Mohon kerja sama rekan-rekan untuk segera menyelesaikan input tindak lanjut hari ini. Terima kasih. 🙏`;
      navigator.clipboard.writeText(text).then(() => {
        setCopiedCategory('all');
        showToast?.('Rekap notifikasi seluruh kategori disalin ke clipboard!');
        setTimeout(() => setCopiedCategory(''), 2500);
      }).catch(() => {
        showToast?.('Gagal menyalin ke clipboard.');
      });
    };
    const change = (name, value) => setFilters(previous => ({
      ...previous,
      [name]: value
    }));
    const remove = async () => {
      setDeleting(true);
      setDeleteError('');
      try {
        const DB = getDB();
        if (!DB || typeof DB.deleteFollowup !== 'function') throw new Error('Koneksi database belum siap.');
        await DB.deleteFollowup(deleteTarget.id);
        generation.current++;
        if (mounted.current) {
          setRows(previous => previous.filter(row => row && row.id !== deleteTarget.id));
          setLoading(false);
          setDeleteTarget(null);
          showToast?.('Tindak lanjut berhasil dihapus dari rekap.');
        }
      } catch (error) {
        if (mounted.current) setDeleteError(error.message);
      } finally {
        if (mounted.current) setDeleting(false);
      }
    };
    const exportCsv = () => {
      if (!core || typeof core.recapCsv !== 'function') return;
      const url = URL.createObjectURL(new Blob([core.recapCsv(visible)], {
        type: 'text/csv;charset=utf-8;'
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Rekap_Tindak_Lanjut_${core.localDay(new Date())}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const exportPdf = async () => {
      if (!window.FollowupPdf || typeof window.FollowupPdf.exportReport !== 'function') return;
      const controller = new AbortController();
      pdfController.current = controller;
      setPdfError('');
      setPdfProgress({
        completed: 0,
        total: visible.length
      });
      try {
        const DB = getDB();
        await window.FollowupPdf.exportReport({
          rows: [...visible],
          filters: {
            ...filters,
            arrumCreditNos
          },
          getPhotoUrl: DB && typeof DB.followupPhotoUrl === 'function' ? DB.followupPhotoUrl : async () => '',
          signal: controller.signal,
          onProgress: progress => {
            if (mounted.current) setPdfProgress(progress);
          }
        });
        if (mounted.current) showToast?.('Rekap PDF selesai dibuat. Unduhan dimulai.');
      } catch (error) {
        if (mounted.current && error.name !== 'AbortError') setPdfError(error.message);
      } finally {
        if (mounted.current) setPdfProgress(null);
        pdfController.current = null;
      }
    };
    if (currentUser?.role !== 'admin') return null;
    return /*#__PURE__*/React.createElement("div", {
      className: "space-y-5"
    }, photo && /*#__PURE__*/React.createElement(PhotoDialog, {
      item: photo,
      onClose: () => setPhoto(null)
    }), deleteTarget && /*#__PURE__*/React.createElement(Modal, {
      title: "Hapus Tindak Lanjut",
      busy: deleting,
      onClose: () => setDeleteTarget(null)
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-600"
    }, "Hapus bukti tindak lanjut berikut dari rekap?"), /*#__PURE__*/React.createElement("div", {
      className: "p-4 rounded-2xl bg-slate-50 text-sm text-slate-800 space-y-1"
    }, /*#__PURE__*/React.createElement("p", {
      className: "font-bold"
    }, deleteTarget.customer_name), /*#__PURE__*/React.createElement("p", {
      className: "font-mono"
    }, "CIF: ", deleteTarget.cif, " \xB7 No Kredit: ", deleteTarget.credit_no), /*#__PURE__*/React.createElement("p", null, deleteTarget.branch, " \xB7 ", getLabel(deleteTarget.dataset)), /*#__PURE__*/React.createElement("p", null, core?.formatTime ? core.formatTime(deleteTarget.captured_at) : deleteTarget.captured_at, " \xB7 ", core?.officerName ? core.officerName(deleteTarget) : deleteTarget.officer_name || deleteTarget.actor_name)), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500"
    }, "Bukti tidak tampil lagi di rekap dan foto tidak dapat dibuka kembali dari aplikasi. Arsip tetap disimpan di database. Data kredit nasabah tetap tersedia."), deleteError && /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "p-3 bg-rose-50 text-rose-700 rounded-xl text-sm"
    }, "Bukti belum dihapus: ", deleteError), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end gap-2"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: deleting,
      onClick: () => setDeleteTarget(null),
      className: `${button} bg-slate-100`
    }, "Batal"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: deleting,
      onClick: remove,
      className: `${button} bg-rose-600 text-white`
    }, deleting ? 'Menghapus...' : 'Ya, Hapus')))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white border border-slate-200 p-5 rounded-3xl flex flex-wrap justify-between gap-4 items-center"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      className: "text-xl font-black text-slate-900"
    }, "Rekap Tindak Lanjut"), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 mt-1"
    }, "Bukti kunjungan KOL 1, LAR, NPL, dan Arrum Exspres Loan dari seluruh petugas.")), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-2"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: loading || !!pdfProgress,
      onClick: load,
      className: `${button} bg-slate-100`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-rotate mr-2"
    }), "Muat Ulang"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: loading || !visible.length || !!error || !!pdfProgress,
      onClick: exportCsv,
      className: `${button} bg-emerald-600 text-white`
    }, "Unduh Rekap CSV"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      disabled: loading || !visible.length || !!error || !!pdfProgress,
      onClick: exportPdf,
      className: `${button} bg-slate-900 text-white`
    }, pdfProgress ? `Menyiapkan Foto ${pdfProgress.completed}/${pdfProgress.total}` : 'Cetak PDF'), pdfProgress && /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => pdfController.current?.abort(),
      className: `${button} bg-rose-50 text-rose-700`
    }, "Batalkan PDF"))), pdfError && /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "bg-rose-50 text-rose-700 p-4 rounded-2xl text-sm"
    }, "PDF belum dibuat: ", pdfError), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 sm:grid-cols-3 gap-3"
    }, [['Bukti Foto', visible.length], ['Nasabah Ditindaklanjuti', new Set(visible.map(row => `${row.branch}|${row.credit_no}`)).size], ['Petugas', new Set(visible.map(r => core?.officerIdentity ? core.officerIdentity(r) : r?.officer_name || r?.actor_name || '')).size]].map(([label, value]) => /*#__PURE__*/React.createElement("div", {
      key: label,
      className: "bg-white border border-slate-200 rounded-2xl p-4"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-xs font-bold text-slate-500"
    }, label), /*#__PURE__*/React.createElement("p", {
      className: "text-2xl font-black text-emerald-700 mt-2"
    }, value)))), pendingData && /*#__PURE__*/React.createElement("div", {
      className: "bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center justify-between gap-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: `w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${pendingData.totalPending > 0 ? 'bg-rose-100 text-rose-600 border border-rose-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${pendingData.totalPending > 0 ? 'fa-bell' : 'fa-check-double'}`
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2 flex-wrap"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "text-base font-black text-slate-900"
    }, "Notifikasi Petugas Belum Tindak Lanjut"), /*#__PURE__*/React.createElement("span", {
      className: `px-2.5 py-0.5 rounded-full text-xs font-black ${pendingData.totalPending > 0 ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`
    }, pendingData.totalPending > 0 ? `${pendingData.totalPending} Petugas Belum Isi` : 'Semua Petugas Selesai')), /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 mt-0.5"
    }, "Daftar nama petugas yang belum mengisi tindak lanjut per kategori (", getScopeLabel(), ")."))), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center gap-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setNotifyScope('today'),
      className: `px-3 py-1 rounded-lg font-bold transition ${notifyScope === 'today' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`
    }, "Hari Ini"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setNotifyScope('filtered'),
      className: `px-3 py-1 rounded-lg font-bold transition ${notifyScope === 'filtered' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`
    }, "Sesuai Filter"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setNotifyScope('all'),
      className: `px-3 py-1 rounded-lg font-bold transition ${notifyScope === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`
    }, "Semua")), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: copyAllCategoriesSummary,
      className: `${button} bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5`,
      title: "Salin rekap notifikasi seluruh kategori untuk dibagikan ke WhatsApp"
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${copiedCategory === 'all' ? 'fa-check' : 'fa-copy'}`
    }), /*#__PURE__*/React.createElement("span", null, copiedCategory === 'all' ? 'Tersalin!' : 'Salin Rekap Semua')), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setIsNotifyOpen(v => !v),
      className: "p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition",
      title: isNotifyOpen ? 'Ciutkan notifikasi' : 'Buka notifikasi'
    }, /*#__PURE__*/React.createElement("i", {
      className: `fas ${isNotifyOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`
    })))), isNotifyOpen && /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 pt-1"
    }, (() => {
      const catKey = 'kol1';
      const catTitle = 'KOL 1 (1–10 Hari)';
      const data = pendingData.byCategory[catKey] || {
        pendingOfficers: [],
        pendingCount: 0,
        completedCount: 0,
        totalOfficers: 0
      };
      const percent = data.totalOfficers > 0 ? Math.round(data.completedCount / data.totalOfficers * 100) : 0;
      return /*#__PURE__*/React.createElement("div", {
        className: "bg-amber-50/50 border border-amber-200/80 rounded-2xl p-4 flex flex-col justify-between"
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center justify-between gap-2 pb-2 border-b border-amber-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-7 h-7 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center text-xs"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-triangle-exclamation"
      })), /*#__PURE__*/React.createElement("span", {
        className: "font-bold text-xs text-amber-950"
      }, "KOL 1 (1\u201310 Hari)")), /*#__PURE__*/React.createElement("span", {
        className: `px-2 py-0.5 rounded-full text-[11px] font-black ${data.pendingCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-800'}`
      }, data.pendingCount > 0 ? `${data.pendingCount} Belum` : 'Lengkap')), /*#__PURE__*/React.createElement("div", {
        className: "mt-2.5 mb-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex justify-between text-[11px] font-semibold text-slate-600 mb-1"
      }, /*#__PURE__*/React.createElement("span", null, "Progres Pengisian"), /*#__PURE__*/React.createElement("span", null, data.completedCount, "/", data.totalOfficers, " (", percent, "%)")), /*#__PURE__*/React.createElement("div", {
        className: "w-full bg-amber-100/60 rounded-full h-1.5 overflow-hidden"
      }, /*#__PURE__*/React.createElement("div", {
        className: "bg-amber-600 h-1.5 rounded-full transition-all duration-300",
        style: {
          width: `${percent}%`
        }
      }))), /*#__PURE__*/React.createElement("div", {
        className: "mt-3"
      }, /*#__PURE__*/React.createElement("p", {
        className: "text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5"
      }, data.pendingCount > 0 ? 'Daftar Petugas Belum Isi:' : 'Status Petugas:'), data.pendingCount > 0 ? /*#__PURE__*/React.createElement("div", {
        className: "max-h-36 overflow-y-auto pr-1 space-y-1"
      }, data.pendingOfficers.map((name, i) => /*#__PURE__*/React.createElement("div", {
        key: name,
        className: "flex items-center gap-1.5 p-1.5 bg-white/80 rounded-lg text-xs font-semibold text-slate-800 border border-amber-100/80"
      }, /*#__PURE__*/React.createElement("span", {
        className: "w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] flex items-center justify-center font-bold flex-shrink-0"
      }, i + 1), /*#__PURE__*/React.createElement("span", {
        className: "truncate"
      }, name)))) : /*#__PURE__*/React.createElement("div", {
        className: "p-3 bg-emerald-50 rounded-xl text-xs font-semibold text-emerald-800 text-center border border-emerald-100"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-check-circle text-emerald-600 mr-1.5"
      }), "Semua petugas KOL 1 sudah mengisi (", data.totalOfficers, " orang)."))), /*#__PURE__*/React.createElement("button", {
        type: "button",
        onClick: () => copyCategoryList(catKey, catTitle, data.pendingOfficers),
        className: "mt-3 w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
      }, /*#__PURE__*/React.createElement("i", {
        className: `fas ${copiedCategory === catKey ? 'fa-check' : 'fa-copy'}`
      }), /*#__PURE__*/React.createElement("span", null, copiedCategory === catKey ? 'Tersalin!' : 'Salin Daftar KOL 1')));
    })(), (() => {
      const catKey = 'lar';
      const catTitle = 'LAR (11–30 Hari)';
      const data = pendingData.byCategory[catKey] || {
        pendingOfficers: [],
        pendingCount: 0,
        completedCount: 0,
        totalOfficers: 0
      };
      const percent = data.totalOfficers > 0 ? Math.round(data.completedCount / data.totalOfficers * 100) : 0;
      return /*#__PURE__*/React.createElement("div", {
        className: "bg-orange-50/50 border border-orange-200/80 rounded-2xl p-4 flex flex-col justify-between"
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center justify-between gap-2 pb-2 border-b border-orange-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-7 h-7 rounded-lg bg-orange-500/10 text-orange-700 flex items-center justify-center text-xs"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-clock-rotate-left"
      })), /*#__PURE__*/React.createElement("span", {
        className: "font-bold text-xs text-orange-950"
      }, "LAR (11\u201330 Hari)")), /*#__PURE__*/React.createElement("span", {
        className: `px-2 py-0.5 rounded-full text-[11px] font-black ${data.pendingCount > 0 ? 'bg-orange-100 text-orange-900 border border-orange-200' : 'bg-emerald-100 text-emerald-800'}`
      }, data.pendingCount > 0 ? `${data.pendingCount} Belum` : 'Lengkap')), /*#__PURE__*/React.createElement("div", {
        className: "mt-2.5 mb-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex justify-between text-[11px] font-semibold text-slate-600 mb-1"
      }, /*#__PURE__*/React.createElement("span", null, "Progres Pengisian"), /*#__PURE__*/React.createElement("span", null, data.completedCount, "/", data.totalOfficers, " (", percent, "%)")), /*#__PURE__*/React.createElement("div", {
        className: "w-full bg-orange-100/60 rounded-full h-1.5 overflow-hidden"
      }, /*#__PURE__*/React.createElement("div", {
        className: "bg-orange-600 h-1.5 rounded-full transition-all duration-300",
        style: {
          width: `${percent}%`
        }
      }))), /*#__PURE__*/React.createElement("div", {
        className: "mt-3"
      }, /*#__PURE__*/React.createElement("p", {
        className: "text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5"
      }, data.pendingCount > 0 ? 'Daftar Petugas Belum Isi:' : 'Status Petugas:'), data.pendingCount > 0 ? /*#__PURE__*/React.createElement("div", {
        className: "max-h-36 overflow-y-auto pr-1 space-y-1"
      }, data.pendingOfficers.map((name, i) => /*#__PURE__*/React.createElement("div", {
        key: name,
        className: "flex items-center gap-1.5 p-1.5 bg-white/80 rounded-lg text-xs font-semibold text-slate-800 border border-orange-100/80"
      }, /*#__PURE__*/React.createElement("span", {
        className: "w-4 h-4 rounded-full bg-orange-100 text-orange-700 text-[10px] flex items-center justify-center font-bold flex-shrink-0"
      }, i + 1), /*#__PURE__*/React.createElement("span", {
        className: "truncate"
      }, name)))) : /*#__PURE__*/React.createElement("div", {
        className: "p-3 bg-emerald-50 rounded-xl text-xs font-semibold text-emerald-800 text-center border border-emerald-100"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-check-circle text-emerald-600 mr-1.5"
      }), "Semua petugas LAR sudah mengisi (", data.totalOfficers, " orang)."))), /*#__PURE__*/React.createElement("button", {
        type: "button",
        onClick: () => copyCategoryList(catKey, catTitle, data.pendingOfficers),
        className: "mt-3 w-full py-1.5 px-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
      }, /*#__PURE__*/React.createElement("i", {
        className: `fas ${copiedCategory === catKey ? 'fa-check' : 'fa-copy'}`
      }), /*#__PURE__*/React.createElement("span", null, copiedCategory === catKey ? 'Tersalin!' : 'Salin Daftar LAR')));
    })(), (() => {
      const catKey = 'npl';
      const catTitle = 'NPL (KOL 3–5)';
      const data = pendingData.byCategory[catKey] || {
        pendingOfficers: [],
        pendingCount: 0,
        completedCount: 0,
        totalOfficers: 0
      };
      const percent = data.totalOfficers > 0 ? Math.round(data.completedCount / data.totalOfficers * 100) : 0;
      return /*#__PURE__*/React.createElement("div", {
        className: "bg-rose-50/50 border border-rose-200/80 rounded-2xl p-4 flex flex-col justify-between"
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center justify-between gap-2 pb-2 border-b border-rose-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-7 h-7 rounded-lg bg-rose-500/10 text-rose-700 flex items-center justify-center text-xs"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-circle-exclamation"
      })), /*#__PURE__*/React.createElement("span", {
        className: "font-bold text-xs text-rose-950"
      }, "NPL (KOL 3\u20135)")), /*#__PURE__*/React.createElement("span", {
        className: `px-2 py-0.5 rounded-full text-[11px] font-black ${data.pendingCount > 0 ? 'bg-rose-100 text-rose-900 border border-rose-200' : 'bg-emerald-100 text-emerald-800'}`
      }, data.pendingCount > 0 ? `${data.pendingCount} Belum` : 'Lengkap')), /*#__PURE__*/React.createElement("div", {
        className: "mt-2.5 mb-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex justify-between text-[11px] font-semibold text-slate-600 mb-1"
      }, /*#__PURE__*/React.createElement("span", null, "Progres Pengisian"), /*#__PURE__*/React.createElement("span", null, data.completedCount, "/", data.totalOfficers, " (", percent, "%)")), /*#__PURE__*/React.createElement("div", {
        className: "w-full bg-rose-100/60 rounded-full h-1.5 overflow-hidden"
      }, /*#__PURE__*/React.createElement("div", {
        className: "bg-rose-600 h-1.5 rounded-full transition-all duration-300",
        style: {
          width: `${percent}%`
        }
      }))), /*#__PURE__*/React.createElement("div", {
        className: "mt-3"
      }, /*#__PURE__*/React.createElement("p", {
        className: "text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5"
      }, data.pendingCount > 0 ? 'Daftar Petugas Belum Isi:' : 'Status Petugas:'), data.pendingCount > 0 ? /*#__PURE__*/React.createElement("div", {
        className: "max-h-36 overflow-y-auto pr-1 space-y-1"
      }, data.pendingOfficers.map((name, i) => /*#__PURE__*/React.createElement("div", {
        key: name,
        className: "flex items-center gap-1.5 p-1.5 bg-white/80 rounded-lg text-xs font-semibold text-slate-800 border border-rose-100/80"
      }, /*#__PURE__*/React.createElement("span", {
        className: "w-4 h-4 rounded-full bg-rose-100 text-rose-700 text-[10px] flex items-center justify-center font-bold flex-shrink-0"
      }, i + 1), /*#__PURE__*/React.createElement("span", {
        className: "truncate"
      }, name)))) : /*#__PURE__*/React.createElement("div", {
        className: "p-3 bg-emerald-50 rounded-xl text-xs font-semibold text-emerald-800 text-center border border-emerald-100"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-check-circle text-emerald-600 mr-1.5"
      }), "Semua petugas NPL sudah mengisi (", data.totalOfficers, " orang)."))), /*#__PURE__*/React.createElement("button", {
        type: "button",
        onClick: () => copyCategoryList(catKey, catTitle, data.pendingOfficers),
        className: "mt-3 w-full py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
      }, /*#__PURE__*/React.createElement("i", {
        className: `fas ${copiedCategory === catKey ? 'fa-check' : 'fa-copy'}`
      }), /*#__PURE__*/React.createElement("span", null, copiedCategory === catKey ? 'Tersalin!' : 'Salin Daftar NPL')));
    })(), (() => {
      const catKey = 'arrumExp';
      const catTitle = 'Arrum Exspres Loan';
      const data = pendingData.byCategory[catKey] || {
        pendingOfficers: [],
        pendingCount: 0,
        completedCount: 0,
        totalOfficers: 0
      };
      const percent = data.totalOfficers > 0 ? Math.round(data.completedCount / data.totalOfficers * 100) : 0;
      return /*#__PURE__*/React.createElement("div", {
        className: "bg-indigo-50/50 border border-indigo-200/80 rounded-2xl p-4 flex flex-col justify-between"
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center justify-between gap-2 pb-2 border-b border-indigo-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-700 flex items-center justify-center text-xs"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-bolt-lightning"
      })), /*#__PURE__*/React.createElement("span", {
        className: "font-bold text-xs text-indigo-950"
      }, "Arrum Exspres Loan")), /*#__PURE__*/React.createElement("span", {
        className: `px-2 py-0.5 rounded-full text-[11px] font-black ${data.pendingCount > 0 ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' : 'bg-emerald-100 text-emerald-800'}`
      }, data.pendingCount > 0 ? `${data.pendingCount} Belum` : 'Lengkap')), /*#__PURE__*/React.createElement("div", {
        className: "mt-2.5 mb-2"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex justify-between text-[11px] font-semibold text-slate-600 mb-1"
      }, /*#__PURE__*/React.createElement("span", null, "Progres Pengisian"), /*#__PURE__*/React.createElement("span", null, data.completedCount, "/", data.totalOfficers, " (", percent, "%)")), /*#__PURE__*/React.createElement("div", {
        className: "w-full bg-indigo-100/60 rounded-full h-1.5 overflow-hidden"
      }, /*#__PURE__*/React.createElement("div", {
        className: "bg-indigo-600 h-1.5 rounded-full transition-all duration-300",
        style: {
          width: `${percent}%`
        }
      }))), /*#__PURE__*/React.createElement("div", {
        className: "mt-3"
      }, /*#__PURE__*/React.createElement("p", {
        className: "text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5"
      }, data.pendingCount > 0 ? 'Daftar Petugas Belum Isi:' : 'Status Petugas:'), data.pendingCount > 0 ? /*#__PURE__*/React.createElement("div", {
        className: "max-h-36 overflow-y-auto pr-1 space-y-1"
      }, data.pendingOfficers.map((name, i) => /*#__PURE__*/React.createElement("div", {
        key: name,
        className: "flex items-center gap-1.5 p-1.5 bg-white/80 rounded-lg text-xs font-semibold text-slate-800 border border-indigo-100/80"
      }, /*#__PURE__*/React.createElement("span", {
        className: "w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 text-[10px] flex items-center justify-center font-bold flex-shrink-0"
      }, i + 1), /*#__PURE__*/React.createElement("span", {
        className: "truncate"
      }, name)))) : /*#__PURE__*/React.createElement("div", {
        className: "p-3 bg-emerald-50 rounded-xl text-xs font-semibold text-emerald-800 text-center border border-emerald-100"
      }, /*#__PURE__*/React.createElement("i", {
        className: "fas fa-check-circle text-emerald-600 mr-1.5"
      }), "Semua petugas Arrum Exspres sudah mengisi (", data.totalOfficers, " orang)."))), /*#__PURE__*/React.createElement("button", {
        type: "button",
        onClick: () => copyCategoryList(catKey, catTitle, data.pendingOfficers),
        className: "mt-3 w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
      }, /*#__PURE__*/React.createElement("i", {
        className: `fas ${copiedCategory === catKey ? 'fa-check' : 'fa-copy'}`
      }), /*#__PURE__*/React.createElement("span", null, copiedCategory === catKey ? 'Tersalin!' : 'Salin Daftar Arrum Exspres')));
    })())), /*#__PURE__*/React.createElement("div", {
      className: "bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center gap-1.5"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-xs font-bold text-slate-500 mr-1 flex items-center"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-filter text-emerald-600 mr-1.5"
    }), " Kategori:"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', ''),
      className: `px-3 py-1.5 rounded-xl text-xs font-extrabold transition ${!filters.dataset ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`
    }, "Semua (", safeRows.length, ")"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', 'kol1'),
      className: `px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${filters.dataset === 'kol1' ? 'bg-amber-600 text-white shadow-xs' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'}`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-triangle-exclamation mr-1.5 text-[10px]"
    }), "KOL 1 (", countKol1, ")"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', 'lar'),
      className: `px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${filters.dataset === 'lar' ? 'bg-orange-600 text-white shadow-xs' : 'bg-orange-50 text-orange-800 hover:bg-orange-100 border border-orange-200'}`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-clock-rotate-left mr-1.5 text-[10px]"
    }), "LAR (", countLar, ")"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', 'npl'),
      className: `px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${filters.dataset === 'npl' ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'}`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-circle-exclamation mr-1.5 text-[10px]"
    }), "NPL (", countNpl, ")"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', 'arrumExp'),
      className: `px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center ${filters.dataset === 'arrumExp' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'}`
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-bolt-lightning mr-1.5 text-[10px]"
    }), "Arrum Exspres Loan (", countArrumExp, ")")), filters.dataset && /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => change('dataset', ''),
      className: "text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-times-circle mr-1"
    }), " Reset Filter Kategori")), /*#__PURE__*/React.createElement("div", {
      className: "bg-white p-4 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3"
    }, /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Cabang", /*#__PURE__*/React.createElement("select", {
      "aria-label": "Cabang rekap tindak lanjut",
      value: filters.branch,
      onChange: event => change('branch', event.target.value),
      className: `${field} mt-1`
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Semua Cabang"), branches.map(branch => /*#__PURE__*/React.createElement("option", {
      key: branch
    }, branch)))), /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Kategori", /*#__PURE__*/React.createElement("select", {
      "aria-label": "Kategori rekap tindak lanjut",
      value: filters.dataset,
      onChange: event => change('dataset', event.target.value),
      className: `${field} mt-1`
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Semua Kategori (KOL 1, LAR, NPL, Arrum Exspres)"), /*#__PURE__*/React.createElement("option", {
      value: "kol1"
    }, "KOL 1 (1\u201310 Hari)"), /*#__PURE__*/React.createElement("option", {
      value: "lar"
    }, "LAR (11\u201330 Hari)"), /*#__PURE__*/React.createElement("option", {
      value: "npl"
    }, "NPL (KOL 3\u20135)"), /*#__PURE__*/React.createElement("option", {
      value: "arrumExp"
    }, "Arrum Exspres Loan"))), /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Petugas", /*#__PURE__*/React.createElement("select", {
      "aria-label": "Petugas rekap tindak lanjut",
      value: filters.officer || '',
      onChange: event => change('officer', event.target.value),
      className: `${field} mt-1`
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Semua Petugas"), officersList.map(officer => /*#__PURE__*/React.createElement("option", {
      key: officer,
      value: officer
    }, officer)))), /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Mulai tanggal (WIB)", /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: filters.start,
      max: filters.end || undefined,
      onChange: event => change('start', event.target.value),
      className: `${field} mt-1`
    })), /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Sampai tanggal (WIB)", /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: filters.end,
      min: filters.start || undefined,
      onChange: event => change('end', event.target.value),
      className: `${field} mt-1`
    })), /*#__PURE__*/React.createElement("label", {
      className: "text-xs font-bold text-slate-500"
    }, "Cari nasabah / petugas", /*#__PURE__*/React.createElement("input", {
      "aria-label": "Cari rekap tindak lanjut",
      value: filters.search,
      onChange: event => change('search', event.target.value),
      placeholder: "CIF, kredit, nama, petugas",
      className: `${field} mt-1`
    }))), error && /*#__PURE__*/React.createElement("p", {
      role: "alert",
      className: "bg-rose-50 text-rose-700 p-4 rounded-2xl text-sm"
    }, "Rekap belum dapat dimuat: ", error), loading ? /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-500 p-6"
    }, "Memuat bukti tindak lanjut...") : /*#__PURE__*/React.createElement("div", {
      className: "bg-white border border-slate-200 rounded-3xl overflow-x-auto"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-left text-xs"
    }, /*#__PURE__*/React.createElement("thead", {
      className: "bg-slate-50 text-slate-500"
    }, /*#__PURE__*/React.createElement("tr", null, ['Waktu Foto (WIB)', 'Kategori / Cabang', 'CIF / No Kredit', 'Nama Nasabah', 'Nama Petugas', 'Lokasi', 'Bukti / Catatan'].map(label => /*#__PURE__*/React.createElement("th", {
      key: label,
      className: "p-4 whitespace-nowrap"
    }, label)))), /*#__PURE__*/React.createElement("tbody", {
      className: "divide-y divide-slate-100"
    }, visible.map(row => /*#__PURE__*/React.createElement("tr", {
      key: row.id
    }, /*#__PURE__*/React.createElement("td", {
      className: "p-4 whitespace-nowrap"
    }, core?.formatTime ? core.formatTime(row.captured_at) : row.captured_at), /*#__PURE__*/React.createElement("td", {
      className: "p-4"
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-bold"
    }, isRowArrumExp(row) ? 'Arrum Exspres Loan' : getLabel(row.dataset)), /*#__PURE__*/React.createElement("br", null), row.branch), /*#__PURE__*/React.createElement("td", {
      className: "p-4 font-mono whitespace-nowrap"
    }, row.cif, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("strong", null, row.credit_no)), /*#__PURE__*/React.createElement("td", {
      className: "p-4 font-bold"
    }, row.customer_name), /*#__PURE__*/React.createElement("td", {
      className: "p-4"
    }, /*#__PURE__*/React.createElement("p", {
      className: "font-bold"
    }, core?.officerName ? core.officerName(row) : row.officer_name || row.actor_name), /*#__PURE__*/React.createElement("p", {
      className: "text-slate-400 mt-1"
    }, "Akun: ", row.actor_name), !row.officer_name && /*#__PURE__*/React.createElement("p", {
      className: "text-amber-700 mt-1"
    }, "Nama belum diisi (data lama)")), /*#__PURE__*/React.createElement("td", {
      className: "p-4 whitespace-nowrap"
    }, hasValidCoords(row.latitude, row.longitude) ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("a", {
      href: getGoogleMapsUrl(row.latitude, row.longitude),
      target: "_blank",
      rel: "noopener noreferrer",
      className: "inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold underline",
      title: "Buka titik koordinat di Google Maps"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-map-location-dot text-emerald-600"
    }), " Buka Maps"), /*#__PURE__*/React.createElement("p", {
      className: "text-slate-400 mt-1 text-[11px]"
    }, "\xB1", Math.round(row.accuracy_m || 0), " m")) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400 italic"
    }, "Peta"), /*#__PURE__*/React.createElement("p", {
      className: "text-slate-400 mt-1 text-[11px]"
    }, "\xB1", Math.round(row.accuracy_m || 0), " m"))), /*#__PURE__*/React.createElement("td", {
      className: "p-4 min-w-[180px]"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-2"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setPhoto(row),
      className: `${button} bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200`,
      title: "Lihat Bukti Foto"
    }, /*#__PURE__*/React.createElement("i", {
      className: "fas fa-image mr-1.5 text-emerald-600"
    }), " Lihat Foto"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => {
        setDeleteError('');
        setDeleteTarget(row);
      },
      className: `${button} bg-rose-50 text-rose-700 border border-rose-200`
    }, "Hapus")), row.notes && /*#__PURE__*/React.createElement("p", {
      className: "mt-2 text-slate-500 whitespace-pre-wrap"
    }, row.notes)))), !visible.length && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: 7,
      className: "p-10 text-center text-slate-500"
    }, error ? 'Perbaiki koneksi lalu muat ulang.' : 'Belum ada tindak lanjut sesuai filter.'))))));
  }
  window.FollowupListDialog = FollowupListDialog;
  window.FollowupAdminView = FollowupAdminView;
  window.FollowupListDialogComponent = FollowupListDialog;
  window.FollowupAdminViewComponent = FollowupAdminView;
  if (typeof window !== "undefined") {
    if (!window.FollowupCore) window.FollowupCore = {};
    window.FollowupCore.UI = {
      FollowupListDialog,
      FollowupAdminView
    };
  }
})();