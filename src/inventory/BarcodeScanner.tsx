import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function BarcodeScanner({onDetected,onClose}:{onDetected:(value:string)=>void;onClose:()=>void}) {
  const video=useRef<HTMLVideoElement>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true; let controls:{stop:()=>void}|undefined;
    const reader=new BrowserMultiFormatReader();
    async function start(){
      try{
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is not available in this browser.');
        controls=await reader.decodeFromVideoDevice(undefined,video.current!,result=>{
          if(!active||!result)return;
          const value=result.getText().trim();
          if(value){active=false;controls?.stop();onDetected(value);}
        });
      }catch(err){if(active)setError(err instanceof Error?err.message:'Unable to start the camera. Check camera permission and try again.');}
    }
    void start();
    return()=>{active=false;controls?.stop();};
  },[onDetected]);
  return <div className="modal-backdrop scanner-backdrop" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
    <section className="scanner-card">
      <div className="section-head"><div><span className="eyebrow">BARCODE INPUT</span><h2 id="scanner-title">Scan a product</h2><p>Point the rear camera at the barcode and keep it inside the frame.</p></div><button className="icon-btn" type="button" aria-label="Close scanner" onClick={onClose}>×</button></div>
      <div className="scanner-view"><video ref={video} muted playsInline autoPlay/><div className="scanner-guide"/></div>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <p className="muted">If camera scanning is unavailable, use a USB/Bluetooth barcode scanner or enter the barcode manually.</p>
      <button type="button" className="secondary full" onClick={onClose}>Close scanner</button>
    </section>
  </div>;
}
