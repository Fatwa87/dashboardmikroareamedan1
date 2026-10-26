(function () {
    'use strict';
    const LABELS = Object.freeze({ kol1: 'KOL 1 (1–10 Hari)', lar: 'LAR (11–30 Hari)', npl: 'NPL (KOL 3–5)', arrumExp: 'Arrum Exspres Loan', arrumexp: 'Arrum Exspres Loan', arrum: 'Arrum Exspres Loan' });
    const BUKET = 'credit-followups';
    function cleanFollowupText(value) { return String(value??'').replace(/^[\s\u200b]+|[\s\u200b]+$/g,''); }
    function validateFollowupDetails(notes,officerName) {
        const result={notes:cleanFollowupText(notes),officerName:cleanFollowupText(officerName)};
        if(!result.notes)throw new Error('Catatan tindak lanjut wajib diisi.');
        if(result.notes.length>2000)throw new Error('Catatan tindak lanjut maksimal 2.000 karakter.');
        if(!result.officerName)throw new Error('Nama petugas wajib diisi.');
        if(result.officerName.length>120)throw new Error('Nama petugas maksimal 120 karakter.');
        return result;
    }
    function officerName(row) {
        if (!row || typeof row !== 'object') return '';
        return cleanFollowupText(row.officer_name) || row.actor_name || '';
    }
    function officerIdentity(row) {
        if (!row || typeof row !== 'object') return '';
        const name = cleanFollowupText(row.officer_name);
        return name ? 'name:' + name.toLocaleLowerCase('id-ID') : 'account:' + (row.actor_id || row.actor_name || '');
    }
    function customer(row) {
        if (!row || typeof row !== 'object') {
            return { sourceId: null, cif: '', creditNo: '—', name: 'Nasabah', branch: '' };
        }
        const getField = (keys) => {
            for (const k of keys) {
                if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
                    return String(row[k]).trim();
                }
            }
            return '';
        };
        const cif = getField(['CIF', 'cif', 'Cif', 'NO_CIF', 'NoCIF']);
        const creditNo = getField(['NO_KONTRAK', 'no_kontrak', 'NoKontrak', 'No_Kontrak', 'NO_KREDIT', 'NoKredit', 'no_kredit', 'credit_no', 'NO_REKENING', 'NoRekening']);
        const name = getField(['CUSTOMER_NM', 'customer_nm', 'customer_name', 'Nama', 'NAMA', 'NamaNasabah', 'Nama Nasabah', 'NAMA_NASABAH']);
        const branch = getField(['CABANG', 'Cabang', 'cabang', 'NAMA_CABANG', 'NamaCabang', 'Nama Cabang']);
        return {
            sourceId: row._id || null,
            cif,
            creditNo: creditNo || '—',
            name: name || 'Nasabah',
            branch,
            _dataset: row._dataset || row.dataset || null,
            subProduk: row['SUB PRODUK'] || row['SUB_PRODUK'] || row['Produk'] || row.subProduk || ''
        };
    }
    function localDay(value) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    }
    function formatTime(value) {
        return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value)) + ' WIB';
    }
    function getWibHour(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return 0;
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Jakarta',
                hour: 'numeric',
                hourCycle: 'h23'
            }).formatToParts(d);
            const hourPart = parts.find(p => p.type === 'hour');
            if (hourPart) return parseInt(hourPart.value, 10);
        } catch (_) {}
        const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
        return new Date(utcMs + (7 * 3600000)).getUTCHours();
    }
    function isPhotoAccessAllowed(value = new Date()) {
        const hour = getWibHour(value);
        // Akses buka foto aktif dari jam 06.00 WIB s/d sebelum jam 18.00 WIB (06:00 - 17:59:59).
        // Melewati jam 18.00 WIB (18:00 - 05:59:59) akses foto dikunci dan kembali dibuka jam 06.00 pagi.
        return hour >= 6 && hour < 18;
    }
    function getPhotoAccessStatus(value = new Date()) {
        const allowed = isPhotoAccessAllowed(value);
        const hour = getWibHour(value);
        return {
            allowed,
            currentHourWib: hour,
            operatingHoursText: '06.00 – 18.00 WIB',
            message: allowed
                ? 'Lampiran foto dapat diakses (Jam Operasional 06.00 – 18.00 WIB).'
                : 'Lampiran foto tindak lanjut tidak dapat dibuka melewati jam 18.00 WIB dan kembali bisa dibuka jam 06.00 WIB.'
        };
    }
    function getPendingOfficers(rows, options = {}) {
        const allOfficers = getOfficers();
        const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const scope = options.scope || 'today';
        const targetDate = options.date || localDay(new Date());
        const arrumCreditNos = options.arrumCreditNos instanceof Set
            ? options.arrumCreditNos
            : new Set(Array.isArray(options.arrumCreditNos) ? options.arrumCreditNos : []);

        let scopedRows = safeRows;
        if (scope === 'today') {
            scopedRows = safeRows.filter(r => {
                if (!r || !r.captured_at) return false;
                try {
                    return localDay(r.captured_at) === targetDate;
                } catch (_) {
                    return false;
                }
            });
        } else if (scope === 'filtered') {
            const start = options.start || '';
            const end = options.end || '';
            scopedRows = safeRows.filter(r => {
                if (!r || !r.captured_at) return false;
                try {
                    const day = localDay(r.captured_at);
                    if (start && day < start) return false;
                    if (end && day > end) return false;
                    return true;
                } catch (_) {
                    return false;
                }
            });
        }

        const isArrum = (r) => {
            if (!r) return false;
            const ds = String(r.dataset || '').toLowerCase();
            if (ds === 'arrumexp' || ds === 'arrum' || ds.includes('arrum')) return true;
            if (arrumCreditNos.has(String(r.credit_no || '').trim())) return true;
            if (/ARRUM\s*EXPR?ES\s*LOAN/i.test(r.notes || '') || /ARRUM\s*EXPR?ES\s*LOAN/i.test(r.product || '')) return true;
            return false;
        };

        const categories = ['kol1', 'lar', 'npl', 'arrumExp'];
        const result = {
            scope,
            targetDate,
            byCategory: {}
        };

        categories.forEach(cat => {
            const catRows = scopedRows.filter(r => {
                if (cat === 'arrumExp') return isArrum(r);
                if (isArrum(r)) return false;
                return String(r.dataset || '').toLowerCase() === cat;
            });

            const submittedSet = new Set(
                catRows.map(r => normalizeOfficerName(officerName(r))).filter(Boolean)
            );

            const list = Array.isArray(allOfficers[cat]) ? allOfficers[cat] : [];
            const completed = [];
            const pending = [];

            list.forEach(name => {
                const norm = normalizeOfficerName(name);
                if (!norm) return;
                if (submittedSet.has(norm)) {
                    completed.push(norm);
                } else {
                    pending.push(norm);
                }
            });

            const catSummary = {
                totalOfficers: list.length,
                completedCount: completed.length,
                pendingCount: pending.length,
                completedOfficers: completed,
                pendingOfficers: pending,
                hasPending: pending.length > 0
            };
            result.byCategory[cat] = catSummary;
            result[cat] = catSummary;
        });

        result.totalPending = Object.values(result.byCategory).reduce((sum, c) => sum + c.pendingCount, 0);
        result.totalOfficers = Object.values(result.byCategory).reduce((sum, c) => sum + c.totalOfficers, 0);
        result.totalCompleted = Object.values(result.byCategory).reduce((sum, c) => sum + c.completedCount, 0);

        return result;
    }
    function mapUrl(latitude, longitude) {
        return `https://www.openstreetmap.org/?mlat=${Number(latitude).toFixed(6)}&mlon=${Number(longitude).toFixed(6)}#map=18/${Number(latitude).toFixed(6)}/${Number(longitude).toFixed(6)}`;
    }
    function googleMapUrl(latitude, longitude) {
        if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) return '';
        return `https://www.google.com/maps?q=${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
    }
    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }
    function recapCsv(rows) {
        const header = ['Waktu Foto (WIB)', 'Kategori', 'Cabang', 'CIF', 'No Kredit', 'Nama Nasabah', 'Nama Petugas', 'Akun Pengunggah', 'Latitude', 'Longitude', 'Akurasi (m)', 'Peta di Foto', 'Catatan'];
        return '\uFEFF' + [header, ...rows.map(row => {
            const dsKey = String(row.dataset || '').toLowerCase();
            const catLabel = LABELS[row.dataset] || LABELS[dsKey] || (dsKey === 'arrumexp' || dsKey === 'arrum' ? 'Arrum Exspres Loan' : row.dataset);
            return [formatTime(row.captured_at), catLabel, row.branch, row.cif, row.credit_no, row.customer_name, officerName(row), row.actor_name,
            row.latitude, row.longitude, row.accuracy_m, row.map_included ? 'Ya' : 'Tidak', row.notes];
        })].map(row => row.map(csvCell).join(',')).join('\r\n');
    }
    const DEFAULT_OFFICERS = Object.freeze({
        kol1: [
            "TONI PRIADI", "SUJARWO", "JIMMY RAFAEL K", "DEKO HANDOKO", "HENDRA SETIADI",
            "SIMON PETRUS S", "AUGUSTIANT AL ZILDJIAN", "KHAIRINI YUSFIE", "SAURANI",
            "SURIYANTO", "ERIK P SILABAN", "SANDI AGASI", "REZA RINALDY", "SEPTIAN SIHOMBING",
            "ELI MARKUS SITOMPUL", "SANJOS SIHOMBING", "M FATHUR RAKHMAN"
        ],
        lar: [
            "FAHRUL ISMAIL", "AZRIL ALFIS", "SABANTRI GUNARDI", "INDRA HUMISAR SIREGAR",
            "BERTI RASMANA KEMIT", "SAID FITRA", "AIDIEL SYAHPUTRA TARIGAN",
            "DIVA ALVARADO DE MENDOZA PELAWI", "RAMADHINA AZZAHRA", "ABDUL SYAHRIL RIZAL SIREGAR",
            "BOY FRIDOANTA GINTING", "VALENTINA ANGGRIYANI PANGARIBUAN", "DENNYS RIO ALPENA",
            "VICHA TRI ANDRIYANI", "DWI RACHMADANI", "RISMAN NAINGGOLAN", "KEKE ANDRIANI YOLANDA",
            "VERA M PAKPAHAN", "RAMADHANA", "YOGI PRAMUDIYAH", "M IQBAL FARHANDI",
            "HARDI BIANTORO", "HALIMATUSADIYAH", "AGUSTRIANDA", "EDRIYAN SYAHPUTRA",
            "ESTER YETTY NORA MAGDALENA NAULI S", "RADITHA ASLAMIAH RINITA", "JENITA SIMATUPANG",
            "TAGOR PUTRA SEBAYANG", "SALWA NABILA", "HANIFAH RAMADHANI SEMBIRING", "MUHAMMAD IQBAL"
        ],
        npl: [
            "HASANUDDIN BATUBARA",
            "IWAN DESMORI SIMBOLON",
            "IZHAR EFENDI",
            "JERRY AKAWIRAWAN",
            "RIZKI FADLI LUBIS",
            "HAMZAH",
            "NOVRIANDA SANTOSO",
            "JOHNI IMMANUEL SINAGA",
            "AGUSTIAN",
            "MUHAMMAD ARIEF MZ",
            "TENGKU TAUFIK MAHLAN",
            "ZULFIKA FADLI",
            "HENDRIK IRWANSYAH",
            "MHD BAGUS RIZKY ARSYADIN",
            "M MAULANA NASUTION",
            "IWAN HENDRA SIMANULLANG",
            "HENDIKO SITUNGKIR"
        ],
        arrumExp: [
            "M RIFAL KAUTSAR",
            "NUR SALIM",
            "HENDRA PRATAMA S",
            "PUTRI RAMADHANA",
            "ARY DAMAITA TARIGAN",
            "ANDRE WILIANSYAH",
            "RENOL SINAGA",
            "DOLLIS PANJAITAN",
            "HERU KURNIAWAN",
            "M FAISAL NUR",
            "DIAN PRATAMA",
            "IMAM MUNIRO SINURAT",
            "ANDI SAMUEL SINAGA",
            "NENCY NATALINA PURBA",
            "ANGGA PRATAMA",
            "ASAURI",
            "M ZUBIR",
            "AIDIL SYAHPUTRA"
        ]
    });
    const OFFICERS_STORAGE_KEY = 'dashboard_credit_officers';
    function normalizeOfficerName(value) {
        return cleanFollowupText(value).toUpperCase().replace(/\s+/g, ' ');
    }
    function getOfficers() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const stored = window.localStorage.getItem(OFFICERS_STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === 'object') {
                        const isLegacyNpl = Array.isArray(parsed.npl) && parsed.npl.some(name => /TIM PENANGANAN NPL|PROPAN AREA MEDAN|PETUGAS KHUSUS NPL/i.test(name));
                        const nplList = (isLegacyNpl || !Array.isArray(parsed.npl) || !parsed.npl.length)
                            ? [...DEFAULT_OFFICERS.npl]
                            : [...new Set(parsed.npl.map(normalizeOfficerName).filter(Boolean))];
                        const arrumList = (Array.isArray(parsed.arrumExp) && parsed.arrumExp.length)
                            ? [...new Set(parsed.arrumExp.map(normalizeOfficerName).filter(Boolean))]
                            : (Array.isArray(parsed.arrum) && parsed.arrum.length
                                ? [...new Set(parsed.arrum.map(normalizeOfficerName).filter(Boolean))]
                                : [...DEFAULT_OFFICERS.arrumExp]);
                        return {
                            kol1: Array.isArray(parsed.kol1) && parsed.kol1.length ? [...new Set(parsed.kol1.map(normalizeOfficerName).filter(Boolean))] : [...DEFAULT_OFFICERS.kol1],
                            lar: Array.isArray(parsed.lar) && parsed.lar.length ? [...new Set(parsed.lar.map(normalizeOfficerName).filter(Boolean))] : [...DEFAULT_OFFICERS.lar],
                            npl: nplList,
                            arrumExp: arrumList
                        };
                    }
                }
            }
        } catch (_) {}
        return {
            kol1: [...DEFAULT_OFFICERS.kol1],
            lar: [...DEFAULT_OFFICERS.lar],
            npl: [...DEFAULT_OFFICERS.npl],
            arrumExp: [...DEFAULT_OFFICERS.arrumExp]
        };
    }
    function saveOfficers(officers) {
        const cleaned = {
            kol1: [...new Set((officers?.kol1 || []).map(normalizeOfficerName).filter(Boolean))],
            lar: [...new Set((officers?.lar || []).map(normalizeOfficerName).filter(Boolean))],
            npl: [...new Set((officers?.npl || []).map(normalizeOfficerName).filter(Boolean))],
            arrumExp: [...new Set((officers?.arrumExp || officers?.arrum || []).map(normalizeOfficerName).filter(Boolean))]
        };
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(OFFICERS_STORAGE_KEY, JSON.stringify(cleaned));
                window.dispatchEvent(new CustomEvent('dashboard_officers_updated', { detail: cleaned }));
            }
        } catch (_) {}
        return cleaned;
    }
    function getOfficersForDataset(dataset) {
        const current = getOfficers();
        const key = String(dataset || '').toLowerCase().trim();
        if (key === 'kol1' || key.includes('kol 1') || key.includes('kol1')) return current.kol1 || [];
        if (key === 'lar') return current.lar || [];
        if (key === 'npl' || key.includes('npl') || key.includes('kol 3') || key.includes('kol3')) return current.npl || [];
        if (key === 'arrumexp' || key === 'arrum' || key.includes('arrum') || key.includes('expres') || key.includes('express')) {
            if (current.arrumExp && current.arrumExp.length) return current.arrumExp;
            if (current.arrum && current.arrum.length) return current.arrum;
            return [...DEFAULT_OFFICERS.arrumExp];
        }
        return [];
    }
    function parseOfficersExcel(workbook) {
        if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
            throw new Error('File Excel tidak valid atau tidak memiliki sheet.');
        }
        const categorized = { kol1: [], lar: [], npl: [], arrumExp: [] };
        const normalizeCat = (val) => {
            const s = String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (s.includes('kol1') || s === 'k1') return 'kol1';
            if (s.includes('lar')) return 'lar';
            if (s.includes('npl') || s.includes('propan') || s.includes('kol3') || s.includes('kol4') || s.includes('kol5')) return 'npl';
            if (s.includes('arrum') || s.includes('expres') || s.includes('express')) return 'arrumExp';
            return null;
        };
        const isNameHeader = (val) => {
            const s = String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['nama', 'namapetugas', 'petugas', 'ao', 'petugaslapangan', 'accountofficer', 'adminmikro'].includes(s);
        };
        const isCategoryHeader = (val) => {
            const s = String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['kategori', 'kategorikredit', 'kolektibilitas', 'jenis', 'tipe', 'group', 'grup', 'posisi'].includes(s);
        };

        const xlsx = (typeof window !== 'undefined' ? window.XLSX : null) || globalThis.XLSX;
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet || !xlsx) continue;
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false }) || [];
            if (!rows.length) continue;
            const sheetCat = normalizeCat(sheetName);
            if (sheetCat && rows.length > 0) {
                let nameCol = 0;
                let startRow = 0;
                if (rows.length > 1 && (isNameHeader(rows[0][0]) || rows[0].some(isNameHeader))) {
                    const found = rows[0].findIndex(isNameHeader);
                    if (found >= 0) nameCol = found;
                    startRow = 1;
                }
                for (let r = startRow; r < rows.length; r++) {
                    const val = normalizeOfficerName(rows[r][nameCol]);
                    if (val && !isNameHeader(val)) categorized[sheetCat].push(val);
                }
                continue;
            }

            let headerRowIdx = -1;
            let colKOL1 = -1, colLAR = -1, colNPL = -1, colArrum = -1;
            let colCategory = -1, colOfficerName = -1;
            const scanLimit = Math.min(rows.length, 25);
            for (let r = 0; r < scanLimit; r++) {
                const row = rows[r] || [];
                row.forEach((cell, idx) => {
                    const cCat = normalizeCat(cell);
                    if (cCat === 'kol1') colKOL1 = idx;
                    else if (cCat === 'lar') colLAR = idx;
                    else if (cCat === 'npl') colNPL = idx;
                    else if (cCat === 'arrumExp') colArrum = idx;
                    if (isCategoryHeader(cell)) colCategory = idx;
                    if (isNameHeader(cell)) colOfficerName = idx;
                });
                if ((colKOL1 >= 0 || colLAR >= 0 || colNPL >= 0 || colArrum >= 0) || (colCategory >= 0 && colOfficerName >= 0)) {
                    headerRowIdx = r;
                    break;
                }
            }

            if (headerRowIdx >= 0) {
                const dataRows = rows.slice(headerRowIdx + 1);
                if (colKOL1 >= 0 || colLAR >= 0 || colNPL >= 0 || colArrum >= 0) {
                    dataRows.forEach(row => {
                        if (colKOL1 >= 0 && row[colKOL1]) {
                            const val = normalizeOfficerName(row[colKOL1]);
                            if (val && !normalizeCat(val) && !isNameHeader(val)) categorized.kol1.push(val);
                        }
                        if (colLAR >= 0 && row[colLAR]) {
                            const val = normalizeOfficerName(row[colLAR]);
                            if (val && !normalizeCat(val) && !isNameHeader(val)) categorized.lar.push(val);
                        }
                        if (colNPL >= 0 && row[colNPL]) {
                            const val = normalizeOfficerName(row[colNPL]);
                            if (val && !normalizeCat(val) && !isNameHeader(val)) categorized.npl.push(val);
                        }
                        if (colArrum >= 0 && row[colArrum]) {
                            const val = normalizeOfficerName(row[colArrum]);
                            if (val && !normalizeCat(val) && !isNameHeader(val)) categorized.arrumExp.push(val);
                        }
                    });
                } else if (colCategory >= 0 && colOfficerName >= 0) {
                    dataRows.forEach(row => {
                        const catVal = normalizeCat(row[colCategory]);
                        const nameVal = normalizeOfficerName(row[colOfficerName]);
                        if (catVal && nameVal && !isNameHeader(nameVal)) {
                            categorized[catVal].push(nameVal);
                        }
                    });
                }
            } else {
                rows.forEach(row => {
                    if (row.length >= 2) {
                        const catVal = normalizeCat(row[0]);
                        const nameVal = normalizeOfficerName(row[1]);
                        if (catVal && nameVal && !isNameHeader(nameVal)) {
                            categorized[catVal].push(nameVal);
                        }
                    }
                });
            }
        }

        const result = {
            kol1: [...new Set(categorized.kol1)],
            lar: [...new Set(categorized.lar)],
            npl: [...new Set(categorized.npl)],
            arrumExp: [...new Set(categorized.arrumExp)]
        };
        const total = result.kol1.length + result.lar.length + result.npl.length + result.arrumExp.length;
        if (total === 0) {
            throw new Error('Tidak ditemukan nama petugas dengan kategori KOL 1, LAR, NPL, atau ARRUM EXPRES LOAN dalam file Excel. Pastikan terdapat kolom KATEGORI dan NAMA PETUGAS, atau kolom KOL 1, LAR, NPL, ARRUM EXPRES LOAN.');
        }
        result.summary = {
            kol1Count: result.kol1.length,
            larCount: result.lar.length,
            nplCount: result.npl.length,
            arrumExpCount: result.arrumExp.length,
            total
        };
        return result;
    }
    function generateOfficersTemplate(xlsxLib) {
        const XLSX = xlsxLib || (typeof window !== 'undefined' ? window.XLSX : null) || globalThis.XLSX;
        if (!XLSX) throw new Error('Pustaka SheetJS belum tersedia.');
        const wb = XLSX.utils.book_new();
        const sampleRows = [
            ['KATEGORI', 'NAMA PETUGAS', 'KETERANGAN (OPSIONAL)'],
            ['KOL 1', 'TONI PRIADI', 'Admin Mikro'],
            ['KOL 1', 'SUJARWO', 'Admin Mikro'],
            ['KOL 1', 'JIMMY RAFAEL K', 'Admin Mikro'],
            ['LAR', 'FAHRUL ISMAIL', 'Account Officer'],
            ['LAR', 'AZRIL ALFIS', 'Account Officer'],
            ['LAR', 'SABANTRI GUNARDI', 'Account Officer'],
            ['NPL', 'AGUS SETIAWAN', 'Petugas NPL / Propan'],
            ['NPL', 'HENDRA WIJAYA', 'Petugas NPL / Propan'],
            ['NPL', 'TIM PENANGANAN NPL MEDAN', 'Petugas NPL / Propan'],
            ['ARRUM EXPRES LOAN', 'M RIFAL KAUTSAR', 'Petugas Arrum Exspres Loan'],
            ['ARRUM EXPRES LOAN', 'NUR SALIM', 'Petugas Arrum Exspres Loan'],
            ['ARRUM EXPRES LOAN', 'HENDRA PRATAMA S', 'Petugas Arrum Exspres Loan']
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(sampleRows);
        ws1['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Daftar Petugas');

        const altRows = [
            ['KOL 1', 'LAR', 'NPL', 'ARRUM EXPRES LOAN'],
            ['TONI PRIADI', 'FAHRUL ISMAIL', 'AGUS SETIAWAN', 'M RIFAL KAUTSAR'],
            ['SUJARWO', 'AZRIL ALFIS', 'HENDRA WIJAYA', 'NUR SALIM'],
            ['JIMMY RAFAEL K', 'SABANTRI GUNARDI', 'TIM PENANGANAN NPL MEDAN', 'HENDRA PRATAMA S']
        ];
        const ws2 = XLSX.utils.aoa_to_sheet(altRows);
        ws2['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Format Kolom');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Template_Daftar_Petugas_KOL1_LAR_NPL.xlsx';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }
    function filterRecap(rows, filters) {
        const term = (filters.search || '').trim().toLowerCase();
        const targetDs = String(filters.dataset || '').toLowerCase();
        const isArrumFilter = targetDs === 'arrumexp' || targetDs === 'arrum' || targetDs.includes('arrum');
        const arrumSet = filters.arrumCreditNos || (typeof window !== 'undefined' && window.arrumCreditNos) || null;

        return rows.filter(row => {
            const day = localDay(row.captured_at);
            const rDs = String(row.dataset || '').toLowerCase();
            let matchesDataset = true;
            if (filters.dataset) {
                if (isArrumFilter) {
                    const matchesArrum = rDs === 'arrumexp' || rDs === 'arrum'
                        || (arrumSet && arrumSet.has(String(row.credit_no || '').trim()))
                        || /ARRUM\s*EXPR?ES\s*LOAN/i.test(row.notes || '')
                        || /ARRUM\s*EXPR?ES\s*LOAN/i.test(row.product || '');
                    matchesDataset = Boolean(matchesArrum);
                } else {
                    matchesDataset = (row.dataset === filters.dataset);
                }
            }

            return (!filters.branch || row.branch === filters.branch) && matchesDataset
                && (!filters.start || day >= filters.start) && (!filters.end || day <= filters.end)
                && (!filters.officer || officerName(row).toLowerCase() === filters.officer.toLowerCase())
                && (!term || [row.cif,row.credit_no,row.customer_name,row.officer_name,row.actor_name,row.branch].some(value => String(value??'').toLowerCase().includes(term)));
        });
    }
    function getLocation() {
        return new Promise((resolve, reject) => {
            if (!window.isSecureContext) return reject(new Error('Kamera dan lokasi memerlukan HTTPS atau localhost.'));
            if (!navigator.geolocation) return reject(new Error('GPS tidak tersedia pada perangkat ini.'));
            navigator.geolocation.getCurrentPosition(position => {
                const { latitude, longitude, accuracy } = position.coords;
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)
                    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0
                    || !Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 60000) {
                    reject(new Error('Lokasi belum valid atau masih memakai posisi lama. Aktifkan GPS lalu coba lagi.')); return;
                }
                resolve({ latitude, longitude, accuracy });
            }, error => reject(new Error(error.code === 1 ? 'Izin lokasi belum diberikan. Izinkan lokasi untuk mencatat bukti kunjungan.'
                : error.code === 3 ? 'GPS belum mendapat posisi. Coba lagi di tempat dengan sinyal lebih baik.' : 'Lokasi tidak tersedia. Aktifkan GPS lalu coba lagi.')),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
        });
    }
    function loadTile(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => { img.onload = null; img.onerror = null; reject(new Error('Peta belum tersedia.')); }, 8000);
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'strict-origin-when-cross-origin';
            img.onload = () => { clearTimeout(timeout); resolve(img); };
            img.onerror = () => { clearTimeout(timeout); reject(new Error('Peta gagal dimuat.')); };
            img.src = url;
        });
    }
    async function drawMiniMap(context, location, box) {
        const zoom = 16, scale = 256 * 2 ** zoom;
        const lat = Math.max(-85.0511, Math.min(85.0511, location.latitude)) * Math.PI / 180;
        const worldX = (location.longitude + 180) / 360 * scale;
        const worldY = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * scale;
        const left = worldX - box.width / 2, top = worldY - box.height / 2;
        const tasks = [];
        for (let x = Math.floor(left / 256); x <= Math.floor((left + box.width - 1) / 256); x++) {
            for (let y = Math.floor(top / 256); y <= Math.floor((top + box.height - 1) / 256); y++) {
                const tileX = ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
                tasks.push(loadTile(`https://tile.openstreetmap.org/${zoom}/${tileX}/${y}.png`).then(img => ({ img, x, y })));
            }
        }
        const tiles = await Promise.all(tasks);
        context.save(); context.beginPath(); context.rect(box.x,box.y,box.width,box.height); context.clip();
        tiles.forEach(({img,x,y}) => context.drawImage(img,box.x+x*256-left,box.y+y*256-top,256,256));
        context.fillStyle = '#dc2626'; context.beginPath(); context.arc(box.x+box.width/2,box.y+box.height/2,7,0,Math.PI*2); context.fill();
        context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke();
        context.fillStyle = 'rgba(255,255,255,.9)'; context.fillRect(box.x,box.y+box.height-15,box.width,15);
        context.fillStyle = '#0f172a'; context.font = '10px sans-serif'; context.fillText('© OpenStreetMap contributors',box.x+4,box.y+box.height-4);
        context.restore();
    }
    async function stampPhoto(rawCanvas, location, capturedAt, record, officer) {
        const canvas = document.createElement('canvas');
        const width = rawCanvas.width, photoHeight = rawCanvas.height;
        const footer = Math.max(210,Math.round(width*.19));
        canvas.width = width; canvas.height = photoHeight + footer;
        const context = canvas.getContext('2d');
        context.drawImage(rawCanvas,0,0);
        context.fillStyle = '#071b18'; context.fillRect(0,photoHeight,width,footer);
        const padding = Math.max(16,Math.round(width*.02));
        const mapWidth = Math.min(260,Math.round(width*.30));
        const box = {x:width-mapWidth-padding,y:photoHeight+padding,width:mapWidth,height:footer-padding*2};
        let mapIncluded = true;
        try { await drawMiniMap(context,location,box); }
        catch (_) {
            mapIncluded = false;
            context.fillStyle = '#e2e8f0'; context.fillRect(box.x,box.y,box.width,box.height);
            context.fillStyle = '#334155'; context.font = '14px sans-serif';
            context.fillText('Peta tidak tersedia',box.x+8,box.y+35);
            context.fillText('Koordinat tercatat',box.x+8,box.y+60);
        }
        const font = Math.max(14,Math.round(width*.017));
        const line = Math.max(25,Math.round(font*1.65));
        const maxWidth = box.x - padding*2;
        context.fillStyle = '#6ee7b7'; context.font = `bold ${font+3}px sans-serif`;
        context.fillText('BUKTI TINDAK LANJUT',padding,photoHeight+padding+font,maxWidth);
        const latStr = location && typeof location.latitude === 'number' ? location.latitude.toFixed(6) : '0.000000';
        const lonStr = location && typeof location.longitude === 'number' ? location.longitude.toFixed(6) : '0.000000';
        const accStr = location && typeof location.accuracy === 'number' ? Math.round(location.accuracy) : 0;
        const branchStr = record?.branch || 'Cabang';
        const creditStr = record?.creditNo || '—';
        const officerStr = officer || 'Petugas';
        const lines = [
            formatTime(capturedAt),
            `GPS: ${latStr}, ${lonStr}`,
            `Akurasi: ±${accStr} m`,
            `${branchStr} • ${creditStr}`,
            `Akun: ${officerStr}`
        ];
        lines.forEach((text,index) => context.fillText(text,padding,photoHeight+padding+font+(index+1)*line,maxWidth));
        const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Foto gagal diproses.')), 'image/jpeg',.86));
        if (blob.size > 5242880) throw new Error('Foto melebihi 5 MB. Ambil ulang dengan resolusi lebih rendah.');
        return { blob, mapIncluded };
    }
    window.FollowupCore = Object.freeze({
        LABELS, BUKET, DEFAULT_OFFICERS, OFFICERS_STORAGE_KEY,
        cleanFollowupText, validateFollowupDetails, officerName, officerIdentity,
        customer, localDay, formatTime, mapUrl, googleMapUrl, csvCell, recapCsv, filterRecap,
        getLocation, stampPhoto,
        getOfficers, saveOfficers, getOfficersForDataset, parseOfficersExcel, generateOfficersTemplate,
        getWibHour, isPhotoAccessAllowed, getPhotoAccessStatus, getPendingOfficers
    });
}());
