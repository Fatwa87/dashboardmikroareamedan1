import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../assets/followup-core.js', import.meta.url), 'utf8');

function setupCore(localStorageStore = {}, extra = {}) {
    const store = {...localStorageStore};
    const localStorage = {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
        },
        setItem(key, value) {
            store[key] = String(value);
        },
        removeItem(key) {
            delete store[key];
        },
        clear() {
            for (const k in store) delete store[k];
        }
    };
    const context = vm.createContext({
        window: {isSecureContext: true, localStorage},
        localStorage,
        navigator: {},
        Intl,
        Date,
        setTimeout,
        clearTimeout,
        ...extra
    });
    new vm.Script(coreSource).runInContext(context);
    return {core: context.window.FollowupCore, store, context};
}

// Helper to normalize cross-vm realm objects for assert.deepEqual
const toHost = (obj) => JSON.parse(JSON.stringify(obj));

test('FollowupCore officers management defaults and local storage save/retrieve', () => {
    const {core, store} = setupCore();
    
    // Default officers should be present if storage is empty
    const defaults = toHost(core.getOfficers());
    assert.ok(defaults.kol1.length > 0);
    assert.ok(defaults.lar.length > 0);
    assert.ok(defaults.npl.length > 0);
    assert.ok(defaults.arrumExp.length > 0);
    assert.ok(defaults.kol1.includes('TONI PRIADI'));
    assert.ok(defaults.lar.includes('FAHRUL ISMAIL'));
    assert.ok(defaults.npl.includes('HASANUDDIN BATUBARA'));
    assert.ok(defaults.arrumExp.includes('M RIFAL KAUTSAR'));
    assert.ok(defaults.arrumExp.includes('AIDIL SYAHPUTRA'));

    // Saving custom list
    const custom = {
        kol1: ['Petugas KOL 1 A', 'Petugas KOL 1 B'],
        lar: ['Petugas LAR 1'],
        npl: ['Petugas NPL Special'],
        arrumExp: ['Petugas Arrum 1', 'Petugas Arrum 2']
    };
    const saved = toHost(core.saveOfficers(custom));
    assert.deepEqual(saved, {
        kol1: ['PETUGAS KOL 1 A', 'PETUGAS KOL 1 B'],
        lar: ['PETUGAS LAR 1'],
        npl: ['PETUGAS NPL SPECIAL'],
        arrumExp: ['PETUGAS ARRUM 1', 'PETUGAS ARRUM 2']
    });
    assert.ok(store[core.OFFICERS_STORAGE_KEY]);

    // Retrieving saved list (normalized to uppercase)
    const retrieved = toHost(core.getOfficers());
    assert.deepEqual(retrieved, {
        kol1: ['PETUGAS KOL 1 A', 'PETUGAS KOL 1 B'],
        lar: ['PETUGAS LAR 1'],
        npl: ['PETUGAS NPL SPECIAL'],
        arrumExp: ['PETUGAS ARRUM 1', 'PETUGAS ARRUM 2']
    });

    // getOfficersForDataset maps datasets correctly
    assert.deepEqual(toHost(core.getOfficersForDataset('kol1')), retrieved.kol1);
    assert.deepEqual(toHost(core.getOfficersForDataset('lar')), retrieved.lar);
    assert.deepEqual(toHost(core.getOfficersForDataset('npl')), retrieved.npl);
    assert.deepEqual(toHost(core.getOfficersForDataset('arrumExp')), retrieved.arrumExp);
    assert.deepEqual(toHost(core.getOfficersForDataset('arrum')), retrieved.arrumExp);
    // fallback for unknown dataset
    assert.deepEqual(toHost(core.getOfficersForDataset('unknown')), []);
});

