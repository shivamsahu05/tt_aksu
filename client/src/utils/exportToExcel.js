/**
 * exportToExcel.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable utility to export any dataset to a beautifully styled Excel (.xlsx)
 * file. Shows a SweetAlert2 preview dialog before downloading.
 *
 * Usage:
 *   import { exportToExcel } from '../../utils/exportToExcel';
 *
 *   exportToExcel({
 *     filename: 'Teachers_Export',
 *     sheetName: 'Teachers',
 *     columns: [
 *       { header: 'Full Name',    key: 'full_name' },
 *       { header: 'Department',   key: 'department_name' },
 *       { header: 'Status',       key: row => row.is_active ? 'Active' : 'Inactive' },
 *     ],
 *     data: teachers,            // array of objects
 *     notes: [                   // Optional: notes shown in preview & in sheet
 *       '✅ Includes: Full Name, Short Name, Department, Designation, Status',
 *       '❌ Excluded: Photos, Secondary Departments, Passwords',
 *     ],
 *   });
 */

import * as XLSX from 'xlsx';

// ─── Color Palette ─────────────────────────────────────────────────────────────
const COLORS = {
    headerBg:   '4F46E5',   // Indigo header background
    headerFg:   'FFFFFF',   // White header text
    evenRowBg:  'F0F0FF',   // Very light indigo for even rows
    oddRowBg:   'FFFFFF',   // White for odd rows
    borderColor:'D1D5DB',   // Light grey border
    notesBg:    'FEF9C3',   // Soft yellow for notes
    notesFg:    '713F12',   // Dark amber text for notes
    titleBg:    '1E1B4B',   // Deep indigo for title row
    titleFg:    'FFFFFF',
};

// ─── Helper: cell style builder ────────────────────────────────────────────────
const makeStyle = ({ bgColor = 'FFFFFF', fontColor = '000000', bold = false, italic = false, size = 10, wrapText = false, halign = 'left' } = {}) => ({
    font: { name: 'Calibri', sz: size, bold, italic, color: { rgb: fontColor } },
    fill: { fgColor: { rgb: bgColor }, patternType: 'solid' },
    border: {
        top:    { style: 'thin', color: { rgb: COLORS.borderColor } },
        bottom: { style: 'thin', color: { rgb: COLORS.borderColor } },
        left:   { style: 'thin', color: { rgb: COLORS.borderColor } },
        right:  { style: 'thin', color: { rgb: COLORS.borderColor } },
    },
    alignment: { horizontal: halign, vertical: 'center', wrapText },
});

