import {getWritable} from "workflow";
import {worldTool} from "@/lib/world-agent";
export type PlayerTurnInput={session:string;worldId:string;action:string;turnId:string;providerUrl:string;apiKey:string;models:Record<string,string>};
type Prepared={workflowRunId:string;context:any;scenes:any;schema:any};
type Draft={narration:string;commitPayload:any;claims:any[];checks:any[];requiresClarification:boolean;clarification?:string|null};
type Result={ok:boolean;committed:boolean;turnId:string;narration?:string;clarification?:string;error?:string;commitOutcomeUncertain?:boolean;issues?:any[]};
const DEFAULTS={director:"minimaxai/minimax-m3.1-flash",characters:"minimaxai/minimax-m3.1-flash",drama:"minimaxai/minimax-m3.1-flash",writer:"stepfun-ai/step-5-preview",continuity:"nvidia/nemotron-3-ultra-550b-a55b"};
function provider(value:string){const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password)throw Error("provider_url_rejected");const h=u.hostname.toLowerCase(),a=["nvidia.com","openrouter.ai","deepseek.com","mistral.ai","groq.com","together.xyz","fireworks.ai","cerebras.ai","sambanova.ai","hyperbolic.xyz","novita.ai","siliconflow.cn","deepinfra.com","moonshot.ai","moonshot.cn","minimax.io","minimax.chat"];if(!a.some(x=>h===x||h.endsWith("."+x)))throw Error("provider_domain_not_allowed");return u.toString().replace(/\/+$/,"")}
function parse(t:string){try{return JSON.parse(t)}catch{}const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch{}throw Error("model_invalid_json")}
function clip(v:any,n=13000){const s=JSON.stringify(v??null);return s.length>n?s.slice(0,n)+" [trimmed]":s}
function rows(v:any):any[]{if(Array.isArray(v))return v;for(const k of ["candidates","scenes","items","results"])if(Array.isArray(v?.[k]))return v[k];return[]}
function claimsOf(v:any){return Array.isArray(v)?v.slice(0,24).filter(x=>x&&typeof x.claim_key==="string"&&/^[0-9a-f-]{36}$/i.test(String(x.event_id))&&["direct_fact","detail","rumor","inference"].includes(x.claim_type)).map(x=>({claim_key:x.claim_key.slice(0,150),event_id:x.event_id,claim_type:x.claim_type})):[]}
function checksOf(v:any){return Array.isArray(v)?v.slice(0,1).filter(x=>x&&typeof x.check_key==="string"&&typeof x.description==="string"&&typeof x.challenge_basis==="string"&&["ordinary","difficult","severe","exceptional"].includes(x.challenge_tier)):[]}
function denied(v:any){const s=JSON.stringify(v??{}).toLowerCase();return s.includes('"allowed":false')||s.includes('"blocked":true')||s.includes('"decision":"deny"')||s.includes('"decision":"blocked"')||s.includes('"status":"blocked"')}
async function ask(input:PlayerTurnInput,role:keyof typeof DEFAULTS,system:string,user:string,max=1500){
 const url=provider(input.providerUrl),model=input.models[role]||DEFAULTS[role];
 const r=await fetch(url+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+input.apiKey,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:system},{role:"user",content:user}],temperature:.35,max_tokens:max,response_format:{type:"json_object"}}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(45000)});
 const d:any=await r.json().catch(()=>({}));if(!r.ok)throw Error("model_"+r.status+":"+String(d.error?.message||"provider_failed").slice(0,180));
 const c=d.choices?.[0]?.message?.content;if(typeof c!=="string"||!c.trim())throw Error("model_empty_response");return parse(c);
}
async function progress(stream:WritableStream<Uint8Array>,message:string){
 "use step";
 const w=stream.getWriter();try{await w.write(new TextEncoder().encode(JSON.stringify({type:"progress",message})+"\n"))}finally{w.releaseLock()}
}
async function emit(stream:WritableStream<Uint8Array>,result:Result){
 "use step";
 const w=stream.getWriter();try{await w.write(new TextEncoder().encode(JSON.stringify({type:"result",result})+"\n"))}finally{w.releaseLock()}
}
async function prepare(input:PlayerTurnInput):Promise<Prepared>{
 "use step";
 let workflowRunId="";
 try{
  const b=await worldTool(input.session,"lotm_manage_tool_workflow",{action:"begin",world_id:input.worldId,workflow_key:"durable_turn_commit",intent_summary:"تنفيذ فعل اللاعب: "+input.action.slice(0,180),idempotency_key:input.turnId});
  workflowRunId=String(b.workflow_run_id||b.run_id||b.id||"");if(!workflowRunId)throw Error("world_workflow_run_id_missing");
  const c={world_id:input.worldId,workflow_run_id:workflowRunId,workflow_world_id:input.worldId};
  const [context,scenes,schema]=await Promise.all([
   worldTool(input.session,"lotm_get_world_context",{...c,mode:"scene",budget_bytes:16000}),
   worldTool(input.session,"lotm_get_scene_candidates",{...c,limit:8}),
   worldTool(input.session,"lotm_get_commit_schema",c)
  ]);
  return{workflowRunId,context,scenes,schema};
 }catch(e){if(workflowRunId)try{await worldTool(input.session,"lotm_manage_tool_workflow",{action:"cancel",world_id:input.worldId,workflow_run_id:workflowRunId,outcome:"cancelled",reason:"تعذر تجهيز سياق الدور من المحرك."})}catch{}throw e}
}
async function cancel(input:PlayerTurnInput,p:Prepared,reason:string){
 "use step";
 return worldTool(input.session,"lotm_manage_tool_workflow",{action:"cancel",world_id:input.worldId,workflow_run_id:p.workflowRunId,outcome:"cancelled",reason:("تعذر إكمال دور اللاعب: "+reason).slice(0,450)});
}
async function finishSkipped(input:PlayerTurnInput,p:Prepared,reason:string){
 "use step";
 return worldTool(input.session,"lotm_manage_tool_workflow",{action:"finish",world_id:input.worldId,workflow_run_id:p.workflowRunId,outcome:"skipped",reason:reason.slice(0,450)});
}
async function director(input:PlayerTurnInput,p:Prepared){
 "use step";
 return ask(input,"director","أنت مخرج مشهد. أعد JSON موجزاً: purpose,pacing,viewpoint,threads,needs_drama. لا تخترع حدثاً أو حقيقة ولا تكتب السرد.","سياق المحرك: "+clip(p.context,8500)+"\nالمشهد: "+clip(rows(p.scenes),3000)+"\nفعل اللاعب: "+input.action,950);
}
async function characters(input:PlayerTurnInput,p:Prepared){
 "use step";
 const nearby=rows(p.scenes);if(!nearby.length)return{actors:[]};
 return ask(input,"characters","حلل دوافع وحدود معرفة الشخصيات ذات الصلة فقط. JSON فيه actors وmotivations وknowledge_boundaries وlikely_response. لا تخترع معلومات.","السياق: "+clip(p.context,6500)+"\nالمشهد: "+clip(nearby,4000)+"\nفعل اللاعب: "+input.action,1100);
}
async function drama(input:PlayerTurnInput,p:Prepared,d:any){
 "use step";
 if(d?.needs_drama!==true)return{intervention:false};
 return ask(input,"drama","أنت مهندس إيقاع. اقترح معالجة ركود دون اختراع حدث أو إجبار اللاعب. JSON فقط.","السياق: "+clip(p.context,4200)+"\nتوجيه المخرج: "+clip(d,1000),650);
}
async function writer(input:PlayerTurnInput,p:Prepared,d:any,c:any,dr:any):Promise<Draft>{
 "use step";
 const v=await ask(input,"writer","أنت راوي LOTM بالعربية الفصحى وضمير المخاطب. أعد JSON فقط بالمفاتيح narration,commit_payload,claims,checks,requires_clarification,clarification. مخطط الالتزام يجب أن يطابق مخطط المحرك حرفياً. لا تخترع نتيجة أو حدثاً أو معرّفاً. نية اللاعب ليست نتيجة. أرفق claim لكل معلومة محددة أو سرية أو خارج المشهد بمعرّف حدث موجود في السياق. إن لم توجد نتيجة ملتزمة أو لزم توضيح اجعل commit_payload=null. clarification لا يكشف معلومات GM؛ اكتف بطلب عام للتوضيح.","فعل اللاعب: "+input.action+"\nسياق العالم: "+clip(p.context,9500)+"\nالمشاهد القريبة: "+clip(rows(p.scenes),3500)+"\nتوجيه المخرج: "+clip(d,1100)+"\nتحليل الشخصيات: "+clip(c,1300)+"\nالإيقاع: "+clip(dr,500)+"\nمخطط الالتزام الموثوق من المحرك: "+clip(p.schema,8500),3900);
 return{narration:String(v.narration||"").slice(0,12000),commitPayload:v.commit_payload,claims:claimsOf(v.claims),checks:checksOf(v.checks),requiresClarification:v.requires_clarification===true,clarification:typeof v.clarification==="string"?v.clarification:null};
}
async function disclosure(input:PlayerTurnInput,p:Prepared,claims:any[]){
 "use step";
 return worldTool(input.session,"lotm_check_player_disclosure",{world_id:input.worldId,workflow_run_id:p.workflowRunId,workflow_world_id:input.worldId,claims});
}
async function redact(input:PlayerTurnInput,narration:string,gate:any){
 "use step";
 return ask(input,"writer","احذف كل معلومة منع محرك الإفصاح عرضها. لا تستبدلها بتخمين أو تلميح. لا تضف حقيقة. JSON فقط بالمفاتيح narration وclaims.","النص: "+narration+"\nقرار المحرك: "+clip(gate,4000),2000);
}
async function continuity(input:PlayerTurnInput,p:Prepared,d:Draft){
 "use step";
 return ask(input,"continuity","أنت محرر استمرارية. افحص السرد وكائن الالتزام مقابل السياق والمخطط: الزمن والمكان والكانون وضمير المخاطب وحدود معرفة اللاعب والشخصيات وعدم تحويل المقترحات إلى وقائع. يجب أن يكون لكل معلومة محددة سند في claims. إذا لم تستطع التحقق فاجعل approved=false. لا تضف حقائق. JSON فقط: approved,issues,corrected_narration.","الفعل: "+input.action+"\nالسرد: "+d.narration+"\nالادعاءات: "+clip(d.claims,2500)+"\nكائن الالتزام: "+clip(d.commitPayload,6000)+"\nالسياق: "+clip(p.context,6500)+"\nالمخطط: "+clip(p.schema,4500),1500);
}
async function resolveCheck(input:PlayerTurnInput,p:Prepared,q:any){
 "use step";
 const v=await worldTool(input.session,"lotm_resolve_check",{world_id:input.worldId,workflow_run_id:p.workflowRunId,workflow_world_id:input.worldId,turn_id:input.turnId,check_key:q.check_key.slice(0,100),description:q.description.slice(0,500),challenge_tier:q.challenge_tier,challenge_basis:q.challenge_basis.slice(0,500)});
 const receipt=v.resolution||v;if(typeof receipt.check_id!=="string")throw Error("check_receipt_missing");return{check_id:receipt.check_id,check_key:q.check_key};
}
async function commit(input:PlayerTurnInput,p:Prepared,payload:any){
 "use step";
 try{await worldTool(input.session,"lotm_commit_world_turn",{world_id:input.worldId,workflow_run_id:p.workflowRunId,workflow_world_id:input.worldId,turn_id:input.turnId,payload});return{committed:true}}
 catch(e){return{committed:false,uncertain:true,error:e instanceof Error?e.message:"commit_outcome_uncertain"}}
}
export async function runScene(input:PlayerTurnInput):Promise<Result>{
 "use workflow";
 const stream=getWritable();let prepared:Prepared|null=null;
 try{
  await progress(stream,"تثبيت جلسة التنفيذ وقراءة حالة العالم…");
  prepared=await prepare(input);
  await progress(stream,"قراءة المشهد والكانون والمعلومات المرتبطة بموقعك…");
  const [d,c]=await Promise.all([director(input,prepared),characters(input,prepared)]);
  const dr=await drama(input,prepared,d);
  await progress(stream,"صياغة استجابة العالم…");
  const draft=await writer(input,prepared,d,c,dr);
  if(draft.requiresClarification||!draft.commitPayload||typeof draft.commitPayload!=="object"||Array.isArray(draft.commitPayload)){
   await finishSkipped(input,prepared,"يلزم توضيح فعل اللاعب؛ لم ينفذ المحرك أي تغيير في العالم.");
   const result:Result={ok:true,committed:false,turnId:input.turnId,clarification:"وضّح التصرف الذي تريد تنفيذه أو الجزء الذي تقصده تحديداً."};
   try{await emit(stream,result)}catch{}return result;
  }
  if(draft.claims.length){
   await progress(stream,"التحقق من المعلومات المسموح لشخصيتك بمعرفتها…");
   const gate=await disclosure(input,prepared,draft.claims);
   if(denied(gate)){
    const revised=await redact(input,draft.narration,gate);
    if(claimsOf(revised.claims).length){
     await finishSkipped(input,prepared,"تعذر اعتماد الإفصاح عن بعض المعلومات؛ لم يتغير العالم.");
     const result:Result={ok:false,committed:false,turnId:input.turnId,error:"player_disclosure_not_cleared"};
     try{await emit(stream,result)}catch{}return result;
    }
    draft.narration=String(revised.narration||"").slice(0,12000);
   }
  }
  await progress(stream,"مراجعة الزمن والمكان والكانون والاستمرارية…");
  const review=await continuity(input,prepared,draft);
  if(review.approved!==true){
   await finishSkipped(input,prepared,"فشل فحص الاستمرارية؛ لم يعتمد المحرك أي تغيير في العالم.");
   const result:Result={ok:false,committed:false,turnId:input.turnId,error:"continuity_review_blocked",issues:Array.isArray(review.issues)?review.issues.slice(0,8):[]};
   try{await emit(stream,result)}catch{}return result;
  }
  if(typeof review.corrected_narration==="string"&&review.corrected_narration.trim())draft.narration=review.corrected_narration.slice(0,12000);
  await progress(stream,"اعتماد نتيجة الفعل في محرك العالم…");
  const receipts:any[]=[];for(const q of draft.checks)receipts.push(await resolveCheck(input,prepared,q));
  const payload={...draft.commitPayload,...(receipts.length?{check_receipts:receipts}:{})};
  const outcome=await commit(input,prepared,payload);
  const result:Result=outcome.committed
   ?{ok:true,committed:true,turnId:input.turnId,narration:draft.narration}
   :{ok:false,committed:false,turnId:input.turnId,error:"commit_outcome_uncertain",commitOutcomeUncertain:true};
  try{await emit(stream,result)}catch{}return result;
 }catch(e){
  const message=e instanceof Error?e.message:"turn_execution_failed";
  if(prepared)try{await cancel(input,prepared,message)}catch{}
  const result:Result={ok:false,committed:false,turnId:input.turnId,error:message};
  try{await emit(stream,result)}catch{}return result;
 }
}
