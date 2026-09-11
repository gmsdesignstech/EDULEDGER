import{notFound}from"next/navigation";import{ModuleWorkspace}from"@/components/module-workspace";import{moduleConfigs}from"@/config/modules";
export default async function Module({params}:{params:Promise<{module:string}>}){const{module}=await params;if(!moduleConfigs[module])notFound();return <ModuleWorkspace module={module}/>}