test('FollowupCore parseOfficersExcel parses 2-column format (KATEGORI & NAMA PETUGAS)', () => {
    const fakeWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: {Sheet1: {}}
    };

    const mockXlsx = {
        utils: {
            sheet_to_json(sheet, opts) {
                // In XLSX, { header: 1 } returns 2D array of cells
                return [
                    ['KATEGORI', 'NAMA PETUGAS', 'KETERANGAN'],
                    ['KOL 1', 'Ahmad Fauzi', 'Area 1'],
                    ['kol 1', 'Budi Santoso', 'Area 2'],
                    ['LAR', 'Citra Dewi', 'Area 1'],
                    ['NPL', 'Dedi Pratama', 'Tim Khusus'],
                    ['NPL', 'Eko Saputra', 'Tim Khusus'],
                    ['ARRUM EXPRES LOAN', 'M Rifal Kautsar', 'Petugas Arrum'],
                    ['ARRUM EXPRESS LOAN', 'Nur Salim', 'Petugas Arrum'],
                    ['KOL 1', 'Ahmad Fauzi', 'Duplikat'] // Duplicate should be deduped
                ];
            }
        }
    };

    const {core} = setupCore({}, {XLSX: mockXlsx});
    const parsed = toHost(core.parseOfficersExcel(fakeWorkbook));
    assert.deepEqual(parsed.kol1, ['AHMAD FAUZI', 'BUDI SANTOSO']);
    assert.deepEqual(parsed.lar, ['CITRA DEWI']);
    assert.deepEqual(parsed.npl, ['DEDI PRATAMA', 'EKO SAPUTRA']);
    assert.deepEqual(parsed.arrumExp, ['M RIFAL KAUTSAR', 'NUR SALIM']);
});

test('FollowupCore parseOfficersExcel parses column-based format (KOL 1, LAR, NPL, ARRUM EXPRES LOAN)', () => {
    const fakeWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: {Sheet1: {}}
    };

    const mockXlsx = {
        utils: {
            sheet_to_json(sheet, opts) {
                return [
                    ['KOL 1', 'LAR', 'NPL', 'ARRUM EXPRES LOAN'],
                    ['Petugas K1', 'Petugas L1', 'Petugas N1', 'Petugas A1'],
                    ['Petugas K2', 'Petugas L2', '', 'Petugas A2'],
                    ['', 'Petugas L3', 'Petugas N2', '']
                ];
            }
        }
    };

    const {core} = setupCore({}, {XLSX: mockXlsx});
    const parsed = toHost(core.parseOfficersExcel(fakeWorkbook));
    assert.deepEqual(parsed.kol1, ['PETUGAS K1', 'PETUGAS K2']);
    assert.deepEqual(parsed.lar, ['PETUGAS L1', 'PETUGAS L2', 'PETUGAS L3']);
    assert.deepEqual(parsed.npl, ['PETUGAS N1', 'PETUGAS N2']);
    assert.deepEqual(parsed.arrumExp, ['PETUGAS A1', 'PETUGAS A2']);
});

test('FollowupCore parseOfficersExcel parses separate sheets format', () => {
    const fakeWorkbook = {
        SheetNames: ['KOL 1', 'LAR', 'NPL', 'ARRUM EXPRES LOAN'],
        Sheets: {
            'KOL 1': {},
            'LAR': {},
            'NPL': {},
            'ARRUM EXPRES LOAN': {}
        }
    };

    const mockXlsx = {
        utils: {
            sheet_to_json(sheet, opts) {
                if (sheet === fakeWorkbook.Sheets['KOL 1']) {
                    return [['NAMA PETUGAS'], ['Sheet K1'], ['Sheet K2']];
                }
                if (sheet === fakeWorkbook.Sheets['LAR']) {
                    return [['NAMA PETUGAS'], ['Sheet L1']];
                }
                if (sheet === fakeWorkbook.Sheets['NPL']) {
                    return [['NAMA PETUGAS'], ['Sheet N1']];
                }
                if (sheet === fakeWorkbook.Sheets['ARRUM EXPRES LOAN']) {
                    return [['NAMA PETUGAS'], ['Sheet Arrum 1'], ['Sheet Arrum 2']];
                }
                return [];
            }
        }
    };

    const {core} = setupCore({}, {XLSX: mockXlsx});
    const parsed = toHost(core.parseOfficersExcel(fakeWorkbook));
    assert.deepEqual(parsed.kol1, ['SHEET K1', 'SHEET K2']);
    assert.deepEqual(parsed.lar, ['SHEET L1']);
    assert.deepEqual(parsed.npl, ['SHEET N1']);
    assert.deepEqual(parsed.arrumExp, ['SHEET ARRUM 1', 'SHEET ARRUM 2']);
});

