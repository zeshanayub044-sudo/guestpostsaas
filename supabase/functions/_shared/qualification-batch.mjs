export async function settleQualificationBatch(run) {
 // Wait for every claimed lease before ending the Edge invocation. A rejected
 // sibling must not abandon checks that are still persisting their outcomes.
 const settled=await Promise.allSettled(Array.from({length:8},()=>Promise.resolve().then(run)));
 const results=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
 return {processed:results.reduce((n,r)=>n+r.processed,0),results,failed:settled.filter(r=>r.status==='rejected').length};
}
