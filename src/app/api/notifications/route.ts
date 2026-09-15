import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/session";
import {listUserNotifications,markUserNotificationRead} from "@/lib/db";
export const runtime="nodejs";
export async function GET(){const user=await currentUser();return user?NextResponse.json(await listUserNotifications(user.id)):NextResponse.json({error:"Unauthenticated"},{status:401})}
const schema=z.object({id:z.string().uuid().optional(),all:z.boolean().optional()}).refine(x=>Boolean(x.id||x.all));
export async function PATCH(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthenticated"},{status:401});const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid notification update"},{status:400});const updated=await markUserNotificationRead(user.id,parsed.data.all?undefined:parsed.data.id);return NextResponse.json({ok:true,updated})}
