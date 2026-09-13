import { NextResponse } from "next/server";
import { accountsSummary,getInstitution } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime="nodejs";
const roles=["SCHOOL_ADMIN","SUPER_ADMIN","ACCOUNTANT"];
export async function GET(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthenticated"},{status:401});if(!roles.includes(user.role))return NextResponse.json({error:"You do not have permission to view accounts."},{status:403});const institution=await getInstitution(user.institutionId),requested=new URL(request.url).searchParams.get("year"),year=requested&&/^\d{4}[-–]\d{4}$/.test(requested)?requested.replace("–","-"):institution.academicYear;const start=Number(year.slice(0,4)),years=[`${start-1}-${start}`,year,`${start+1}-${start+2}`];return NextResponse.json({summary:await accountsSummary(user.institutionId,year),academicYears:[...new Set(years)],activeAcademicYear:institution.academicYear,schoolName:institution.name})}
