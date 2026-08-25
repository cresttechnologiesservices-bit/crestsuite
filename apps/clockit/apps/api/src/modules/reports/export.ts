import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { format } from "date-fns";

export interface ExportConfig {
  reportName?: string;
  notes?: string;
  rightToLeft?: boolean;
  columns: {
    // Visible in all formats
    project?: boolean;
    client?: boolean;
    description?: boolean;
    task?: boolean;
    user?: boolean;
    tags?: boolean;
    startDate?: boolean;
    startTime?: boolean;
    endTime?: boolean;
    durationH?: boolean;
    // CSV/Excel only
    email?: boolean;
    billable?: boolean;
    endDate?: boolean;
    durationDecimal?: boolean;
    group?: boolean;
    // PDF only
    notesIncluded?: boolean;
    // Always available (REQ-REP-B48)
    dateOfCreation?: boolean;
  };
}

// REQ-REP-B47: format-scoped column eligibility, enforced server-side
const CSV_EXCEL_ONLY = ["email", "billable", "endDate", "durationDecimal", "group"] as const;
const PDF_ONLY = ["notesIncluded"] as const;

/** Custom field names present in the exported rows, in stable order. */
function customFieldNames(entries: any[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    for (const name of Object.keys(entry.customFields ?? {})) names.add(name);
  }
  return [...names].sort();
}

