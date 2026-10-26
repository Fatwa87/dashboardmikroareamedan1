(function () {
    'use strict';
    const Core = window.FollowupCore;
    const PHOTO_BOX = Object.freeze({width:49,height:31});
    const COLUMN_WIDTHS = Object.freeze([8,24,51,40,26,67,57]);
    function cancelled() { const error=new Error('Pembuatan PDF dibatalkan.');error.name='AbortError';return error; }
    function checkSignal(signal) { if(signal?.aborted)throw cancelled(); }
    function pdfText(value) {
        return String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
            .replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[\u2022\u00b7]/g,' | ')
            .replace(/\u00a0/g,' ').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g,'?');
    }
    function fitPhoto(width,height,boxWidth=PHOTO_BOX.width,boxHeight=PHOTO_BOX.height) {
        if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Ukuran foto tidak valid.');
        const scale=Math.min(boxWidth/width,boxHeight/height);
        return {width:width*scale,height:height*scale};
    }
    function timed(promise,signal) {
        return new Promise((resolve,reject)=>{
            let timer;
            const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
            const abort=()=>{stop();reject(cancelled());};
            if(signal?.aborted)return abort();
            timer=setTimeout(()=>{stop();reject(new Error('Waktu memuat foto habis. Periksa koneksi lalu coba lagi.'));},20000);
            signal?.addEventListener('abort',abort,{once:true});
            Promise.resolve(promise).then(value=>{stop();resolve(value);},error=>{stop();reject(error);});
        });
    }
    function loadPhoto(url,signal) {
        return new Promise((resolve,reject)=>{
            const image=new Image();let timer;
            const cleanup=()=>{clearTimeout(timer);image.onload=null;image.onerror=null;signal?.removeEventListener('abort',abort);};
            const fail=error=>{cleanup();image.src='';reject(error);};
            const abort=()=>fail(cancelled());
            if(signal?.aborted)return abort();
            signal?.addEventListener('abort',abort,{once:true});
            timer=setTimeout(()=>fail(new Error('Foto belum selesai dimuat. Periksa koneksi lalu coba lagi.')),20000);
            image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
            image.onerror=()=>fail(new Error('Foto tidak dapat diakses. Muat ulang rekap lalu coba lagi.'));
            image.onload=()=>{
                try {
                    checkSignal(signal);
                    const width=image.naturalWidth,height=image.naturalHeight;
                    fitPhoto(width,height);
                    const scale=Math.min(1,960/Math.max(width,height));
                    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
                    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
                    context.drawImage(image,0,0,canvas.width,canvas.height);
                    const data=canvas.toDataURL('image/jpeg',.86);
                    cleanup();resolve({data,width:canvas.width,height:canvas.height});
                }catch(error){fail(error);}
            };
            image.src=url;
        });
    }
    async function preparePhotos(rows,{getPhotoUrl,signal,onProgress=()=>{},readPhoto=loadPhoto}={}) {
        checkSignal(signal);
        const controller=new AbortController();
        const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        const photos=new Array(rows.length);let next=0,completed=0,firstError=null;
        onProgress({completed,total:rows.length});
        const worker=async()=>{
            while(next<rows.length&&!controller.signal.aborted){
                const index=next++;
                try {
                    const url=await timed(getPhotoUrl(rows[index].photo_path),controller.signal);
                    checkSignal(controller.signal);
                    photos[index]=await timed(readPhoto(url,controller.signal),controller.signal);
                    checkSignal(controller.signal);completed++;onProgress({completed,total:rows.length});
                }catch(error){
                    if(!firstError)firstError=error.name==='AbortError'?error:new Error(`Foto pada baris ${index+1} gagal dimuat. ${error.message}`);
                    controller.abort();return;
                }
            }
        };
        try {
            await Promise.all(Array.from({length:Math.min(3,rows.length)},worker));
            checkSignal(signal);if(firstError)throw firstError;
            return photos;
        }finally{signal?.removeEventListener('abort',abort);controller.abort();}
    }
    function createDocument({rows,photos,filters={},now=new Date()}) {
        if(!rows.length)throw new Error('Tidak ada tindak lanjut sesuai filter.');
        if(photos.length!==rows.length||rows.some((_,index)=>!photos[index]?.data))throw new Error('Seluruh foto harus selesai dimuat sebelum mencetak.');
        if(!window.jspdf?.jsPDF)throw new Error('Pustaka PDF belum siap. Muat ulang halaman.');
        const doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
        if(typeof doc.autoTable!=='function')throw new Error('Pustaka tabel PDF belum siap. Muat ulang halaman.');
        doc.setProperties({title:'Rekap Tindak Lanjut Kredit',subject:'Rekap kunjungan dengan bukti foto',author:'PT. Pegadaian Area Medan 1',creator:'Dashboard Mikro Area Medan 1'});
        const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
        const uniqueCustomers=new Set(rows.map(row=>`${row.branch}|${row.credit_no}`)).size;
        const printedAt=pdfText(Core.formatTime(now));
        const catLabel = (filters.dataset === 'arrumExp' || filters.dataset === 'arrum') ? 'Arrum Exspres Loan' : (Core.LABELS[filters.dataset] || 'Semua Kategori');
        const subtitle=pdfText(`Cabang: ${filters.branch||'Semua Cabang'} | Kategori: ${catLabel}`);
        const period=pdfText(`Periode foto: ${filters.start||'Awal'} s.d. ${filters.end||'Sekarang'}`+(filters.search?` | Pencarian: ${filters.search.slice(0,70)}`:''));
        const header=()=>{
            doc.setFillColor(0,135,68);doc.rect(12,9,pageWidth-24,1.4,'F');
            doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(0,115,65);doc.text('PT. PEGADAIAN AREA MEDAN 1',12,15);
            doc.setFontSize(13);doc.setTextColor(15,23,42);doc.text('REKAP TINDAK LANJUT KREDIT',12,21);
            doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(100,116,139);
            doc.text(`Dicetak: ${printedAt}`,pageWidth-12,15,{align:'right'});
            doc.text(subtitle,12,27);doc.text(period,12,31);
            doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(0,115,65);
            doc.text(`${rows.length} BUKTI FOTO  |  ${uniqueCustomers} NASABAH  |  ${new Set(rows.map(Core.officerIdentity)).size} PETUGAS`,12,37);
            doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(100,116,139);
            doc.text('Foto utuh, proporsi asli | Waktu foto dalam WIB',pageWidth-12,37,{align:'right'});
        };
        const drawnPhotos=new Set();
        doc.autoTable({
            head:[['No.','Waktu Foto (WIB)','Nasabah / Identitas Kredit','Kategori / Cabang','Nama Petugas','Lokasi / Catatan Tindak Lanjut','Foto Tindak Lanjut']],
            body:rows.map((row,index)=>{
                const isArrum = row.dataset === 'arrumExp' || row.dataset === 'arrum' || (filters.arrumCreditNos && filters.arrumCreditNos.has(String(row.credit_no).trim())) || /ARRUM\s*EXPR?ES\s*LOAN/i.test(row.notes || '');
                const rowCat = isArrum ? 'Arrum Exspres Loan' : (Core.LABELS[row.dataset] || row.dataset || '-');
                return [
                    String(index+1),pdfText(Core.formatTime(row.captured_at)).replace(', ','\n'),
                    pdfText(`${row.customer_name}\nCIF: ${row.cif||'-'}\nKredit: ${row.credit_no}`),
                    pdfText(`${rowCat}\n${row.branch}`),pdfText(`${Core.officerName(row)}\nAkun: ${row.actor_name}`),
                    pdfText(`GPS: ${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)}\nAkurasi: +/-${Math.round(row.accuracy_m)} m\n\n${row.notes||'Tidak ada catatan.'}`),''
                ];
            }),
            startY:42,margin:{top:42,right:12,bottom:12,left:12},tableWidth:273,
            theme:'grid',showHead:'everyPage',rowPageBreak:'avoid',
            styles:{font:'helvetica',fontSize:7.2,textColor:[30,41,59],lineColor:[215,223,230],lineWidth:.12,cellPadding:2.2,valign:'middle',overflow:'linebreak',minCellHeight:36.5},
            headStyles:{fillColor:[0,115,65],textColor:[255,255,255],fontStyle:'bold',fontSize:7.2,halign:'left',minCellHeight:8,cellPadding:1.5},
            alternateRowStyles:{fillColor:[247,250,249]},
            columnStyles:Object.fromEntries(COLUMN_WIDTHS.map((width,index)=>[index,{cellWidth:width,...(index===0?{halign:'center'}:index===2?{fontStyle:'bold'}:index===6?{cellPadding:2.5}: {})}])),
            willDrawPage:header,
            didDrawCell:data=>{
                const index=Number(data.row.raw[0])-1;
                if(data.section!=='body'||data.column.index!==6||drawnPhotos.has(index))return;
                const photo=photos[index];
                const size=fitPhoto(photo.width,photo.height,Math.min(PHOTO_BOX.width,data.cell.width-5),Math.min(PHOTO_BOX.height,data.cell.height-5));
                const x=data.cell.x+(data.cell.width-size.width)/2,y=data.cell.y+(data.cell.height-size.height)/2;
                doc.setFillColor(255,255,255);doc.setDrawColor(205,217,210);doc.roundedRect(x-.35,y-.35,size.width+.7,size.height+.7,.6,.6,'FD');
                doc.addImage(photo.data,'JPEG',x,y,size.width,size.height,`followup-${index}`,'FAST');
                drawnPhotos.add(index);
            }
        });
        if(drawnPhotos.size!==rows.length)throw new Error('Sebagian foto belum masuk ke PDF. Coba cetak ulang.');
        const pages=doc.internal.getNumberOfPages();
        for(let page=1;page<=pages;page++){
            doc.setPage(page);doc.setDrawColor(215,223,230);doc.setLineWidth(.15);doc.line(12,pageHeight-9,pageWidth-12,pageHeight-9);
            doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(100,116,139);
            doc.text('Dokumen internal - bukti tindak lanjut kredit',12,pageHeight-5);
            doc.text(`Halaman ${page} dari ${pages}`,pageWidth-12,pageHeight-5,{align:'right'});
        }
        return doc;
    }
    async function exportReport({rows,filters,getPhotoUrl,signal,onProgress,save=true,now,readPhoto}) {
        if(!rows.length)throw new Error('Tidak ada tindak lanjut sesuai filter.');
        const photos=await preparePhotos(rows,{getPhotoUrl,signal,onProgress,readPhoto});
        checkSignal(signal);
        const doc=createDocument({rows,photos,filters,now});
        checkSignal(signal);
        if(save)doc.save('Rekap_Tindak_Lanjut_Foto.pdf');
        return doc;
    }
    window.FollowupPdf=Object.freeze({PHOTO_BOX,COLUMN_WIDTHS,pdfText,fitPhoto,preparePhotos,createDocument,exportReport});
}());
