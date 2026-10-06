import type { ExportData } from '../export-data';
import { internalReport, type ReportSection } from '../internal-report';
import { escapeHtml as e, page } from './statement-html';

function section(s: ReportSection): string {
  if (s.rows.length === 0) return `<h2>${e(s.title)}</h2><p>${e(s.empty)}</p>`;
  const cls = (index: number) =>
    s.numeric.includes(index) ? ' class="num"' : '';
  const head = s.columns
    .map((column, index) => `<th${cls(index)}>${e(column)}</th>`)
    .join('');
  const rows = s.rows
    .map(
      (cells) =>
        `<tr>${cells
          .map((cell, index) =>
            cell.light
              ? `<td><span class="light ${cell.light}">${e(cell.text)}</span></td>`
              : `<td${cls(index)}>${e(cell.text)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<h2>${e(s.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** F10.2a: the internal check report, printed to PDF like the statements. */
export function internalReportHtml(data: ExportData): string {
  const report = internalReport(data);
  const figures = report.figures
    .map(
      ([label, value]) =>
        `<div class="figure"><div class="label">${e(label)}</div><div class="value">${e(value)}</div></div>`,
    )
    .join('');
  return page(
    report.title,
    `<h1 class="internal">${e(report.title)}</h1>
     <p class="meta">${e(report.meta)}</p>
     <p class="note">${e(report.note)}</p>
     <div class="figures">${figures}</div>` +
      report.sections.map(section).join('') +
      `<footer>${e(report.title)}</footer>`,
  );
}
