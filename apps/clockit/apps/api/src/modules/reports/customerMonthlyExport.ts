import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { format, parseISO } from "date-fns";

/**
 * Customer Monthly report exports (CSV / Excel / PDF).
 *
 * The report is workbook-shaped: one grid per project (task + employee rows
 * across the month's calendar-week day columns), a per-project billable /
 * non-billable totals table, and consolidated hours per employee — mirroring
 * the sheets produced by the original VBA billing tool.
 */
export class CustomerMonthlyExportService {
  private static hours(value: number | undefined): string {
    return value ? value.toFixed(2) : "";
  }

  /** Per-week totals for a row — used by the (narrower) PDF layout. */
  private static weekTotals(daily: Record<string, number>, weeks: any[]): number[] {
    return weeks.map((w: any) =>
      w.days.reduce((sum: number, d: string) => sum + (daily[d] || 0), 0)
    );
  }

  static async generateCSV(report: any): Promise<Buffer> {
    const rows: string[][] = [];
    rows.push([`Customer Monthly report - ${report.month}`]);
    rows.push(["Range", report.rangeStart, "to", report.rangeEnd]);
    rows.push([]);

    for (const project of report.projects) {
      rows.push([project.name + (project.clientName ? ` (${project.clientName})` : "")]);
      const head = ["Task Name", "Employee Name"];
      if (project.internal) head.push("Description");
      for (const week of report.weeks) {
        for (const day of week.days) head.push(`CW${week.cw} ${format(parseISO(day), "dd MMM")}`);
      }
      head.push("TOTAL");
      rows.push(head);

      for (const r of project.rows) {
        const line = [r.task, r.employee];
        if (project.internal) line.push(r.description || "");
        for (const day of report.days) line.push(this.hours(r.daily[day]));
        line.push(r.total.toFixed(2));
        rows.push(line);
      }

      const totalLine = ["TOTAL", ""];
      if (project.internal) totalLine.push("");
      for (const day of report.days) totalLine.push(this.hours(project.dailyTotals[day]));
      totalLine.push(project.total.toFixed(2));
      rows.push(totalLine);
      rows.push([]);
    }

    rows.push(["PROJECT NAME", "CLIENT", "BILLABLE", "NON-BILLABLE", "TOTAL_HOURS"]);
    for (const p of report.projectTotals) {
      rows.push([
        p.name,
        p.clientName || "",
        p.billable.toFixed(2),
        p.nonBillable.toFixed(2),
        p.total.toFixed(2),
      ]);
    }
    rows.push([
      "TOTAL",
      "",
      report.grand.billable.toFixed(2),
      report.grand.nonBillable.toFixed(2),
      report.grand.total.toFixed(2),
    ]);
    rows.push([]);

    rows.push(["Employee Name", "Project Name", "Hours"]);
    for (const emp of report.consolidated) {
      emp.rows.forEach((r: any, i: number) =>
        rows.push([i === 0 ? emp.employee : "", r.project, r.hours.toFixed(2)])
      );
      rows.push(["", "Total", emp.total.toFixed(2)]);
    }

    return Buffer.from(stringify(rows));
  }

  static async generateExcel(report: any): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const headerFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCD5B4" } };