test('FollowupCore generateOfficersTemplate builds workbook with 2 sheets and initiates download', () => {
    let createdBook = false;
    let appendedSheets = [];
    let written = false;
    let clickedDownload = false;

    const mockXlsx = {
        write(wb, opts) {
            written = true;
            return new Uint8Array([1, 2, 3]);
        },
        utils: {
            book_new() {
                createdBook = true;
                return {Sheets: {}, SheetNames: []};
            },
            aoa_to_sheet(aoa) {
                return {aoa};
            },
            book_append_sheet(wb, ws, name) {
                appendedSheets.push({name, ws});
            }
        }
    };

    const mockDoc = {
        createElement(tag) {
            return {
                click() {
                    clickedDownload = true;
                }
            };
        }
    };

    const mockUrl = {
        createObjectURL() { return 'blob:mock-url'; },
        revokeObjectURL() {}
    };

    const {core} = setupCore({}, {
        XLSX: mockXlsx,
        document: mockDoc,
        Blob: class { constructor(parts) { this.parts = parts; } },
        URL: mockUrl
    });

    const result = core.generateOfficersTemplate(mockXlsx);
    assert.equal(result, true);
    assert.ok(createdBook);
    assert.ok(written);
    assert.ok(clickedDownload);
    assert.equal(appendedSheets.length, 2);
    assert.equal(appendedSheets[0].name, 'Daftar Petugas');
    assert.equal(appendedSheets[1].name, 'Format Kolom');
    assert.deepEqual(toHost(appendedSheets[0].ws.aoa[0]), ['KATEGORI', 'NAMA PETUGAS', 'KETERANGAN (OPSIONAL)']);
    assert.deepEqual(toHost(appendedSheets[1].ws.aoa[0]), ['KOL 1', 'LAR', 'NPL', 'ARRUM EXPRES LOAN']);
});

test('FollowupCore filterRecap filters by dataset category (kol1, lar, npl) and officer name', () => {
    const {core} = setupCore();

    const sampleRows = [
        {
            id: '1',
            dataset: 'kol1',
            branch: 'MEDAN',
            officer_name: 'Budi Santoso',
            customer_name: 'Nasabah A',
            credit_no: '111',
            captured_at: '2026-10-20T02:00:00Z'
        },
        {
            id: '2',
            dataset: 'lar',
            branch: 'MEDAN',
            officer_name: 'Siti Aminah',
            customer_name: 'Nasabah B',
            credit_no: '222',
            captured_at: '2026-10-20T03:00:00Z'
        },
        {
            id: '3',
            dataset: 'npl',
            branch: 'BINJAI',
            officer_name: 'Joko Widodo',
            customer_name: 'Nasabah C',
            credit_no: '333',
            captured_at: '2026-10-20T04:00:00Z'
        },
        {
            id: '4',
            dataset: 'kol1',
            branch: 'BINJAI',
            officer_name: 'Budi Santoso',
            customer_name: 'Nasabah D',
            credit_no: '444',
            captured_at: '2026-10-20T05:00:00Z'
        }
    ];

    // Filter by category: kol1
    const kol1Only = toHost(core.filterRecap(sampleRows, {dataset: 'kol1'}));
    assert.equal(kol1Only.length, 2);
    assert.ok(kol1Only.every(r => r.dataset === 'kol1'));

    // Filter by category: lar
    const larOnly = toHost(core.filterRecap(sampleRows, {dataset: 'lar'}));
    assert.equal(larOnly.length, 1);
    assert.equal(larOnly[0].officer_name, 'Siti Aminah');

    // Filter by category: npl
    const nplOnly = toHost(core.filterRecap(sampleRows, {dataset: 'npl'}));
    assert.equal(nplOnly.length, 1);
    assert.equal(nplOnly[0].officer_name, 'Joko Widodo');

    // Filter by officer: Budi Santoso
    const budiOnly = toHost(core.filterRecap(sampleRows, {officer: 'Budi Santoso'}));
    assert.equal(budiOnly.length, 2);

    // Filter combined: category kol1 + branch BINJAI + officer Budi Santoso
    const combined = toHost(core.filterRecap(sampleRows, {
        dataset: 'kol1',
        branch: 'BINJAI',
        officer: 'Budi Santoso'
    }));
    assert.equal(combined.length, 1);
    assert.equal(combined[0].id, '4');

    // Filter Arrum Exspres Loan by dataset, credit contract set, or notes
    const arrumRows = [
        ...sampleRows,
        {
            id: '5',
            dataset: 'kol1',
            branch: 'MEDAN UTAMA',
            credit_no: '999888',
            notes: '[Arrum Exspres Loan] Janji bayar',
            officer_name: 'Dewi Sartika',
            captured_at: '2026-10-20T06:00:00Z'
        },
        {
            id: '6',
            dataset: 'arrumExp',
            branch: 'KABANJAHE',
            credit_no: '777666',
            notes: 'Debitur ditemui di tempat usaha',
            officer_name: 'Budi Santoso',
            captured_at: '2026-10-20T07:00:00Z'
        }
    ];
    const arrumFilterResult = toHost(core.filterRecap(arrumRows, {
        dataset: 'arrumExp',
        arrumCreditNos: new Set(['999888'])
    }));
    assert.equal(arrumFilterResult.length, 2);
    assert.ok(arrumFilterResult.some(r => r.id === '5'));
    assert.ok(arrumFilterResult.some(r => r.id === '6'));

    const arrumOfficers = core.getOfficersForDataset('arrumExp');
    assert.ok(arrumOfficers.length > 0);
});