/** Render one custom field value for a spreadsheet cell. */
function customFieldCell(entry: any, name: string): string {
  const value = (entry.customFields ?? {})[name];
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function scopeColumns(config: ExportConfig, target: "pdf" | "csvexcel"): ExportConfig["columns"] {
  const columns = { ...config.columns };
  if (target === "pdf") {
    CSV_EXCEL_ONLY.forEach((key) => delete columns[key]);
  } else {
    PDF_ONLY.forEach((key) => delete columns[key]);
  }
  return columns;
}

export class ExportService {
  /**
   * REQ-REP-B23: CSV export
   */
  static async generateCSV(entries: any[], config: ExportConfig): Promise<Buffer> {
    const cols = scopeColumns(config, "csvexcel");
    const headers: string[] = [];
    const columns: string[] = [];
    if (cols.project) { headers.push("Project"); columns.push("projectName"); }
    if (cols.client) { headers.push("Client"); columns.push("clientName"); }
    if (cols.description) { headers.push("Description"); columns.push("description"); }
    if (cols.task) { headers.push("Task"); columns.push("taskName"); }
    if (cols.user) { headers.push("User"); columns.push("userName"); }
    if (cols.email) { headers.push("Email"); columns.push("userEmail"); }
    if (cols.group) { headers.push("Group"); columns.push("groupName"); }
    if (cols.tags) { headers.push("Tags"); columns.push("tags"); }
    if (cols.billable) { headers.push("Billable"); columns.push("billable"); }
    if (cols.startDate) { headers.push("Start Date"); columns.push("date"); }
    if (cols.startTime) { headers.push("Start Time"); columns.push("startTime"); }
    if (cols.endDate) { headers.push("End Date"); columns.push("endDate"); }
    if (cols.endTime) { headers.push("End Time"); columns.push("endTime"); }
    if (cols.durationH) { headers.push("Duration (h)"); columns.push("duration"); }
    if (cols.durationDecimal) { headers.push("Duration (decimal)"); columns.push("durationDecimal"); }
    if (cols.dateOfCreation) { headers.push("Date of creation"); columns.push("createdAt"); }
    // One column per custom field that has values in this export
    const customNames = customFieldNames(entries);
    headers.push(...customNames);

    const rows = entries.map((entry) => [
      ...columns.map((col) => {
        if (col === "tags") return (entry.tags || []).join(", ");
        if (col === "billable") return entry.billable ? "Yes" : "No";
        if (col === "durationDecimal") return (entry.durationMinutes / 60).toFixed(2);
        if (col === "groupName") return entry.groupName || "";
        if (col === "createdAt") return format(new Date(entry.createdAt), "yyyy-MM-dd HH:mm");
        return entry[col] ?? "";
      }),
      ...customNames.map((name) => customFieldCell(entry, name)),
    ]);

    const csv = stringify([headers, ...rows]);
    return Buffer.from(csv, "utf-8");
  }

  /**
   * REQ-REP-B24, B55: Excel export
   */
  static async generateExcel(entries: any[], config: ExportConfig): Promise<Buffer> {
    const cols = scopeColumns(config, "csvexcel");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");

    // Build columns
    const excelColumns: { header: string; key: string; type?: string }[] = [];
    if (cols.project) excelColumns.push({ header: "Project", key: "projectName" });
    if (cols.client) excelColumns.push({ header: "Client", key: "clientName" });
    if (cols.description) excelColumns.push({ header: "Description", key: "description" });
    if (cols.task) excelColumns.push({ header: "Task", key: "taskName" });
    if (cols.user) excelColumns.push({ header: "User", key: "userName" });
    if (cols.email) excelColumns.push({ header: "Email", key: "userEmail" });
    if (cols.group) excelColumns.push({ header: "Group", key: "groupName" });
    if (cols.tags) excelColumns.push({ header: "Tags", key: "tags" });
    if (cols.billable) excelColumns.push({ header: "Billable", key: "billable" });
    if (cols.startDate) excelColumns.push({ header: "Start Date", key: "startDate", type: "date" });
    if (cols.startTime) excelColumns.push({ header: "Start Time", key: "startTime" });
    if (cols.endDate) excelColumns.push({ header: "End Date", key: "endDate", type: "date" });
    if (cols.endTime) excelColumns.push({ header: "End Time", key: "endTime" });
    if (cols.durationH) excelColumns.push({ header: "Duration (h)", key: "durationH" });
    if (cols.durationDecimal) excelColumns.push({ header: "Duration (decimal)", key: "durationDecimal", type: "number" });
    if (cols.dateOfCreation) excelColumns.push({ header: "Date of creation", key: "createdAt", type: "date" });

    sheet.columns = excelColumns.map((c) => ({ header: c.header, key: c.key, width: 20 }));

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };

    // Add data rows (REQ-REP-B55: correct typing per column)
    entries.forEach((entry) => {
      sheet.addRow({
        projectName: entry.projectName || "",
        clientName: entry.clientName || "",
        description: entry.description || "",
        taskName: entry.taskName || "",
        userName: entry.userName || "",
        userEmail: entry.userEmail || "",
        groupName: entry.groupName || "",
        tags: (entry.tags || []).join(", "),
        billable: entry.billable ? "Yes" : "No",
        startDate: new Date(entry.start),
        startTime: entry.startTime,
        endDate: entry.end ? new Date(entry.end) : null,
        endTime: entry.endTime,
        durationH: entry.duration,
        durationDecimal: Number((entry.durationMinutes / 60).toFixed(2)),
        createdAt: new Date(entry.createdAt),
      });
    });

    // Format date/number columns
    excelColumns.forEach((colDef, idx) => {
      if (colDef.type === "date") {
        sheet.getColumn(idx + 1).width = 15;
        sheet.getColumn(idx + 1).numFmt = "yyyy-mm-dd";
      } else if (colDef.type === "number") {
        sheet.getColumn(idx + 1).numFmt = "0.00";
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * REQ-REP-B22, B54: PDF export
   */
  static async generatePDF(entries: any[], config: ExportConfig): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const cols = scopeColumns(config, "pdf");
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape", // REQ-REP-B60
        margin: 40,
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // REQ-REP-B56: Report name header
      if (config.reportName) {
        doc.fontSize(18).font("Helvetica-Bold").text(config.reportName, { align: "center" });
        doc.moveDown(0.5);
      }
      doc.fontSize(10).font("Helvetica").text(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`, {
        align: config.rightToLeft ? "left" : "right",
      });
      doc.moveDown();

      // REQ-REP-B56: Notes section (PDF only)
      if (cols.notesIncluded && config.notes) {
        doc.fontSize(11).font("Helvetica-Oblique").text(`Notes: ${config.notes}`, {
          align: config.rightToLeft ? "right" : "left",
        });
        doc.moveDown();
      }

      // Build columns for PDF
      const pdfColumns: { header: string; key: string; width: number }[] = [];
      if (cols.project) pdfColumns.push({ header: "Project", key: "projectName", width: 100 });
      if (cols.client) pdfColumns.push({ header: "Client", key: "clientName", width: 80 });
      if (cols.description) pdfColumns.push({ header: "Description", key: "description", width: 150 });
      if (cols.task) pdfColumns.push({ header: "Task", key: "taskName", width: 80 });
      if (cols.user) pdfColumns.push({ header: "User", key: "userName", width: 80 });
      if (cols.tags) pdfColumns.push({ header: "Tags", key: "tags", width: 80 });
      if (cols.startDate) pdfColumns.push({ header: "Date", key: "date", width: 70 });
      if (cols.startTime) pdfColumns.push({ header: "Start", key: "startTime", width: 50 });
      if (cols.endTime) pdfColumns.push({ header: "End", key: "endTime", width: 50 });
      if (cols.durationH) pdfColumns.push({ header: "Duration", key: "duration", width: 60 });
      if (cols.dateOfCreation) pdfColumns.push({ header: "Created", key: "createdAt", width: 70 });

      // REQ-REP-B57: right-to-left renders columns in reverse order, right-aligned
      if (config.rightToLeft) pdfColumns.reverse();
      const textAlign = config.rightToLeft ? "right" : "left";

      // Table header
      const startX = doc.page.margins.left;
      const tableWidth = pdfColumns.reduce((s, c) => s + c.width, 0);
      let y = doc.y;

      const drawHeader = () => {
        doc.fontSize(9).font("Helvetica-Bold");
        let x = startX;
        pdfColumns.forEach((col) => {
          doc.text(col.header, x, y, { width: col.width, align: textAlign });
          x += col.width;
        });
        y += 15;
        doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke("#cccccc");
        y += 5;
        doc.font("Helvetica");
      };

      drawHeader();

      // Table rows
      entries.forEach((entry) => {
        if (y > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          y = doc.page.margins.top;
          drawHeader();
        }
        let x = startX;
        pdfColumns.forEach((col) => {
          let value: any = entry[col.key] ?? "";
          if (col.key === "tags") value = (entry.tags || []).join(", ");
          if (col.key === "createdAt") value = format(new Date(entry.createdAt), "yyyy-MM-dd");
          doc.text(String(value), x, y, { width: col.width, align: textAlign, lineBreak: false });
          x += col.width;
        });
        y += 15;
      });

      doc.end();
    });
  }
}
