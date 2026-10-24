# Hasil migrasi — 20 Oktober 2026

## Perbaikan unggah/reset Excel — 21 Oktober 2026

- Migrasi `202610210011_excel_dataset_ownership.sql` mengizinkan impor/reset admin saat sinkronisasi lama aktif. Kategori yang berhasil diganti diambil alih Supabase secara atomik; sinkronisasi lama melewati kategori itu, termasuk identitas nasabah baru dari sumber lama. Kategori lain tetap disinkronkan.
- Upload/Reset Mikro mencakup KOL 1, LAR, NPL, dan klaim. Upload/Reset Report hanya report. Pengguna cukup mengunggah Excel baru tanpa reset terlebih dahulu. Notice dan konfirmasi reset menjelaskan perilaku ini; panel sinkronisasi tetap tersembunyi.
- Validasi jumlah staging/manifest, role admin, serta rollback data dan kepemilikan tetap diberlakukan. Urutan penguncian sesuai Cron agar penggantian tidak berbenturan dengan sinkronisasi. Riwayat foto dan catatan tindak lanjut tetap tersimpan.
- Kompilasi dan 24 tes lulus: impor/reset saat aktif, sumber lama tidak mengisi ulang, kategori lain tetap bertambah, retry tanpa duplikasi, akses ditolak, staging tidak lengkap, kegagalan penyimpanan mengembalikan data dan kepemilikan, serta bukti foto tetap terbaca setelah reset. Pengujian reset menggunakan database simulasi, bukan data nasabah live.

Pembaruan tampilan: panel **Sinkronisasi Otomatis Database Lama** telah disembunyikan dari Kelola & Setting sesuai permintaan pemilik. Jadwal sinkronisasi server tetap aktif; kartu koneksi Supabase dan fitur lainnya tetap tersedia.

**Pemilik menyetujui publikasi pembaruan ke repository `Fatwa87/dashboardmikroareamedan1`, branch `main`, pada 20 Oktober 2026. Bagian di bawah mencatat tahapan sebelumnya; sinkronisasi otomatis tetap aktif selama perpindahan.**

- Proyek: `dashboard-mikro-area-medan1` / `mmxuotrfgzmdhyrfpsqs`.
- Supabase URL: https://mmxuotrfgzmdhyrfpsqs.supabase.co
- Skema PostgreSQL, RLS, fungsi impor atomik, dan kompatibilitas username lama sudah diterapkan.
- Master asli sumber sudah dipasang: 31 AO, 17 admin mikro, 17 cabang, dan 11 produk.
- Akun `admin` sudah dibuat dan login dashboard lokal berhasil.
- Fungsi `manage-users` sudah diterbitkan. Pendaftaran publik dinonaktifkan, password baru minimal 10 karakter.
- Dua puluh dua pengujian lokal lulus. Pemeriksaan API live menolak akses anonim ke keenam tabel, RPC begin/submit/hapus tindak lanjut dan kontrol sinkronisasi; fungsi akun menolak permintaan tanpa token/token palsu.
- Dashboard lokal menampilkan 834 pencairan dan 986 estimasi; panel admin memakai Supabase Auth tanpa daftar password.

Seluruh dataset berikut cocok **jumlah baris dan checksum isi JSONB** dengan backup sumber:

| Dataset | Baris | Checksum |
| --- | ---: | --- |
| estimasi | 986 | `bd39a8a8b8f78e3284ba85eddc1efc1a` |
| klaim | 101 | `6c067b7833824dcd396bf0e7201e31fc` |
| kol1 | 347 | `e9c29897ce4a2a2887c1551a7bc22c25` |
| lar | 244 | `88e7f5adfc8263667b334e58e2f78885` |
| npl | 531 | `57adf0f67b39efe39f333aebc5cc6ae4` |
| pencairan | 834 | `78718f3ebfbda897ec8880cf7d5b334f` |
| report | 17 | `d6eeaf464f9d27fef3bbe007cb102ddf` |
| **Total** | **3.060** | |

Backup sumber lokal: `migration-backups/legacy-1792472139078.json`. Password lama tidak dimasukkan ke backup atau tabel aplikasi baru. Akun `admin mikro` dan `mikro` dari daftar lama dapat dibuat melalui menu admin dengan password baru; username yang mengandung spasi didukung.

Jalankan `npm start`, lalu buka http://127.0.0.1:4173. Gunakan username `admin` dengan password yang dibuat sendiri.

Website produksi masih memakai versi dan database lama. Sinkronisasi server otomatis kini membaca pembaruan sumber lama ke Supabase setiap 5 menit; perpindahan akhir tetap memerlukan pemeriksaan proses terakhir dan penghentian sinkronisasi sebelum memakai versi baru sebagai sumber tunggal.

Panduan operasional, alat migrasi, dan cara publikasi ada pada `README.md`. Paket website siap publikasi berada di `.migration-backup/dashboard-supabase-deploy.zip`; tidak berisi data nasabah atau secret server.

## Tambahan tindak lanjut kredit

