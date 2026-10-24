import {mkdir,writeFile} from 'node:fs/promises';
import {pdfApi,sampleData} from './followup-pdf-fixture.mjs';
const api=await pdfApi(),sample=await sampleData();
const doc=api.createDocument(sample);
await mkdir(new URL('../output/pdf/',import.meta.url),{recursive:true});
const target=new URL('../output/pdf/Contoh_Rekap_Tindak_Lanjut_Foto.pdf',import.meta.url);
await writeFile(target,Buffer.from(doc.output('arraybuffer')));
console.log('Contoh simulasi:',target.pathname,'| halaman:',doc.internal.getNumberOfPages());
