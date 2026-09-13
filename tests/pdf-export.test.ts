import { describe,expect,it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createFinancialReportPdf } from "../src/lib/financial-report-pdf";

const base={title:"Student Report",academicYear:"2026-2027",school:{name:"Test School",address:"Test Address",phone:"",email:""},columns:[{key:"admission",label:"Admission",width:160},{key:"name",label:"Student Name",width:259},{key:"status",label:"Status",width:100}],totals:[{label:"Total Records",value:"1"}]};

describe("PDF exports",()=>{
 it("creates a valid A4 PDF for an empty filtered result",async()=>{const bytes=await createFinancialReportPdf({...base,rows:[],filters:["Class: 10"]}),pdf=await PDFDocument.load(bytes),page=pdf.getPage(0);expect(bytes.slice(0,4).toString()).toBe("37,80,68,70");expect(page.getSize().width).toBeCloseTo(595.28,1);expect(page.getSize().height).toBeCloseTo(841.89,1)});
 it("paginates long database exports",async()=>{const rows=Array.from({length:100},(_,index)=>({admission:`ADM-${index+1}`,name:`Student ${index+1}`,status:"Active"})),bytes=await createFinancialReportPdf({...base,rows,totals:[{label:"Total Records",value:String(rows.length)}]}),pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBeGreaterThan(1)});
});
