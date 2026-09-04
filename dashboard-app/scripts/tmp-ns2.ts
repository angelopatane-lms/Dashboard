import { richiedi } from "./env";
const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const NO_SHOW="666989041";
async function post(u:string,b:unknown){const r=await fetch(u,{method:"POST",headers:H,body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw new Error(`${r.status} ${d.message??""}`);return d;}
async function main(){
  const da=new Date("2026-05-01").getTime(), a=new Date("2026-10-01").getTime();
  const ids:string[]=[]; let after:string|undefined;
  do{
    const d=await post("https://api.hubapi.com/crm/v3/objects/deals/search",{limit:100,properties:["hs_object_id"],
      sorts:[{propertyName:"createdate",direction:"ASCENDING"}],
      filterGroups:[{filters:[{propertyName:"pipeline",operator:"EQ",value:"433643709"},
        {propertyName:"createdate",operator:"BETWEEN",value:String(da),highValue:String(a)}]}],...(after?{after}:{})});
    for(const r of d.results??[]) ids.push(r.id);
    after=d.paging?.next?.after; await new Promise(r=>setTimeout(r,180));
  } while(after && ids.length<1500);

  const perMese=new Map<string,number>(); const creazione=new Map<string,number>();
  let senzaStoria=0, vociTot=0;
  for(let k=0;k<ids.length;k+=50){
    const d=await post("https://api.hubapi.com/crm/v3/objects/deals/batch/read",{inputs:ids.slice(k,k+50).map(id=>({id})),
      properties:["createdate"],propertiesWithHistory:["dealstage"]});
    for(const r of d.results??[]){
      const st=(r.propertiesWithHistory?.dealstage??[]);
      vociTot+=st.length;
      if(!st.length) senzaStoria++;
      const c=(r.properties?.createdate??"").slice(0,7); if(c) creazione.set(c,(creazione.get(c)??0)+1);
      for(const v of st) if((v.value??"").trim()===NO_SHOW){
        const m=String(v.timestamp).slice(0,7); perMese.set(m,(perMese.get(m)??0)+1);}
    }
    await new Promise(r=>setTimeout(r,120));
  }
  console.log(`Trattative: ${ids.length}   voci di cronologia dealstage: ${vociTot}   senza cronologia: ${senzaStoria}\n`);
  console.log("Creazione trattative per mese:");
  for(const [m,n] of [...creazione].sort()) console.log(`  ${m}  ${String(n).padStart(5)}`);
  console.log("\nIngressi in NO SHOW per mese:");
  for(const [m,n] of [...perMese].sort()) console.log(`  ${m}  ${String(n).padStart(5)}`);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
