const fs = require('fs');

const files = [
    'src/components/Settings/SalaryAdmin.tsx',
    'src/components/Settings/TransactionStatusChecker.tsx',
    'src/components/Settings/staffSetting.tsx'
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    let result = '';
    let i = 0;
    while (i < content.length) {
        if (content.substr(i, 7) === '<button') {
            let j = i + 7;
            let openBraces = 0;
            let inString = false;
            let stringChar = '';

            while (j < content.length) {
                const char = content[j];
                if (!inString) {
                    if (char === '"' || char === '\'' || char === '`') {
                        inString = true;
                        stringChar = char;
                    } else if (char === '{') {
                        openBraces++;
                    } else if (char === '}') {
                        openBraces--;
                    } else if (char === '>' && openBraces === 0) {
                        break;
                    }
                } else {
                    if (char === '\\') {
                        j++; // skip escaped char
                    } else if (char === stringChar) {
                        inString = false;
                    }
                }
                j++;
            }

            let match = content.substring(i, j + 1);

            // Replace existing text size classes with text-xs
            let newMatch = match.replace(/\btext-(sm|md|base|lg|xl|2xl|3xl|4xl|5xl)\b/g, 'text-xs');
            newMatch = newMatch.replace(/\btext-\[\d+px\]/g, 'text-xs');

            // Ensure text-xs is present
            if (!newMatch.includes('text-xs')) {
                if (newMatch.includes('className="')) {
                    newMatch = newMatch.replace('className="', 'className="text-xs ');
                } else if (newMatch.includes("className='")) {
                    newMatch = newMatch.replace("className='", "className='text-xs ");
                } else if (newMatch.includes('className={`')) {
                    newMatch = newMatch.replace('className={`', 'className={`text-xs ');
                } else if (newMatch.includes('className={')) {
                    newMatch = newMatch.replace('<button', '<button className="text-xs"');
                } else {
                    newMatch = newMatch.replace('<button', '<button className="text-xs"');
                }
            }

            // Eliminate double text-xs
            newMatch = newMatch.replace(/\btext-xs(\s+text-xs)+\b/g, 'text-xs');

            result += newMatch;
            i = j + 1;
        } else {
            result += content[i];
            i++;
        }
    }

    fs.writeFileSync(file, result);
});
console.log("Done");
