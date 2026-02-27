const fs = require('fs');
const files = ['screens/reports.js', 'screens/loans.js'];

files.forEach(f => {
    let code = fs.readFileSync(f, 'utf8');
    
    // regex to replace spaces after < or </ for standard html tags
    code = code.replace(/<\s+(div|span|h\d|label|strong|b\b)/g, '<$1');
    code = code.replace(/<\/\s+(div|span|h\d|label|strong|b\b)/g, '</$1');
    
    fs.writeFileSync(f, code);
    console.log(`Fixed ${f}`);
});