- Tombol **Tindak Lanjut** ditambahkan di sebelah Cetak PDF pada KOL 1, LAR 11–30 Hari, dan NPL (KOL 3–5). Cabang harus dipilih; popup mengikuti cabang itu dan memuat CIF, nomor kredit, nama nasabah, serta Lampirkan Foto.
- Kamera langsung terbuka dari Lampirkan Foto. Foto memuat peta, koordinat dan akurasi GPS, waktu WIB, cabang/kredit, dan petugas; catatan opsional tersedia sebelum simpan.
- Admin mendapat menu **Rekap Tindak Lanjut** dengan filter, tampilan foto privat, tautan peta, ekspor CSV, dan PDF.
- Migrasi `202610200004_credit_followups.sql` sudah diterapkan pada proyek Supabase ini. Bucket `credit-followups` bersifat privat, JPEG maksimal 5 MB. Bukti selesai hanya dapat dibaca pemiliknya atau admin; akses anonim ditolak.
- Penyimpanan memakai draft → unggah foto → submit. Percobaan ulang tidak menggandakan bukti; impor/reset portofolio tidak menghilangkan snapshot riwayat.
- UI aktual diverifikasi pada CP MEDAN UTAMA: popup KOL 1 berisi 15 kredit, LAR 7 kredit, NPL 17 kredit. Alur foto, kegagalan/percobaan ulang, penanda peta, dan rekap admin diuji lewat fixture browser yang jelas berlabel simulasi dan tidak mengirim data ke Supabase. Kamera/GPS fisik masih perlu dicoba pada perangkat pengguna.
- `npm run check`, seluruh 14 tes, dan pemeriksaan API live lulus. Tes mencakup RLS bukti/foto, penolakan data kredit palsu, larangan submit tanpa foto, akses antarpetugas, riwayat setelah data sumber dihapus, dan percobaan ulang setelah unggahan gagal.
- Tetap versi lokal; belum diterbitkan ke domain produksi. Refresh dashboard lokal untuk memuat fitur baru. Panduan izin kamera/lokasi dan kebutuhan HTTPS tersedia di README.

## Tombol hapus rekap — 20 Oktober 2026

- Tombol **Hapus** tersedia di setiap baris Rekap Tindak Lanjut, di sebelah Lihat Foto, khusus admin. Dialog konfirmasi memuat identitas kredit, waktu foto, dan petugas. Pembatalan mempertahankan bukti; kesalahan koneksi tetap menampilkan dialog untuk dicoba ulang.
- Migrasi `202610200005_delete_credit_followups.sql` sudah diterapkan. Fungsi hapus hanya menerima admin dan mencatat `deleted_at`/`deleted_by`; AO dan anonim ditolak oleh server. Percobaan ulang hapus tidak mengubah jejak admin/waktu pertama.
- Bukti yang dihapus hilang dari rekap, hitungan, pencarian, dan ekspor. Admin maupun pemilik foto tidak dapat menerbitkan tautan foto baru. Tautan yang telah diterbitkan dapat tetap berlaku sampai 5 menit.
- Arsip baris dan objek foto tetap tersimpan untuk pemulihan oleh pengelola proyek; data kredit nasabah tidak ikut dihapus. Petunjuk pemulihan ada di README.
- Pembatalan, kegagalan koneksi, dan keberhasilan hapus diuji dengan data browser simulasi. Tidak ada bukti kunjungan nasabah live yang dihapus saat pengujian.

## Sinkronisasi otomatis — 20 Oktober 2026

- Migrasi 006–009 sudah diterapkan. Job server `dashboard-legacy-sync` aktif, memeriksa jadwal tiap menit dan menarik pembaruan sumber setiap 5 menit. Tidak bergantung pada komputer ini dan tidak menulis ke Google Sheet.
- Bootstrap menautkan 3.060 baris migrasi awal. Proses Cron live sudah berhasil berulang tanpa benturan, tanpa perubahan yang digandakan. Pada pemeriksaan pukul 17.31 WIB, ringkasan sumber menunjukkan pencairan 859 dan estimasi 988; monitoring tetap KOL 1 347, LAR 244, NPL 531, klaim 101, report 17. Angka sumber dapat terus berubah selama dashboard lama dipakai.
- Baris asli Supabase, penghapusan lokal, dan master yang berubah di kedua sistem dilindungi. Penghapusan sumber menjadi arsip tersembunyi melalui RLS, bukan penghapusan fisik. Bukti tindak lanjut dipertahankan; sumber portofolio yang sudah diarsipkan tidak boleh dipakai untuk foto baru.
- Admin mendapat panel pada Kelola & Setting untuk melihat hasil/waktu, meminta sinkronisasi sekarang, mengaktifkan, atau menghentikan dengan konfirmasi. Setelah proses baru selesai ketika panel terbuka, data dashboard dimuat ulang. Menu lain memakai tombol sinkronkan dashboard/muat ulang.
- Impor/reset Excel dan migrasi penggantian diblokir saat sinkronisasi aktif. Hentikan sinkronisasi dahulu sebelum sengaja mengganti sumber data Supabase.
- Schema privat, RLS, role admin untuk kontrol, rollback saat respons gagal, duplikat sumber, penghapusan lokal, data native, master bentrok, interval dan penghentian sudah diuji. Total 16 tes lokal. Uji snapshot backup asli lokal juga mencocokkan delta 6 pencairan dan 2 estimasi pada saat pengambilan backup, dengan pengulangan tanpa perubahan/duplikasi.
- Tetap belum ada publikasi website produksi atau push repository. Pada cutover akhir: hentikan input lama, minta sinkronisasi final, cocokkan hasil dan selesaikan benturan, hentikan sinkronisasi, lalu terbitkan versi baru.

