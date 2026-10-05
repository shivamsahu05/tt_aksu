const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'TT CSE _sample_analysing.xlsx');
const workbook = XLSX.readFile(filePath);

console.log('Sheets:', workbook.SheetNames);
workbook.SheetNames.forEach(name => {
    console.log('\n======= Sheet:', name, '=======');
    const ws = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    data.slice(0, 30).forEach((row, i) => {
        if (row.some(c => c !== '')) console.log(`Row ${i}:`, row.map(c => String(c).trim().slice(0, 30)).join(' | '));
    });
});
