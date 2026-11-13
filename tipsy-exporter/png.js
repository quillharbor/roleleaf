(function (root) {
  'use strict';
  const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const crcTable = new Uint32Array(256);
  for (let n=0; n<256; n++) {
    let c=n;
    for (let k=0; k<8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function base64(bytes) {
    let s='';
    for (let i=0;i<bytes.length;i+=8192) s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(s);
  }
  function chunks(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 20 || !signature.every((v,i)=>v===bytes[i])) throw new Error('Invalid PNG image');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out=[];
    let offset=8, ended=false;
    while (offset+12<=bytes.length) {
      const length=view.getUint32(offset), end=offset+12+length;
      if (end>bytes.length) throw new Error('PNG data is incomplete');
      const type=decoder.decode(bytes.subarray(offset+4,offset+8));
      const data=bytes.subarray(offset+8,end-4);
      if (crc32(bytes.subarray(offset+4,end-4))!==view.getUint32(end-4)) throw new Error('PNG checksum failed');
      out.push({type,data,bytes:bytes.subarray(offset,end)});
      offset=end;
      if(type==='IEND'){ended=true;break;}
    }
    if(!ended || offset!==bytes.length || out[0]?.type!=='IHDR' || !out.some(c=>c.type==='IDAT')) throw new Error('PNG structure is incomplete');
    return out;
  }
  function chunk(type,data) {
    const bytes=new Uint8Array(data.length+12),v=new DataView(bytes.buffer);
    v.setUint32(0,data.length);bytes.set(encoder.encode(type),4);bytes.set(data,8);
    v.setUint32(bytes.length-4,crc32(bytes.subarray(4,bytes.length-4)));
    return bytes;
  }
  function embed(bytes,card) {
    const items=chunks(bytes), metadata=encoder.encode('chara\0'+base64(encoder.encode(JSON.stringify(card))));
    const parts=[signature];
    for(const item of items){
      if(['tEXt','iTXt','zTXt'].includes(item.type)){
        const zero=item.data.indexOf(0),key=decoder.decode(item.data.subarray(0,zero));
        if(key==='chara'||key==='ccv3')continue;
      }
      if(item.type==='IEND')parts.push(chunk('tEXt',metadata));
      parts.push(item.bytes);
    }
    const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;
    for(const part of parts){result.set(part,offset);offset+=part.length;}
    return result;
  }
  root.TipsyExporterPNG=Object.freeze({embed,chunks,crc32,base64});
})(globalThis);
