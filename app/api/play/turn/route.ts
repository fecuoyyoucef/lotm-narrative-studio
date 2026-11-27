import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
import {start} from "workflow/api";
import {runScene,type PlayerTurnInput} from "@/workflows/scene";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const DEFAULTS={director:"minimaxai/minimax-m3.1-flash",characters:"minimaxai/minimax-m3.1-flash",drama:"minimaxai/minimax-m3.1-flash",writer:"stepfun-ai/step-5-preview",continuity:"nvidia/nemotron-3-ultra-550b-a55b"};
const HOSTS=["nvidia.com","openrouter.ai","deepseek.com","mistral.ai","groq.com","together.xyz","fireworks.ai","cerebras.ai","sambanova.ai","hyperbolic.xyz","novita.ai","siliconflow.cn","deepinfra.com","moonshot.ai","moonshot.cn","minimax.io","minimax.chat"];
function providerUrl(value:string){const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password)throw Error("provider_url_rejected");const h=u.hostname.toLowerCase();if(!HOSTS.some(x=>h===x||h.endsWith("."+x)))throw Error("provider_domain_not_allowed");return u.toString().replace(/\/+$/,"")}
function originOk(req:NextRequest){const origin=req.headers.get("origin");return !origin||origin===new URL(req.url).origin}
export async function POST(req:NextRequest){
 if(!originOk(req))return NextResponse.json({ok:false,error:"origin_rejected"},{status:403});
 const session=(await cookies()).get("lotm_world_session")?.value;
 if(!session)return NextResponse.json({ok:false,error:"authorization_required"},{status:401});
 let body:any;try{body=await req.json()}catch{return NextResponse.json({ok:false,error:"invalid_json"},{status:400})}
 const worldId=String(body.worldId||""),action=String(body.action||"").trim(),turnId=String(body.turnId||""),apiKey=String(body.apiKey||"").trim();
 let provider="";try{provider=providerUrl(String(body.providerUrl||"https://integrate.api.nvidia.com/v1"))}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"provider_url_rejected"},{status:400})}
 const models={...DEFAULTS,...(body.models||{})} as Record<string,string>;
 if(!/^[0-9a-f-]{36}$/i.test(worldId)||!action||action.length>12000||apiKey.length<12||apiKey.length>500||!/^[-A-Za-z0-9_.:/]{2,220}$/.test(turnId))return NextResponse.json({ok:false,error:"turn_input_invalid"},{status:400});
 for(const key of Object.keys(DEFAULTS))if(typeof models[key]!=="string"||!/^[-A-Za-z0-9_.:/]{2,220}$/.test(models[key]))return NextResponse.json({ok:false,error:"model_id_invalid_"+key},{status:400});
 const input:PlayerTurnInput={session,worldId,action,turnId,providerUrl:provider,apiKey,models};
 try{
  const run=await start(runScene,[input],{experimental_hook:{token:"lotm-player-turn:"+turnId,experimental_minRetention:"1 day"}});
  return NextResponse.json({ok:true,runId:run.runId,turnId,status:"queued"},{headers:{"Cache-Control":"no-store"}});
 }catch(e){const message=e instanceof Error?e.message:"workflow_start_failed";return NextResponse.json({ok:false,error:/HookConflict|hook_conflict/i.test(message)?"turn_start_already_exists":message.slice(0,240)},{status:409})}
}