    // Worksheet names are capped at 31 chars and must be unique
    const used = new Set<string>();
    const sheetName = (name: string) => {
      const base = (name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet").trim();
      let candidate = base;
      let n = 2;
      while (used.has(candidate)) candidate = `${base.slice(0, 28)} ${n++}`;
      used.add(candidate);
      return candidate;
    };

    for (const project of report.projects) {
      const sheet = workbook.addWorksheet(sheetName(project.name));
      const leading = project.internal ? 3 : 2;

      const weekRow: string[] = new Array(leading).fill("");
      for (const week of report.weeks) for (const _ of week.days) weekRow.push(`CW${week.cw}`);
      weekRow.push("");
      sheet.addRow(weekRow);

      const head = ["Task Name", "Employee Name"];
      if (project.internal) head.push("Description");
      for (const day of report.days) head.push(format(parseISO(day), "dd MMM"));
      head.push("TOTAL");
      sheet.addRow(head);

      [1, 2].forEach((rowNumber) => {
        const row = sheet.getRow(rowNumber);
        row.font = { bold: true };
        row.eachCell((cell) => (cell.fill = headerFill));
      });

      for (const r of project.rows) {
        const line: any[] = [r.task, r.employee];
        if (project.internal) line.push(r.description || "");
        for (const day of report.days) line.push(r.daily[day] ?? null);
        line.push(r.total);
        sheet.addRow(line);
      }

      const totals: any[] = ["TOTAL", ""];
      if (project.internal) totals.push("");
      for (const day of report.days) totals.push(project.dailyTotals[day] ?? null);
      totals.push(project.total);
      sheet.addRow(totals).font = { bold: true };

      sheet.getColumn(1).width = 32;
      sheet.getColumn(2).width = 22;
      if (project.internal) sheet.getColumn(3).width = 28;
      sheet.views = [{ state: "frozen", xSplit: leading, ySplit: 2 }];
    }

    const totalsSheet = workbook.addWorksheet(sheetName("Project Totals"));
    totalsSheet.addRow(["PROJECT NAME", "CLIENT", "BILLABLE", "NON-BILLABLE", "TOTAL_HOURS"]);
    totalsSheet.getRow(1).font = { bold: true, size: 12 };
    totalsSheet.getRow(1).eachCell((cell) => (cell.fill = headerFill));
    for (const p of report.projectTotals) {
      totalsSheet.addRow([p.name, p.clientName || "", p.billable, p.nonBillable, p.total]);
    }
    totalsSheet.addRow([
      "TOTAL",
      "",
      report.grand.billable,
      report.grand.nonBillable,
      report.grand.total,
    ]).font = { bold: true };
    totalsSheet.columns.forEach((c) => (c.width = 20));

    const consolidated = workbook.addWorksheet(sheetName("Consolidated Hours"));
    consolidated.addRow(["Employee Name", "Project Name", "Hours"]);
    consolidated.getRow(1).font = { bold: true, size: 12 };
    consolidated.getRow(1).eachCell((cell) => (cell.fill = headerFill));
    for (const emp of report.consolidated) {
      emp.rows.forEach((r: any, i: number) =>
        consolidated.addRow([i === 0 ? emp.employee : "", r.project, r.hours])
      );
      consolidated.addRow(["", "Total", emp.total]).font = { bold: true };
    }
    consolidated.columns.forEach((c) => (c.width = 26));

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generatePDF(report: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const bottom = doc.page.height - doc.page.margins.bottom;

      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .text(`Customer Monthly report — ${report.month}`, { align: "center" });
      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          `${report.rangeStart} to ${report.rangeEnd} · generated ${format(new Date(), "yyyy-MM-dd HH:mm")}`,
          { align: "center" }
        );
      doc.moveDown(0.8);

      let y = doc.y;
      const ensureSpace = (needed: number) => {
        if (y + needed > bottom) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      };
      type Cell = { text: string; x: number; width: number; align?: "left" | "right" };
      const rowLine = (cells: Cell[], bold = false) => {
        doc.fontSize(8).font(bold ? "Helvetica-Bold" : "Helvetica");
        cells.forEach((c) =>
          doc.text(c.text, c.x, y, { width: c.width, align: c.align ?? "left", lineBreak: false })
        );
        y += 13;
      };

      // Per-project grids, summarised by calendar week so the table fits the page
      for (const project of report.projects) {
        ensureSpace(60);
        doc
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(project.name + (project.clientName ? ` — ${project.clientName}` : ""), left, y);
        y += 16;

        const weekCount = report.weeks.length;
        const fixed = 300;
        const totalColX = right - 60;
        const weekWidth = Math.max(40, (totalColX - left - fixed) / Math.max(1, weekCount));
        const weekCells = (values: number[]): Cell[] =>
          values.map((v, i) => ({
            text: v ? v.toFixed(2) : "-",
            x: left + fixed + i * weekWidth,
            width: weekWidth,
            align: "right" as const,
          }));

        rowLine(
          [
            { text: "Task Name", x: left, width: 180 },
            { text: "Employee", x: left + 180, width: 115 },
            ...report.weeks.map((w: any, i: number) => ({
              text: `CW${w.cw}`,
              x: left + fixed + i * weekWidth,
              width: weekWidth,
              align: "right" as const,
            })),
            { text: "TOTAL", x: totalColX, width: 60, align: "right" as const },
          ],
          true
        );
        doc.moveTo(left, y - 2).lineTo(right, y - 2).stroke("#cccccc");

        for (const r of project.rows) {
          ensureSpace(20);
          rowLine([
            { text: r.task, x: left, width: 180 },
            { text: r.employee, x: left + 180, width: 115 },
            ...weekCells(this.weekTotals(r.daily, report.weeks)),
            { text: r.total.toFixed(2), x: totalColX, width: 60, align: "right" as const },
          ]);
        }

        ensureSpace(20);
        rowLine(
          [
            { text: "TOTAL", x: left, width: 180 },
            { text: "", x: left + 180, width: 115 },
            ...weekCells(this.weekTotals(project.dailyTotals, report.weeks)),
            { text: project.total.toFixed(2), x: totalColX, width: 60, align: "right" as const },
          ],
          true
        );
        y += 10;
      }

      // Project totals
      ensureSpace(80);
      doc.fontSize(12).font("Helvetica-Bold").text("Project totals", left, y);
      y += 18;
      rowLine(
        [
          { text: "PROJECT NAME", x: left, width: 200 },
          { text: "CLIENT", x: left + 200, width: 160 },
          { text: "BILLABLE", x: left + 360, width: 90, align: "right" },
          { text: "NON-BILLABLE", x: left + 455, width: 100, align: "right" },
          { text: "TOTAL_HOURS", x: left + 560, width: 100, align: "right" },
        ],
        true
      );
      doc.moveTo(left, y - 2).lineTo(right, y - 2).stroke("#cccccc");
      for (const p of report.projectTotals) {
        ensureSpace(20);
        rowLine([
          { text: p.name, x: left, width: 200 },
          { text: p.clientName || "-", x: left + 200, width: 160 },
          { text: p.billable.toFixed(2), x: left + 360, width: 90, align: "right" },
          { text: p.nonBillable.toFixed(2), x: left + 455, width: 100, align: "right" },
          { text: p.total.toFixed(2), x: left + 560, width: 100, align: "right" },
        ]);
      }
      ensureSpace(20);
      rowLine(
        [
          { text: "TOTAL", x: left, width: 200 },
          { text: "", x: left + 200, width: 160 },
          { text: report.grand.billable.toFixed(2), x: left + 360, width: 90, align: "right" },
          { text: report.grand.nonBillable.toFixed(2), x: left + 455, width: 100, align: "right" },
          { text: report.grand.total.toFixed(2), x: left + 560, width: 100, align: "right" },
        ],
        true
      );
      y += 12;

      // Consolidated hours
      ensureSpace(80);
      doc.fontSize(12).font("Helvetica-Bold").text("Consolidated hours", left, y);
      y += 18;
      rowLine(
        [
          { text: "Employee Name", x: left, width: 220 },
          { text: "Project Name", x: left + 220, width: 240 },
          { text: "Hours", x: left + 465, width: 80, align: "right" },
        ],
        true
      );
      doc.moveTo(left, y - 2).lineTo(right, y - 2).stroke("#cccccc");
      for (const emp of report.consolidated) {
        emp.rows.forEach((r: any, i: number) => {
          ensureSpace(20);
          rowLine([
            { text: i === 0 ? emp.employee : "", x: left, width: 220 },
            { text: r.project, x: left + 220, width: 240 },
            { text: r.hours.toFixed(2), x: left + 465, width: 80, align: "right" },
          ]);
        });
        ensureSpace(20);
        rowLine(
          [
            { text: "", x: left, width: 220 },
            { text: "Total", x: left + 220, width: 240 },
            { text: emp.total.toFixed(2), x: left + 465, width: 80, align: "right" },
          ],
          true
        );
      }

      doc.end();
    });
  }
}