test('FollowupCore isPhotoAccessAllowed and getPhotoAccessStatus enforce 06.00 to 18.00 WIB window', () => {
    const {core} = setupCore();

    // 05:59:59 WIB = 22:59:59 UTC previous day -> Locked
    const before6am = new Date('2026-10-26T22:59:59.000Z');
    assert.equal(core.isPhotoAccessAllowed(before6am), false);
    const statusBefore = core.getPhotoAccessStatus(before6am);
    assert.equal(statusBefore.allowed, false);
    assert.equal(statusBefore.currentHourWib, 5);
    assert.ok(statusBefore.message.includes('18.00 WIB'));

    // 06:00:00 WIB = 23:00:00 UTC previous day -> Open
    const at6am = new Date('2026-10-26T23:00:00.000Z');
    assert.equal(core.isPhotoAccessAllowed(at6am), true);
    const statusAt6 = core.getPhotoAccessStatus(at6am);
    assert.equal(statusAt6.allowed, true);
    assert.equal(statusAt6.currentHourWib, 6);

    // 12:00:00 WIB = 05:00:00 UTC -> Open
    const noon = new Date('2026-10-27T05:00:00.000Z');
    assert.equal(core.isPhotoAccessAllowed(noon), true);
    assert.equal(core.getWibHour(noon), 12);

    // 17:59:59 WIB = 10:59:59 UTC -> Open
    const before6pm = new Date('2026-10-27T10:59:59.000Z');
    assert.equal(core.isPhotoAccessAllowed(before6pm), true);
    assert.equal(core.getWibHour(before6pm), 17);

    // 18:00:00 WIB = 11:00:00 UTC -> Locked
    const at6pm = new Date('2026-10-27T11:00:00.000Z');
    assert.equal(core.isPhotoAccessAllowed(at6pm), false);
    const statusAt6pm = core.getPhotoAccessStatus(at6pm);
    assert.equal(statusAt6pm.allowed, false);
    assert.equal(statusAt6pm.currentHourWib, 18);

    // 22:00:00 WIB = 15:00:00 UTC -> Locked
    const night = new Date('2026-10-27T15:00:00.000Z');
    assert.equal(core.isPhotoAccessAllowed(night), false);
    assert.equal(core.getWibHour(night), 22);
});

