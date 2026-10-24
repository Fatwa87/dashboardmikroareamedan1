import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {jsPDF}=require('jspdf');
require('jspdf-autotable').applyPlugin(jsPDF);
export async function pdfApi(){
    const context=vm.createContext({window:{jspdf:{jsPDF}},Intl,Date,setTimeout,clearTimeout,AbortController});
    for(const name of ['followup-core.js','followup-pdf.js'])new vm.Script(await readFile(new URL('../assets/'+name,import.meta.url),'utf8')).runInContext(context);
    return context.window.FollowupPdf;
}
export async function sampleData(){
    const photos=await Promise.all(['landscape','portrait','wide'].map(async(name)=>{
        const data=await readFile(new URL('../tests/fixtures/followup-'+name+'.jpg',import.meta.url));
        const dimensions={landscape:[960,720],portrait:[600,960],wide:[960,480]}[name];
        return {data:'data:image/jpeg;base64,'+data.toString('base64'),width:dimensions[0],height:dimensions[1]};
    }));
    const rows=Array.from({length:9},(_,index)=>({
        id:'sample-'+index,dataset:['kol1','lar','npl'][index%3],branch:index<6?'CP CONTOH MEDAN':'CP CONTOH BINJAI',
        cif:String(index+1).padStart(8,'0'),credit_no:'0000000000123456'+String(index).padStart(2,'0'),
        customer_name:'NASABAH SIMULASI '+String.fromCharCode(65+index),officer_name:['Ahmad Petugas Contoh','Siti Petugas Lapangan Contoh'][index%2],actor_name:['petugas.contoh1','petugas.contoh2'][index%2],actor_id:'actor-'+index%2,
        captured_at:`2026-10-20T0${index}:15:00Z`,latitude:3.589,longitude:98.673,accuracy_m:12,
        notes:index===4?'CONTOH SIMULASI. Nasabah ditemui di lokasi usaha. Petugas menjelaskan rincian tunggakan dan mencatat rencana pembayaran. Nasabah menyampaikan akan melakukan pembayaran melalui outlet terdekat pada tanggal yang disepakati. Tindak lanjut berikutnya dijadwalkan oleh petugas cabang.':index===7?'CONTOH SIMULASI. Foto tegak dipertahankan utuh, termasuk keterangan lokasi dan waktu.':'CONTOH SIMULASI. Nasabah ditemui; tindak lanjut dicatat untuk kunjungan berikutnya.',
        photo_path:'sample-'+index+'.jpg'
    }));
    return {rows,photos:rows.map((_,index)=>photos[index%3]),filters:{branch:'',dataset:'',start:'2026-10-20',end:'2026-10-20'},now:new Date('2026-10-20T10:30:00Z')};
}
