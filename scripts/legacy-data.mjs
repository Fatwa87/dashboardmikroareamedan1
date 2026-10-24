export const DATASETS = ['pencairan', 'estimasi', 'kol1', 'lar', 'npl', 'klaim', 'report'];
export const DATASET_KEYS = {
    pencairan: 'dataPencairan', estimasi: 'dataEstimasi', kol1: 'kol1Data',
    lar: 'larData', npl: 'nplData', klaim: 'klaimData', report: 'reportData'
};
export function prepareLegacy(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.error) {
        throw new Error('Sumber migrasi bukan objek database yang valid.');
    }
    const datasets = {};
    for (const name of DATASETS) {
        const rows = source[name] ?? source[DATASET_KEYS[name]];
        // Do not erase datasets omitted by an older Apps Script deployment.
        if (rows === undefined) continue;
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
            throw new Error(`Dataset ${name} tidak berupa daftar objek.`);
        }
        datasets[name] = rows.map(({ _id, ...payload }) => payload);
    }
    if (!Object.keys(datasets).length) throw new Error('Tidak ada dataset yang dikenali.');
    const masters = {};
    for (const [kind, key, oldColumn] of [
        ['ao','aoList','AO'], ['produk','productList','Produk'],
        ['admin','adminList','AdminMikro'], ['cabang','cabangList','Cabang']
    ]) {
        const rows = source[key] ?? source.masters?.[kind] ?? (
            Array.isArray(source.master) ? source.master.map(row => row[oldColumn]).filter(v => String(v || '').trim()) : undefined
        );
        if (rows === undefined) continue;
        if (!Array.isArray(rows)) throw new Error(`Master ${kind} tidak valid.`);
        masters[kind] = [...new Set(rows.map(value => String(value).trim().toUpperCase()).filter(Boolean))];
    }
    // Passwords from the old app are deliberately excluded. Provision fresh Auth accounts.
    const users = Array.isArray(source.users) ? source.users.map(user => ({
        username: String(user.Username || user.username || '').trim().toLowerCase(),
        role: (user.Role || user.role) === 'admin' ? 'admin' : 'ao'
    })).filter(user => user.username) : [];
    return { datasets, masters, users };
}
