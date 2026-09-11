"use client";
import {ThemeProvider as Provider,useTheme} from "next-themes";
import {Moon,Sun} from "lucide-react";
export function ThemeProvider({children}:{children:React.ReactNode}){return <Provider attribute="class" defaultTheme="system" enableSystem>{children}</Provider>}
export function ThemeToggle(){const{resolvedTheme,setTheme}=useTheme();return <button aria-label="Toggle color theme" className="rounded-full border p-2.5 hover:bg-brand/10" onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}><Sun className="hidden size-4 dark:block"/><Moon className="size-4 dark:hidden"/></button>}
