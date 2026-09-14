import {requirePrivateAdmin}from"@/lib/admin-auth";import {AdminShell}from"@/components/admin-shell";export const runtime="nodejs";export default async function Layout({children}:{children:React.ReactNode}){const admin=await requirePrivateAdmin();return <AdminShell admin={{name:admin.name,email:admin.email}}>{children}</AdminShell>}