## Foto pada PDF rekap tindak lanjut — 20 Oktober 2026

- Cetak PDF rekap admin sekarang menyertakan foto di setiap baris pada A4 mendatar. Ukuran maksimum gambar 49 × 31 mm, tanpa pemotongan atau perubahan rasio; umumnya empat baris biasa per halaman. Kolom data dan catatan tetap terbaca, judul tabel diulang, serta nomor halaman dihitung setelah dokumen selesai.
- Foto dibaca dengan URL privat sementara, diperkecil sampai 960 piksel pada sisi terpanjang, kemudian ditanam dalam PDF. Tidak ada URL bertanda tangan yang disimpan di PDF. Muat foto dibatasi tiga sekaligus, ada progres dan pembatalan. Kegagalan satu foto membatalkan penerbitan seluruh PDF agar bukti tidak diam-diam hilang.
- Contoh sembilan bukti simulasi menghasilkan tiga halaman dengan pembagian gambar 4/4/1. Seluruh halaman dirender dan diperiksa; validasi posisi gambar, rasio, sembilan nomor kredit lengkap, catatan panjang, pengulangan header dan footer lulus. Fixture menggunakan foto mendatar, tegak, dan lebar; tanpa nasabah atau bukti kunjungan asli.
- Pengujian browser memeriksa gagal memuat foto dan pembatalan. Pengujian generator PDF memakai versi jsPDF/AutoTable yang sama dengan CDN aplikasi. Total 18 tes lokal lulus. Tidak perlu perubahan database untuk fitur ini.
- Contoh PDF: `output/pdf/Contoh_Rekap_Tindak_Lanjut_Foto.pdf` (file simulasi, diabaikan Git). Paket website lokal telah diperbarui; belum ada push repository atau publikasi produksi.

## Catatan dan nama petugas wajib — 20 Oktober 2026

- Di bawah pratinjau foto terdapat notice wajib dan dua kolom: Catatan Tindak Lanjut, lalu Nama Petugas. Tombol simpan nonaktif jika salah satu belum diisi, termasuk input spasi/whitespace saja. Batas catatan 2.000 karakter dan nama 120 karakter.
- Migrasi `202610200010_required_followup_details.sql` sudah diterapkan. Nama pelaksana disimpan pada `officer_name`; akun Auth pengunggah tetap disimpan terpisah. Pemeriksaan server menolak draft/submission baru tanpa kedua kolom, termasuk pemanggilan API atau klien lama yang tidak mengirim nama.
- `form_version=1` mempertahankan bukti historis; bukti baru memakai versi 2 dengan constraint wajib. Draft lama harus dilengkapi sebelum submit. Retry draft dapat memperbarui isian; bukti yang sudah submitted tetap tidak berubah.
- Nama pelaksana tampil di rekap, pencarian, detail foto, PDF dan CSV; akun pengunggah tetap terlihat untuk audit. Label watermark foto baru menyebut Akun agar tidak tertukar dengan nama pelaksana yang diisi setelah pengambilan foto.
- Pengujian browser dengan kamera/GPS simulasi memeriksa kosong, catatan saja, nama berisi spasi, dan isian lengkap; catatan/nama yang disimpan muncul di rekap admin. Tidak ada bukti kunjungan live yang dibuat dalam uji ini.
- Seluruh 20 tes, kompilasi, dan pemeriksaan API live lulus. PDF contoh diperbarui dengan nama lengkap pelaksana dan akun terpisah; tetap 3 halaman dengan 9 foto (4/4/1), seluruh halaman sudah diperiksa.
- Tetap versi lokal; belum ada push repository atau publikasi produksi. Refresh aplikasi untuk memuat formulir baru.

## Minimum password 10 karakter — 20 Oktober 2026

- Penambahan akun, reset password admin, dan penggantian password sendiri memakai minimum 10 karakter. Pesan/form aplikasi, adapter, setup admin, konfigurasi lokal, dan fungsi server sudah disamakan.
- Pengaturan Email Supabase live telah disimpan pada minimum 10 karakter; fungsi manage-users telah diterbitkan ulang. Password akun yang sudah ada tetap berlaku.
- Pemeriksaan sintaks dan 22 tes lulus, termasuk batas 9 karakter ditolak dan tepat 10 karakter diterima pada pembuatan, reset, serta ganti password dengan Auth simulasi. Tidak ada password akun live yang diganti untuk pengujian.
- Website tetap disimpan lokal dan belum dipublikasikan ke repository/domain produksi.
