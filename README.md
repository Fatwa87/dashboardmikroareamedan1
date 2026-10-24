# Dashboard Mikro Area Medan 1

Dashboard statis React yang memakai **Supabase Auth + PostgreSQL**. Tidak perlu build untuk menjalankan website.

Hasil penerapan dan verifikasi proyek ini dicatat dalam [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Versi baru dipertahankan lokal sesuai pilihan pemilik; domain produksi belum diperbarui.

## Proyek yang disiapkan

- Nama: `dashboard-mikro-area-medan1`
- Project ref: `mmxuotrfgzmdhyrfpsqs`
- Dashboard Supabase: https://supabase.com/dashboard/project/mmxuotrfgzmdhyrfpsqs
- Konfigurasi website: `assets/supabase-config.js` (hanya URL dan publishable key publik).
- Admin login memakai username `admin`; identitas Auth di belakangnya adalah `admin@dashboard.local`.
- Password dibuat sendiri oleh pemilik akun. Password bawaan aplikasi lama tidak berlaku di versi baru.

## Jalankan di komputer

Gunakan Node.js 22.18 atau lebih baru:

```powershell
npm ci
npm start
```

Buka http://127.0.0.1:4173. Login memakai akun Supabase Auth yang memiliki baris di `app_profiles`.

```powershell
npm run check
npm test
```

Pengujian mencakup kompilasi JSX/TypeScript, pembacaan lebih dari 1.000 baris, kegagalan penyimpanan, validasi token dan role pada fungsi akun, RLS PostgreSQL, impor atomik, penghapusan berdasarkan UUID, konflik pembaruan master, serta bukti tindak lanjut dan akses foto privat. Pengujian database berjalan lokal melalui PGlite; tidak mengubah proyek produksi.

## Cara kerja database

| Tabel | Isi |
| --- | --- |
| `app_profiles` | Username dan role yang ditetapkan server, terhubung ke `auth.users` |
| `dashboard_records` | Dataset pencairan, estimasi, KOL 1, LAR, NPL, klaim, dan report |
| `dashboard_master` | Master AO, produk, admin mikro, dan cabang; versi mencegah perubahan perangkat lain tertimpa |
| `dashboard_imports` / `dashboard_import_rows` | Area sementara unggahan; data aktif diganti serentak setelah semua baris lengkap |
| `credit_followups` | Bukti kunjungan KOL 1/LAR/NPL, snapshot kredit, petugas, waktu, GPS, dan lokasi foto privat |

`payload` bertipe JSONB mempertahankan nama kolom Excel dan Google Sheet yang dipakai dashboard. Nomor kontrak/kredit dipertahankan sebagai teks dari sumber. Setiap baris memiliki UUID, sehingga hapus satu baris tidak ikut menghapus baris bernama sama.

| Akses | Belum login | AO | Admin |
| --- | --- | --- | --- |
| Membaca data dashboard/master | Tidak | Ya | Ya |
| Input pencairan dan estimasi | Tidak | Ya | Ya |
| Hapus transaksi | Tidak | Tidak | Ya |
| Kelola master dan impor/reset Excel | Tidak | Tidak | Ya |
| Kelola akun pengguna | Tidak | Tidak | Ya, melalui Edge Function |
| Mengambil dan menyimpan bukti tindak lanjut | Tidak | Ya | Ya |
| Membaca bukti dan foto tindak lanjut | Tidak | Milik sendiri | Seluruh bukti yang selesai disimpan |
| Melihat password | Tidak | Tidak | Tidak |

Seluruh AO dapat membaca data seluruh cabang, sesuai perilaku aplikasi awal. Pembatasan cabang per akun belum diterapkan karena aplikasi lama tidak memiliki pemetaan akun ke cabang.

Website memuat data dari Supabase saat login dan ketika tombol sinkronkan ditekan. Data baru tidak otomatis muncul di perangkat lain sampai perangkat itu menyinkronkan lagi. Data nasabah dan daftar password tidak disalin lagi ke localStorage; Supabase mengelola token sesi, sedangkan tema tetap tersimpan di browser. Salinan browser lama tetap tersedia untuk backup selama belum dihapus pemiliknya.

## Sinkronisasi otomatis selama perpindahan

**Sudah aktif pada proyek yang disiapkan:** dashboard lama → Supabase setiap 5 menit, berjalan di server lewat [Supabase Cron](https://supabase.com/docs/guides/cron) dan [HTTP extension](https://supabase.com/docs/guides/database/extensions/http). Komputer dan browser tidak harus menyala. Sumber Google Apps Script harus tetap tersedia; perubahan di Supabase tidak dikirim balik ke sistem lama.

Panel **Sinkronisasi Otomatis Database Lama** disembunyikan dari Kelola & Setting sesuai permintaan pemilik. Sinkronisasi server tetap berjalan setiap 5 menit. Pemantauan dan kontrol proses perpindahan dilakukan pengelola melalui Supabase, pada schema privat `dashboard_sync` dan job Cron `dashboard-legacy-sync`. Tekan tombol sinkronkan dashboard atau muat ulang halaman untuk melihat data server terbaru.

Mekanisme perlindungan:

- Baris awal migrasi dilacak menurut isi JSONB dan jumlah kemunculan, sehingga proses berulang tidak menggandakan baris dan duplikat yang memang ada di sumber tetap dipertahankan. Baris yang tidak berubah tetap memakai UUID yang sama.
- Perubahan sumber mengarsipkan versi hasil migrasi yang lama dengan `legacy_hidden`, lalu mengaktifkan versi terbaru. Jika sumber menghapus baris, versi lama hanya diarsipkan. Data aktif melewati RLS sehingga baris arsip tidak ikut angka/dashboard. Bukti tindak lanjut tetap tersimpan; foto baru dari baris portofolio yang sudah diarsipkan ditolak.
- Baris yang dibuat akun Supabase tidak ditimpa. Bila identitas kredit pada kedua sistem berbenturan, versi Supabase dipertahankan dan ringkasan proses mencatat benturan. Periksa benturan sebelum perpindahan akhir.
- Penghapusan atau penggantian baris di Supabase dicatat melalui pemetaan yang kehilangan UUID sumbernya; data tersebut tidak otomatis dimunculkan kembali. Jumlahnya tampil sebagai **Dilewati**. Perubahan kolom identitas pada sumber tidak selalu dapat dipasangkan ke input lokal karena sumber lama tidak memiliki ID permanen; penggabungan yang meragukan perlu ditinjau pengelola.
- Master yang belum diubah di Supabase dapat mengikuti sumber. Master yang berubah di kedua sistem dipertahankan di Supabase dan ditandai benturan.
- Respons yang tidak valid/gagal tidak mengubah snapshot aktif. Server mencoba kembali setelah interval berikutnya; log tidak menyimpan respons mentah atau password lama. Dataset yang tidak dikirim sumber tetap dipertahankan.
- **Unggah/reset Excel tetap dapat dilakukan saat sinkronisasi aktif.** Sesudah commit berhasil, dataset dalam manifest impor menjadi dikelola Supabase (`native_datasets`) dan tidak lagi diubah oleh sumber lama. Upload Data Mikro mengambil alih KOL 1, LAR, NPL, dan klaim; Upload Report hanya report. Dataset lainnya tetap disinkronkan. Penetapan sumber dan penggantian data dilakukan dalam satu transaksi, sehingga kegagalan tidak mengubah data lama maupun kepemilikannya.

Untuk perpindahan akhir: hentikan input di dashboard lama, minta pengelola Supabase memeriksa proses server terbaru, cocokkan jumlah serta selesaikan benturan/baris dilewati, kemudian nonaktifkan sinkronisasi melalui konfigurasi server setelah perpindahan disetujui. Website Supabase sudah diterbitkan. Mengunggah kode ke repository atau menyembunyikan panel tidak otomatis menonaktifkan sinkronisasi ini.

Konfigurasi sumber, pemetaan, arsip dasar, dan 100 ringkasan proses terakhir ada pada schema privat `dashboard_sync`, tidak diberikan kepada `anon`/`authenticated`; semua tabel memakai RLS. RPC status/kontrol memeriksa role admin dan tidak mengembalikan URL sumber. Job `dashboard-legacy-sync` berjalan tiap menit untuk mengecek apakah interval 5 menit/permintaan manual sudah jatuh tempo. Saat nonaktif, job hanya mengecek flag dan tidak membaca sumber. Jika Supabase pause/offline atau sumber gagal, jadwal tidak menjamin pembaruan tepat waktu; cek status sebelum cutover.

Untuk memperbarui data Mikro atau Report, langsung pilih Excel baru; reset sebelumnya tidak diperlukan. Reset tetap tersedia bila memang ingin mengosongkan kategori tersebut. Bukti foto dan catatan tindak lanjut dipertahankan meskipun portofolio direset atau diganti. Kategori yang sudah dikelola Supabase tidak otomatis kembali mengikuti sumber lama hanya karena sinkronisasi global dinyalakan ulang. Pengelola dapat memeriksa daftar kategorinya di `dashboard_sync.settings.native_datasets`; perubahan kepemilikan kembali ke sumber lama harus ditinjau tersendiri.

### Menyiapkan sumber sinkronisasi pada proyek lain

Setelah migrasi SQL diterapkan, pengelola proyek menjalankan ini di SQL Editor. Ganti URL dengan endpoint `/exec` dari sumber sendiri. Jangan memasukkan URL sumber atau password/service key ke aset website.

```sql
begin;
-- Jalankan sekali setelah data awal hasil migrasi sudah diperiksa.
-- Bootstrap hanya melacak baris dengan created_by null, sesuai alat migrasi awal.
select dashboard_sync.bootstrap();
update dashboard_sync.settings
set source_url = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
    enabled = true, requested = true, last_status = 'menunggu'
where id;
commit;
```

Jika data awal diimpor melalui akun Auth sehingga `created_by` terisi, pengelola harus mencocokkan provenance/backup terlebih dahulu; jangan mengubah kepemilikan input asli Supabase untuk memaksa bootstrap. Untuk menghentikan dari SQL Editor, jalankan `update dashboard_sync.settings set enabled=false,requested=false where id;`. Jangan menjalankan bootstrap ulang atau menghapus pemetaan untuk menyelesaikan benturan tanpa meninjau backup.

## Tindak lanjut kredit dan rekap admin

1. Buka **KOL 1**, **LAR 11–30 Hari**, atau **NPL (KOL 3–5)**, lalu pilih satu cabang.
2. Klik **Tindak Lanjut** di sebelah **Cetak PDF**. Popup menampilkan CIF, nomor kredit, nama nasabah, dan tombol **Lampirkan Foto** untuk seluruh kredit pada cabang itu. Gunakan pencarian di popup bila diperlukan.
3. Klik **Lampirkan Foto**, izinkan kamera dan lokasi pada browser, kemudian klik **Ambil Foto**. Kamera belakang diprioritaskan; **Ganti Kamera** memilih arah lain.
4. Periksa pratinjau, isi **Catatan Tindak Lanjut** (wajib, maksimal 2.000 karakter) dan kolom **Nama Petugas** di bawahnya (wajib, maksimal 120 karakter), lalu klik **Simpan Tindak Lanjut**. Notice wajib diisi tampil di bawah foto. Tombol simpan nonaktif selama salah satu kolom kosong atau hanya berisi spasi. Foto memuat waktu WIB, koordinat GPS, akurasi, cabang, nomor kredit, akun pengunggah, dan peta lokasi. Jika peta gagal dimuat, tersedia **Ulangi Peta**; koordinat dan waktu tetap tercantum.
5. Admin membuka **Rekap Tindak Lanjut** dari sidebar. Rekap menyediakan filter cabang, kategori, tanggal WIB dan pencarian; tombol **Lihat Foto**, **Buka Peta**, **Unduh Rekap CSV**, serta **Cetak PDF** mengikuti hasil filter. Klik **Muat Ulang** untuk mengambil bukti terbaru dari perangkat lain.
6. Tombol **Hapus** tersedia di samping Lihat Foto pada setiap baris. Konfirmasi menampilkan identitas kredit, waktu, dan petugas; **Batal** mempertahankan bukti. Setelah **Ya, Hapus** berhasil di server, baris hilang dan angka rekap diperbarui. Bila koneksi gagal, dialog menampilkan error dan dapat dicoba ulang.

**Cetak PDF dengan foto:** hasil mengikuti filter saat tombol ditekan, memakai A4 mendatar dengan kolom identitas kredit, kategori/cabang, waktu WIB, petugas, lokasi/catatan, dan foto pada baris yang sama. Foto maksimum **49 × 31 mm**, tetap utuh sesuai proporsi asli, dengan hingga empat baris biasa per halaman. Catatan panjang membuat baris bertambah tinggi; tabel mengulang judul kolom dan mencetak nomor halaman yang benar. Semua foto dimuat dari penyimpanan privat terlebih dahulu, diperkecil sampai sisi terpanjang 960 piksel, lalu ditanam sebagai JPEG di PDF. Gambar tetap tersedia di PDF setelah tautan foto 5 menit berakhir.

Nama petugas yang diketik tersimpan terpisah sebagai `officer_name` dan tampil di rekap, pencarian, detail foto, serta PDF/CSV. `actor_id`/`actor_name` tetap identitas akun Auth yang mengunggah, ditetapkan server; pengisian nama tidak mengubah akun/hak akses. PDF menampilkan nama pelaksana beserta akun pengunggah, sedangkan CSV memiliki dua kolom terpisah. Hitungan petugas mengikuti nama yang diisi (tanpa membedakan huruf besar/kecil).

Kewajiban catatan dan nama diperiksa di formulir, klien, fungsi database, dan constraint baris baru. Draft lama harus dilengkapi sebelum submit; nama/catatan pada draft dapat diperbaiki ketika mencoba simpan ulang. Bukti yang sudah selesai tidak ditulis ulang oleh retry. Bukti historis tetap tersedia tanpa memaksakan nama atau catatan buatan: rekap memakai akun lama sebagai fallback dan memberi penanda bahwa nama belum diisi. Muat ulang aplikasi jika masih terbuka dengan formulir versi lama.

Saat memuat, tombol menampilkan jumlah foto selesai; tersedia **Batalkan PDF**. Bila satu foto tidak dapat dimuat, PDF tidak diterbitkan tanpa bukti tersebut: periksa koneksi/izin, muat ulang rekap, lalu coba lagi. File hasil bernama `Rekap_Tindak_Lanjut_Foto.pdf`. CSV tetap berisi data teks. Contoh layout dengan sembilan nasabah/foto simulasi dapat dibuat memakai `node scripts/preview-followup-pdf.mjs` dan tersimpan di `output/pdf/Contoh_Rekap_Tindak_Lanjut_Foto.pdf`; contoh ini tidak membaca data Supabase.

Hapus hanya diizinkan untuk admin melalui fungsi database `delete_credit_followup`; AO tetap ditolak walaupun memanggil API langsung. Penghapusan mengarsipkan bukti dengan waktu dan identitas admin, menyembunyikannya dari rekap/ekspor, dan menutup pembuatan tautan foto baru baik untuk admin maupun pemilik foto. Tautan foto yang sudah diterbitkan dapat tetap berlaku sampai masa 5 menit berakhir. Data kredit nasabah tidak ikut dihapus. Arsip dan objek foto masih tersimpan di Supabase dan hanya dapat dipulihkan oleh pengelola proyek (set `deleted_at` dan `deleted_by` kembali `null` pada baris yang benar melalui SQL Editor); pemulihan belum memiliki tombol di aplikasi.

Kamera dan GPS memerlukan **HTTPS** atau `localhost`/`127.0.0.1`. Akses dari HP lewat alamat IP komputer dengan HTTP biasa tidak memenuhi persyaratan browser; gunakan HTTPS saat diterbitkan. Kamera dan lokasi fisik perlu dicoba pada perangkat operasional setelah izin diberikan. Alur browser diuji memakai kamera/GPS simulasi yang diberi label jelas, tanpa membuat bukti kunjungan di database live.

Peta memakai tile [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) dengan atribusi pada foto dan membutuhkan internet. Lokasi serta waktu foto berasal dari perangkat; waktu penerimaan juga dicatat terpisah oleh server. Penanda ini merupakan dokumentasi kunjungan, bukan sertifikasi lokasi atau waktu yang kebal manipulasi.

Foto disimpan sebagai JPEG maksimal 5 MB pada bucket privat `credit-followups`. Tautan lihat foto berlaku 5 menit; tutup lalu buka kembali foto jika tautan berakhir. Bukti baru tampil di rekap setelah unggahan foto selesai. Jika koneksi gagal, foto tetap berada pada pratinjau untuk dicoba simpan ulang selama tab terbuka; ID yang sama mencegah duplikasi. Menutup tab sebelum selesai tidak menjamin foto tersimpan dan dapat meninggalkan draft. Pembersihan draft lama belum otomatis.

Identitas kredit dan nama petugas disalin dari database oleh server. Bukti selesai tidak dapat ditimpa melalui akun aplikasi. Riwayat tetap tersedia meskipun data portofolio diimpor ulang atau direset, karena snapshot kredit dipertahankan.

## Menyiapkan ulang di proyek Supabase lain

1. Buat proyek Supabase. Pilih region yang sesuai kebutuhan operasional. Aktifkan Data API, aktifkan RLS, dan hindari pemberian akses otomatis pada tabel baru.
2. Jalankan berurutan di SQL Editor:
   - `supabase/migrations/202610200001_dashboard.sql`
   - `supabase/migrations/202610200002_seed_masters.sql`
   - `supabase/migrations/202610200003_legacy_usernames.sql`
   - `supabase/migrations/202610200004_credit_followups.sql`
   - `supabase/migrations/202610200005_delete_credit_followups.sql`
   - `supabase/migrations/202610200006_legacy_sync.sql`
   - `supabase/migrations/202610200007_legacy_sync_scheduler.sql`
   - `supabase/migrations/202610200008_active_followup_source.sql`
   - `supabase/migrations/202610200009_sync_import_guard.sql`
   - `supabase/migrations/202610200010_required_followup_details.sql`
3. Atur URL dan **publishable/anon key** di `assets/supabase-config.js`.
4. Di Authentication → Sign In / Providers, matikan **Allow new users to sign up**. Akun hanya dibuat admin. Atur minimum password 10 karakter pada provider Email.
5. Deploy fungsi `manage-users` dari `supabase/functions/manage-users/index.ts`. Fungsi memvalidasi JWT dengan `auth.getUser()` dan membaca role dari `app_profiles`; secret server tidak dikirim ke browser.
6. Pada pengaturan fungsi, matikan **Verify JWT with legacy secret** karena fungsi memakai validasi Auth sendiri yang juga mendukung signing key baru. Permintaan tanpa sesi atau dengan token palsu tetap ditolak.
7. Buat admin pertama melalui salah satu cara di bawah.

Dengan Supabase CLI yang sudah login dan terhubung ke proyek tujuan:

```powershell
npx supabase link --project-ref PROJECT_REF
npx supabase db push
npx supabase functions deploy manage-users
```

`supabase/config.toml` berisi pengaturan lokal. Pengaturan Auth proyek remote tetap perlu diperiksa di dashboard atau diterapkan lewat mekanisme konfigurasi CLI yang sesuai.

### Admin pertama melalui dashboard

1. Authentication → Users → Add user → Create new user.
2. Email: `admin@dashboard.local`; pilih sendiri password minimal 10 karakter, dengan **Auto confirm user** aktif.
3. Setelah akun ada, jalankan:

```sql
insert into public.app_profiles(user_id, username, role)
select id, 'admin', 'admin'
from auth.users where email = 'admin@dashboard.local'
on conflict (user_id) do nothing;
```

### Admin pertama melalui alat lokal

Salin `.env.example` menjadi `.env`, lalu isi Project URL, service role/secret key server, username, dan password pilihan sendiri. File ini hanya untuk alat lokal dan sudah dikecualikan dari Git.

```powershell
npm run setup:admin
```

Alat ini menolak menimpa akun yang sudah ada. Setelah login admin, gunakan menu **Kelola & Setting** untuk membuat AO/admin lain. Username lama yang mengandung spasi, misalnya `admin mikro`, tetap didukung. Spasi hanya dikodekan menjadi `%20` pada identitas email internal Auth. Ikon kunci di header mengganti password akun sendiri; ikon kunci pada daftar pengguna mengatur ulang password akun lain.

## Migrasi data Google Sheet / browser lama

Backup sumber tersimpan lokal di folder `migration-backups/`, yang tidak ikut Git maupun server pratinjau. Backup berisi data nasabah sehingga harus disimpan pada perangkat yang aksesnya terkontrol. Password lama sengaja tidak dimasukkan; daftar username/role disertakan untuk pembuatan ulang akun.

Jumlah baris pada ekspor awal tanggal 20 Oktober 2026:

| Dataset | Baris |
| --- | ---: |
| Pencairan | 834 |
| Estimasi | 986 |
| KOL 1 | 347 |
| LAR | 244 |
| NPL | 531 |
| Klaim | 101 |
| Report | 17 |
| **Total** | **3.060** |

Sinkronisasi otomatis kini memperbarui hasil migrasi awal selama perpindahan. Hentikan input ke aplikasi lama saat perpindahan akhir, tunggu proses server terbaru berhasil, tinjau benturan, kemudian hentikan sinkronisasi sebelum memakai Supabase sebagai sumber tunggal. Ekspor awal di atas tetap merupakan backup historis, bukan jumlah terkini.

### Alat migrasi otomatis

Isi `.env` lokal dari `.env.example`. Jangan unggah file ini atau service role/secret key ke GitHub. Isi `LEGACY_SHEET_URL` dengan endpoint Google Apps Script lama, lalu:

```powershell
# Pratinjau, membuat backup; tidak menulis ke Supabase.
npm run migrate:legacy

# Impor backup yang sudah diperiksa ke tujuan yang masih kosong.
npm run migrate:legacy -- --file migration-backups/legacy-TIMESTAMP.json --apply
```

Alat menolak tujuan yang sudah berisi data. Penggantian yang disengaja membutuhkan tambahan `--replace-existing`; backup seluruh tujuan terlebih dahulu dan hentikan input selama penggantian. Hanya dataset yang ada dalam sumber yang diganti. Dataset yang tidak dikirim deployment Apps Script lama tidak akan dikosongkan.

Impor dilakukan dalam batch 250 baris ke area sementara. Fungsi SQL memastikan jumlah baris sesuai manifest sebelum mengganti semua dataset terkait dalam satu transaksi. Kegagalan sebelum commit mempertahankan data lama. Master data diterapkan setelah transaksi dataset; bila tahap master gagal, dataset sudah tersimpan dan master dapat diperbaiki terpisah. Alat memverifikasi jumlah baris tujuan untuk setiap dataset setelah selesai.

### Impor lewat dashboard tanpa service key lokal

```powershell
node scripts/prepare-dashboard-import.mjs migration-backups/legacy-TIMESTAMP.json
```

Pada tabel `dashboard_records` yang **masih kosong**, pilih Import data from CSV dan unggah `migration-backups/dashboard-records.csv`. Kolom CSV hanya `dataset,payload`; UUID dan waktu dibuat otomatis. Jalankan `dashboard-masters.sql` dari folder backup untuk mengisi master asli sumber. Jangan jalankan seed bawaan terlebih dahulu pada alur ini, karena SQL master hasil ekspor sengaja tidak menimpa master yang sudah ada.

Verifikasi:

```sql
select dataset, count(*) from public.dashboard_records group by dataset order by dataset;
select kind, jsonb_array_length(values) as jumlah from public.dashboard_master order by kind;
```

Untuk mencocokkan seluruh isi backup, jalankan `node scripts/verify-backup.mjs migration-backups/legacy-TIMESTAMP.json`, kemudian cocokkan hasil checksum dengan kueri SQL yang dicetak alat tersebut.

Untuk data yang hanya ada di browser lama, buka website pada origin dan profil browser yang sama, lalu unduh backup melalui tombol **Unduh Backup Browser Lama** di menu admin versi baru. Tombol itu membaca salinan lokal saja dan tidak mengunggahnya otomatis. Impor melalui `--file`; tinjau isinya terlebih dahulu agar data server yang lebih baru tidak tertimpa backup browser lama.

Jangan hapus database lama sampai hasil migrasi dan website baru sudah diperiksa. Laporan asuransi yang ditampilkan lewat iframe Looker Studio tetap mengikuti sumber data laporan Looker tersebut; iframe bukan tabel database aplikasi ini.

## Publikasi website

Versi website yang harus diterbitkan bersama:

```text
index.html
assets/supabase-config.js
assets/supabase-client.js
assets/followup-core.js
assets/followup-pdf.js
assets/followup-ui.js
assets/legacy-sync-ui.js
logo.jpeg
CNAME
```

Untuk GitHub Pages, folder `assets` harus ikut commit. Tidak perlu mengunggah `node_modules`, `.env`, `.migration-backup`, `migration-backups`, atau data CSV nasabah. Skema SQL, fungsi server, skrip dan tes boleh disimpan di repository, tetapi data nasabah serta secret harus tetap dikecualikan.

Pastikan admin bisa login, angka dashboard sesuai sumber, dan input percobaan berhasil tersimpan sebelum menerbitkan perubahan ke domain produksi.

## Perawatan

- Gunakan tombol sinkronkan untuk memuat perubahan perangkat lain.
- Jika perubahan master ditolak karena versi berbeda, sinkronkan lalu ulangi perubahan.
- Unggahan yang terputus karena tab ditutup dapat meninggalkan staging. Admin proyek dapat menghapus job lama setelah memastikan tidak ada unggahan aktif:

```sql
delete from public.dashboard_imports where created_at < now() - interval '7 days';
```

- Database sumber tidak lagi dipakai website baru. Tutup deployment Google Apps Script lama setelah perpindahan selesai dan akses lama tidak dibutuhkan.
- Panduan resmi: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth).
