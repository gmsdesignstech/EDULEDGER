import{createHmac,timingSafeEqual}from"node:crypto";

export type SubscriptionStatus="UNPAID"|"PENDING"|"ACTIVE"|"EXPIRED"|"FAILED"|"CANCELLED";

export function addOneYear(date:Date){const next=new Date(date);next.setUTCFullYear(next.getUTCFullYear()+1);return next;}
export function effectiveStatus(status:string|undefined,expiry:string|undefined,now=new Date()):SubscriptionStatus{
 if(status==="ACTIVE"&&expiry&&new Date(expiry)<=now)return"EXPIRED";
 return(["PENDING","ACTIVE","EXPIRED","FAILED","CANCELLED"].includes(status??"")?status:"UNPAID")as SubscriptionStatus;
}
export function verifyWebhookSignature(body:string,signature:string,secret:string){const expected=createHmac("sha256",secret).update(body).digest("hex"),a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b);}
export function capacityMessage(used:number,limit:number,requested=1){return requested===1?`Student capacity reached: ${used} of ${limit} students used. Upgrade your plan to add another student.`:`Import would exceed student capacity: ${used} of ${limit} used, ${requested} new students requested.`;}
