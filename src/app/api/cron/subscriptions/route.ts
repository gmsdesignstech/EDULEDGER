import {NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {processSubscriptionLifecycle} from "@/lib/db";
export const runtime="nodejs";
function valid(request:Request){const secret=process.env.CRON_SECRET,provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";if(!secret)return false;const a=Buffer.from(secret),b=Buffer.from(provided);return a.length===b.length&&timingSafeEqual(a,b)}
export async function GET(request:Request){if(!valid(request))return NextResponse.json({error:"Unauthorized"},{status:401});try{return NextResponse.json(await processSubscriptionLifecycle())}catch{return NextResponse.json({error:"Subscription lifecycle processing failed"},{status:500})}}
