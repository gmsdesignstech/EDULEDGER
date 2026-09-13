import { notFound } from "next/navigation";
import { ClassWorkspace } from "@/components/class-workspace";
import { classFromSlug } from "@/lib/db";
export const runtime="nodejs";
export default async function Page({params}:{params:Promise<{slug:string}>}){const{slug}=await params;if(!classFromSlug(slug))notFound();return <ClassWorkspace slug={slug}/>}
