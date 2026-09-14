import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "./session";

type SessionUser={id:string;email:string;name:string;role:string;institutionId:string};
export function adminConfiguration(){const id=process.env.ADMIN_USER_ID?.trim(),email=process.env.ADMIN_EMAIL?.trim().toLowerCase();return{id,email,configured:Boolean(id||email)}}
export function isPrivateAdmin(user:SessionUser|undefined){if(!user||user.role!=="SUPER_ADMIN")return false;const config=adminConfiguration();if(config.id)return user.id===config.id;return Boolean(config.email&&user.email.toLowerCase()===config.email)}
export async function privateAdmin(){const user=await currentUser() as SessionUser|undefined;return isPrivateAdmin(user)?user:undefined}
export async function requirePrivateAdmin(){const user=await currentUser() as SessionUser|undefined;if(!user)redirect("/admin/login");if(!isPrivateAdmin(user))redirect("/dashboard?error=admin_unauthorized");return user}
