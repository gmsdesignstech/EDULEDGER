export type SubscriptionPlan={id:string;name:string;studentLimit:number;price:number;billingPeriod:"year";active:boolean};

export const SUBSCRIPTION_PLANS:readonly SubscriptionPlan[]=[
 {id:"starter",name:"Starter Plan",studentLimit:250,price:10000,billingPeriod:"year",active:true},
 {id:"growth",name:"Growth Plan",studentLimit:400,price:12000,billingPeriod:"year",active:true},
 {id:"professional",name:"Professional Plan",studentLimit:550,price:14000,billingPeriod:"year",active:true},
 {id:"business",name:"Business Plan",studentLimit:700,price:16000,billingPeriod:"year",active:true},
 {id:"premium",name:"Premium Plan",studentLimit:850,price:18000,billingPeriod:"year",active:true},
 {id:"enterprise",name:"Enterprise Plan",studentLimit:1000,price:20000,billingPeriod:"year",active:true},
] as const;

export function getPlan(id:string){return SUBSCRIPTION_PLANS.find(plan=>plan.id===id&&plan.active);}
export const formatInr=(amount:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(amount);