// ─── Main Export Function ───────────────────────────────────────────────────────
export const exportToExcel = async ({ filename, sheetName = 'Data', columns, data, notes = [] }) => {
    // Lazy import SweetAlert2
    const Swal = (await import('sweetalert2')).default;

    // ── Build preview HTML ──────────────────────────────────────────────────
    const includeLines = notes.filter(n => n.startsWith('✅'));
    const excludeLines = notes.filter(n => n.startsWith('❌'));
    const otherLines   = notes.filter(n => !n.startsWith('✅') && !n.startsWith('❌'));

    const noteHtml = `
        <div style="text-align:left;font-size:13px;line-height:1.7;">
            <div style="font-weight:700;font-size:14px;color:#1e1b4b;margin-bottom:10px;">
                📊 Export Preview — <span style="color:#4f46e5">${filename}</span>
            </div>
            <div style="background:#f0f0ff;border:1px solid #c7d2fe;border-radius:8px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:600;color:#4f46e5;margin-bottom:6px;">📋 Details</div>
                <div>Sheet: <strong>${sheetName}</strong></div>
                <div>Total Records: <strong>${data.length}</strong></div>
                <div>Columns: <strong>${columns.length}</strong></div>
            </div>
            ${includeLines.length > 0 ? `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-bottom:8px;">
                <div style="font-weight:600;color:#15803d;margin-bottom:4px;">Included in Export</div>
                ${includeLines.map(l => `<div style="color:#166534;font-size:12px;">${l}</div>`).join('')}
            </div>` : ''}
            ${excludeLines.length > 0 ? `
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;margin-bottom:8px;">
                <div style="font-weight:600;color:#dc2626;margin-bottom:4px;">Not Included</div>
                ${excludeLines.map(l => `<div style="color:#991b1b;font-size:12px;">${l}</div>`).join('')}
            </div>` : ''}
            ${otherLines.length > 0 ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;">
                ${otherLines.map(l => `<div style="color:#92400e;font-size:12px;">${l}</div>`).join('')}
            </div>` : ''}
        </div>
    `;

    const result = await Swal.fire({
        title: 'Export to Excel',
        html: noteHtml,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="bi bi-file-earmark-excel me-2"></i>Download Excel',
        cancelButtonText: 'Cancel',
        width: 500,
    });

    if (!result.isConfirmed) return;

    // ── Build worksheet data ────────────────────────────────────────────────
    const ws = {};
    const wsName = sheetName.substring(0, 31); // Excel sheet name limit
    const totalCols = columns.length;

    // Row 1: Title / Export info
    const titleCellRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
    ws[titleCellRef] = {
        v: `${filename} — Exported on ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}`,
        t: 's',
        s: makeStyle({ bgColor: COLORS.titleBg, fontColor: COLORS.titleFg, bold: true, size: 11, halign: 'left' }),
    };
    // Merge title across all columns
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

    // Row 2: Notes (if any)
    let dataStartRow = 2; // 0-indexed; row 0=title, row 1=notes, row 2=headers by default
    if (notes.length > 0) {
        const noteCellRef = XLSX.utils.encode_cell({ r: 1, c: 0 });
        ws[noteCellRef] = {
            v: notes.join('  |  '),
            t: 's',
            s: makeStyle({ bgColor: COLORS.notesBg, fontColor: COLORS.notesFg, italic: true, size: 9, wrapText: false, halign: 'left' }),
        };
        ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });
        dataStartRow = 2;
    } else {
        dataStartRow = 1;
    }

    // Headers row
    const headerRow = dataStartRow;
    columns.forEach((col, ci) => {
        const ref = XLSX.utils.encode_cell({ r: headerRow, c: ci });
        ws[ref] = {
            v: col.header,
            t: 's',
            s: makeStyle({ bgColor: COLORS.headerBg, fontColor: COLORS.headerFg, bold: true, size: 10, halign: 'center' }),
        };
    });

    // Data rows
    data.forEach((row, ri) => {
        const rowIndex = headerRow + 1 + ri;
        const isEven = ri % 2 === 0;
        const bg = isEven ? COLORS.evenRowBg : COLORS.oddRowBg;

        columns.forEach((col, ci) => {
            const ref = XLSX.utils.encode_cell({ r: rowIndex, c: ci });
            let value = typeof col.key === 'function' ? col.key(row) : (row[col.key] ?? '');
            if (value === null || value === undefined) value = '';
            // Coerce numbers
            const isNum = col.type === 'number' || (typeof value === 'number');
            ws[ref] = {
                v: value,
                t: isNum ? 'n' : 's',
                s: makeStyle({ bgColor: bg, size: 10, wrapText: false }),
            };
        });
    });

    // Set sheet range
    const lastRow = headerRow + data.length;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: totalCols - 1 } });

    // Auto column widths (estimate from max content length)
    const colWidths = columns.map((col, ci) => {
        const headerLen = col.header.length;
        const maxDataLen = data.reduce((max, row) => {
            const val = typeof col.key === 'function' ? col.key(row) : (row[col.key] ?? '');
            return Math.max(max, String(val).length);
        }, 0);
        return { wch: Math.min(Math.max(headerLen, maxDataLen, 10) + 4, 50) };
    });
    ws['!cols'] = colWidths;

    // Row heights
    ws['!rows'] = [
        { hpt: 22 },  // Title row
        ...(notes.length > 0 ? [{ hpt: 16 }] : []),  // Notes row
        { hpt: 20 },  // Header row
        ...data.map(() => ({ hpt: 18 })),  // Data rows
    ];

    // ── Build workbook and trigger download ──────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, wsName);

    const safeFilename = filename.replace(/[/\\?%*:|"<>]/g, '_');
    XLSX.writeFile(wb, `${safeFilename}_${new Date().toISOString().split('T')[0]}.xlsx`);

    Swal.fire({
        title: 'Downloaded!',
        text: `${safeFilename}.xlsx has been saved to your downloads folder.`,
        icon: 'success',
        timer: 2500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
    });
};
