import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfApi,sampleData} from '../scripts/followup-pdf-fixture.mjs';

test('PDF preserves photo proportions and embeds every image once with exact A4 column widths',async()=>{
    const api=await pdfApi(),sample=await sampleData();
    assert.ok(Math.abs(api.COLUMN_WIDTHS.reduce((a,b)=>a+b,0)-273)<.001);
    for(const [width,height] of [[960,720],[600,960],[960,480]]){
        const fit=api.fitPhoto(width,height);assert.ok(fit.width<=49+.00001&&fit.height<=31+.00001);assert.ok(Math.abs(fit.width/fit.height-width/height)<.00001);
    }
    assert.throws(()=>api.fitPhoto(0,100),/Ukuran foto/);
    const doc=api.createDocument(sample),pages=doc.internal.getNumberOfPages();
    assert.equal(pages,3,'Nine standard rows should fit into three compact pages');
    assert.equal(Object.keys(doc.internal.collections.addImage_images).length,9,'Each evidence image is embedded in PDF bytes');
    const text=doc.internal.pages.slice(1).join('\n');
    for(let page=1;page<=pages;page++){
        assert.ok(doc.internal.pages[page].join('\n').includes('REKAP TINDAK LANJUT KREDIT'));
        assert.ok(doc.internal.pages[page].join('\n').includes(`Halaman ${page} dari ${pages}`));
    }
    sample.rows.forEach(row=>assert.ok(text.includes(row.credit_no),'Leading zeroes and full contract numbers must be retained'));
    assert.ok(text.includes('Ahmad Petugas'));assert.ok(text.includes('Akun:'),'Entered officer and uploader account must both be printed');
    assert.ok(!text.includes('https://'),'Signed storage links must not be written into portable PDF');
    assert.throws(()=>api.createDocument({...sample,photos:sample.photos.slice(1)}),/Seluruh foto/);
    const long=api.createDocument({...sample,rows:[{...sample.rows[0],notes:'CATATAN LENGKAP. '.repeat(120)}],photos:[sample.photos[0]]});
    assert.equal(Object.keys(long.internal.collections.addImage_images).length,1,'Long notes must not duplicate the photo on continuation pages');
});

test('PDF photo loading limits concurrency, keeps order and fails rather than silently omitting evidence',async()=>{
    const api=await pdfApi();let active=0,max=0;const progress=[];
    const rows=Array.from({length:8},(_,index)=>({photo_path:String(index)}));
    const photos=await api.preparePhotos(rows,{getPhotoUrl:async path=>'signed-'+path,onProgress:p=>progress.push(p.completed),readPhoto:async url=>{
        active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,Number(url.at(-1))%2?3:9));active--;return {data:url,width:960,height:720};
    }});
    assert.equal(max,3);assert.equal(photos.map(p=>p.data).join(','),rows.map(row=>'signed-'+row.photo_path).join(','));assert.equal(progress.at(-1),8);
    await assert.rejects(api.exportReport({rows,save:false,getPhotoUrl:async()=>{throw Error('Izin foto ditolak');},readPhoto:async()=>{throw Error('Must not read');}}),/baris 1 gagal dimuat.*Izin foto ditolak/);
    const controller=new AbortController();
    const pending=api.preparePhotos(rows,{getPhotoUrl:async p=>p,signal:controller.signal,readPhoto:(_url,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{const error=Error('cancelled');error.name='AbortError';reject(error);},{once:true});})});
    controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
});
