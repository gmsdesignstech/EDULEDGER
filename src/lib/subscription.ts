import{createHmac,timingSafeEqual}from"node:crypto";

export type SubscriptionStatus="UNPAID"|"PENDING"|"ACTIVE"|"EXPIRING_SOON"|"EXPIRED"|"FAILED"|"REFUNDED"|"CANCELLED"|"SUSPENDED";

export function addOneYear(date:Date){const next=new Date(date);next.setUTCFullYear(next.getUTCFullYear()+1);return next;}
export function getDaysRemaining(expiry:string|Date|undefined,now=new Date()){
 if(!expiry)return 0;
 return Math.max(0,Math.ceil((new Date(expiry).getTime()-now.getTime())/864e5));
}
export function getSubscriptionStatus(status:string|undefined,expiry:string|undefined,now=new Date(),warningDays=30):SubscriptionStatus{
 if(["CANCELLED","SUSPENDED","REFUNDED","FAILED","PENDING"].includes(status??""))return status as SubscriptionStatus;
 if(!expiry)return status==="ACTIVE"?"EXPIRED":"UNPAID";
 if(new Date(expiry).getTime()<=now.getTime())return"EXPIRED";
 if(status==="ACTIVE"||status==="EXPIRING_SOON")return getDaysRemaining(expiry,now)<=warningDays?"EXPIRING_SOON":"ACTIVE";
 return"UNPAID";
}
export const effectiveStatus=getSubscriptionStatus;
export function isSubscriptionActive(status:SubscriptionStatus){return status==="ACTIVE"||status==="EXPIRING_SOON";}
export function verifyWebhookSignature(body:string,signature:string,secret:string){const expected=createHmac("sha256",secret).update(body).digest("hex"),a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b);}
export function capacityMessage(used:number,limit:number,requested=1){return requested===1?`Student capacity reached: ${used} of ${limit} students used. Upgrade your plan to add another student.`:`Import would exceed student capacity: ${used} of ${limit} used, ${requested} new students requested.`;}
