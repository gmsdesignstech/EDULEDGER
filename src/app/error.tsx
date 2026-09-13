"use client";
import { useEffect } from "react";

export default function AppError({error,retry}:{error:Error&{digest?:string};retry:()=>void}){
 useEffect(()=>{console.error("Application rendering failed",{digest:error.digest})},[error]);
 return <main className="grid min-h-screen place-items-center bg-canvas p-6"><section className="card max-w-lg p-8 text-center"><p className="label">Temporary problem</p><h1 className="mt-3 text-2xl font-black">We could not load this page</h1><p className="mt-2 text-sm text-muted">Your data has not been changed. Try loading the page again.</p>{error.digest&&<p className="mt-3 text-xs text-muted">Reference: {error.digest}</p>}<button className="btn-primary mt-6" onClick={()=>retry()}>Try again</button></section></main>;
}
