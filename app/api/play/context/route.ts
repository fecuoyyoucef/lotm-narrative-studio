import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
import {worldTool} from "@/lib/world-agent";
export const runtime="nodejs";
function findValue(root:any,keys:string[],depth=0):any{
 if(!root||typeof root!=="object"||depth>4)return undefined;
 for(const key of keys){const v=root[key];if(typeof v==="string"||typeof v==="number")return v;if(v&&typeof v==="object"&&!Array.isArray(v)){const nested=v.display_name||v.name||v.label||v.value;if(typeof nested==="string")return nested;}}
 for(const key of ["world","campaign","clock","player_state","player_profile","player","current_state","location"]){const v=root[key];if(v&&typeof v==="object"){const found=findValue(v,keys,depth+1);if(found!==undefined)return found;}}
 return undefined;
}
function getRows(v:any):any[]{if(Array.isArray(v))return v;for(const k of ["events","items","updates","notifications","results","entries"])if(Array.isArray(v?.[k]))return v[k];return[]}
function safeEvent(x:any){const title=x?.player_title||x?.public_title||x?.display_title||x?.title||x?.display_name||null;const summary=x?.player_summary||x?.public_summary||x?.surface_description||x?.player_description||null;const location=x?.player_location_name||x?.location_name||x?.location?.display_name||x?.location?.name||null;return{id:typeof x?.id==="string"?x.id:null,title:typeof title==="string"?title:null,summary:typeof summary==="string"?summary:null,tick:typeof x?.tick==="number"?x.tick:null,location_name:typeof location==="string"?location:null}}
function safePlayer(p:any){const abilities=Array.isArray(p?.acquired_abilities)?p.acquired_abilities:Array.isArray(p?.abilities)?p.abilities:[];return{load_status:typeof p?.load_status==="string"?p.load_status:"unavailable",registered:typeof p?.registered==="boolean"?p.registered:null,acquired_abilities:abilities.slice(0,30).map((a:any)=>({name:String(a?.display_name||a?.name||a?.ability_name||"قدرة مسجلة"),sequence:a?.sequence??null}))}}
export async function GET(req:NextRequest){
 const session=(await cookies()).get("lotm_world_session")?.value;if(!session)return NextResponse.json({ok:false,error:"authorization_required"},{status:401});
 const worldId=req.nextUrl.searchParams.get("worldId")||"";if(!/^[0-9a-f-]{36}$/i.test(worldId))return NextResponse.json({ok:false,error:"world_id_required"},{status:400});
 let runId="";
 try{
  const started=await worldTool(session,"lotm_manage_tool_workflow",{action:"begin",world_id:worldId,workflow_key:"player_turn_context",intent_summary:"تحميل المعلومات المسموح بعرضها للاعب وسجل الأحداث المعروفة",idempotency_key:"load-"+crypto.randomUUID()});
  runId=String(started.workflow_run_id||started.run_id||started.id||"");if(!runId)throw Error("workflow_run_id_missing");
  const common={world_id:worldId,workflow_run_id:runId,workflow_world_id:worldId};
  const [gmContext,sceneRaw,updates]=await Promise.all([
   worldTool(session,"lotm_get_world_context",{...common,mode:"scene",budget_bytes:12000}),
   worldTool(session,"lotm_get_scene_candidates",{...common,limit:8}),
   worldTool(session,"lotm_get_world_updates",{...common,after_notification_id:0,limit:40,audience:"player"})
  ]);
  const root=gmContext?.world||gmContext?.campaign||gmContext;
  const location=findValue(root,["player_location_name","current_location_name","location_name","current_location","player_location"]);
  const time=findValue(root,["current_time","fictional_time","display_time","world_time_label","time_label"]);
  const tick=findValue(root,["current_tick","world_tick","tick"]);
  const events=getRows(updates).map(safeEvent).filter((x:any)=>x.title||x.summary||x.location_name||x.tick!==null);
  const places=new Set<string>();if(typeof location==="string"&&location.trim())places.add(location.trim());for(const e of events)if(e.location_name)places.add(e.location_name);
  const scenes=getRows(sceneRaw).map((x:any)=>({scene_type:typeof x?.scene_type==="string"?x.scene_type:typeof x?.type==="string"?x.type:null,label:typeof(x?.player_label||x?.public_label||x?.player_title||x?.display_name)==="string"?(x.player_label||x.public_label||x.player_title||x.display_name):null})).filter((x:any)=>x.label);
  const player=safePlayer(gmContext?.player_beyonder_context||{});
  await worldTool(session,"lotm_manage_tool_workflow",{action:"finish",world_id:worldId,workflow_run_id:runId,outcome:"skipped",reason:"اكتمل تحميل الإسقاط المسموح للاعب دون تنفيذ فعل أو تغيير حالة العالم."});
  return NextResponse.json({ok:true,context:{world:{current_location:typeof location==="string"?location:null,current_time:typeof time==="string"||typeof time==="number"?time:null,current_tick:typeof tick==="number"?tick:null},recent_committed_events:events,player_beyonder_context:player},scenes,registry:{locations:[...places].map(name=>({name})),actors:[]}},{headers:{"Cache-Control":"no-store"}});
 }catch(e){if(runId)try{await worldTool(session,"lotm_manage_tool_workflow",{action:"cancel",world_id:worldId,workflow_run_id:runId,outcome:"cancelled",reason:"تعذر إكمال تحميل إسقاط المعلومات المسموح للاعب."})}catch{}return NextResponse.json({ok:false,error:e instanceof Error?e.message:"context_load_failed"},{status:502})}
}