test('FollowupCore getPendingOfficers groups unsubmitted officers per category (kol1, lar, npl, arrumExp)', () => {
    const {core} = setupCore();

    // Set custom officers for deterministic testing
    core.saveOfficers({
        kol1: ['TONI PRIADI', 'SUJARWO', 'JIMMY RAFAEL K'],
        lar: ['FAHRUL ISMAIL', 'AZRIL ALFIS'],
        npl: ['AGUS SETIAWAN', 'HENDRA WIJAYA'],
        arrumExp: ['M RIFAL KAUTSAR', 'NUR SALIM']
    });

    const sampleRows = [
        // TONI PRIADI submitted kol1 today (2026-10-26 UTC morning = WIB day 2026-10-26)
        {
            id: '1',
            dataset: 'kol1',
            branch: 'MEDAN',
            officer_name: 'TONI PRIADI',
            credit_no: '101',
            captured_at: '2026-10-26T03:00:00Z'
        },
        // FAHRUL ISMAIL submitted lar today
        {
            id: '2',
            dataset: 'lar',
            branch: 'MEDAN',
            officer_name: 'FAHRUL ISMAIL',
            credit_no: '201',
            captured_at: '2026-10-26T04:00:00Z'
        },
        // M RIFAL KAUTSAR submitted arrumExp today
        {
            id: '3',
            dataset: 'arrumExp',
            branch: 'MEDAN',
            officer_name: 'M RIFAL KAUTSAR',
            credit_no: '301',
            captured_at: '2026-10-26T05:00:00Z'
        },
        // AGUS SETIAWAN submitted npl on yesterday (2026-10-25)
        {
            id: '4',
            dataset: 'npl',
            branch: 'BINJAI',
            officer_name: 'AGUS SETIAWAN',
            credit_no: '401',
            captured_at: '2026-10-25T03:00:00Z'
        }
    ];

    // Test scope: today (targetDate: 2026-10-26)
    const todayResult = toHost(core.getPendingOfficers(sampleRows, {
        scope: 'today',
        date: '2026-10-26'
    }));

    // KOL 1: 3 total, 1 completed (TONI PRIADI), 2 pending (SUJARWO, JIMMY RAFAEL K)
    assert.equal(todayResult.byCategory.kol1.totalOfficers, 3);
    assert.equal(todayResult.byCategory.kol1.completedCount, 1);
    assert.equal(todayResult.byCategory.kol1.pendingCount, 2);
    assert.deepEqual(todayResult.byCategory.kol1.completedOfficers, ['TONI PRIADI']);
    assert.deepEqual(todayResult.byCategory.kol1.pendingOfficers, ['SUJARWO', 'JIMMY RAFAEL K']);

    // LAR: 2 total, 1 completed (FAHRUL ISMAIL), 1 pending (AZRIL ALFIS)
    assert.equal(todayResult.byCategory.lar.totalOfficers, 2);
    assert.equal(todayResult.byCategory.lar.completedCount, 1);
    assert.equal(todayResult.byCategory.lar.pendingCount, 1);
    assert.deepEqual(todayResult.byCategory.lar.pendingOfficers, ['AZRIL ALFIS']);

    // NPL: 2 total, 0 completed today, 2 pending (AGUS SETIAWAN, HENDRA WIJAYA)
    assert.equal(todayResult.byCategory.npl.totalOfficers, 2);
    assert.equal(todayResult.byCategory.npl.completedCount, 0);
    assert.equal(todayResult.byCategory.npl.pendingCount, 2);
    assert.deepEqual(todayResult.byCategory.npl.pendingOfficers, ['AGUS SETIAWAN', 'HENDRA WIJAYA']);

    // Arrum Exspres Loan: 2 total, 1 completed (M RIFAL KAUTSAR), 1 pending (NUR SALIM)
    assert.equal(todayResult.byCategory.arrumExp.totalOfficers, 2);
    assert.equal(todayResult.byCategory.arrumExp.completedCount, 1);
    assert.equal(todayResult.byCategory.arrumExp.pendingCount, 1);
    assert.deepEqual(todayResult.byCategory.arrumExp.pendingOfficers, ['NUR SALIM']);

    // Summary totals
    assert.equal(todayResult.totalOfficers, 9);
    assert.equal(todayResult.totalCompleted, 3);
    assert.equal(todayResult.totalPending, 6);

    // Test scope: all (all history included, so AGUS SETIAWAN's yesterday entry counts as completed)
    const allResult = toHost(core.getPendingOfficers(sampleRows, { scope: 'all' }));
    assert.equal(allResult.byCategory.npl.completedCount, 1);
    assert.equal(allResult.byCategory.npl.pendingCount, 1);
    assert.deepEqual(allResult.byCategory.npl.pendingOfficers, ['HENDRA WIJAYA']);
});


