const fs = require('fs');

const files = [
    'src/components/Settings/SalaryAdmin.tsx',
    'src/components/Settings/TransactionStatusChecker.tsx',
    'src/components/Settings/staffSetting.tsx'
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // Fix the broken previous replace
    content = content.replace(/rounded-\[10px\]-full/g, 'rounded-full');

    // Revert all previous rounded-[10px] to base text to do a clean parse
    // Actually, wait, let's just parse the actual string:
    content = content.replace(/<(div|table|nav|ul|li|section)([^>]*?)className=(["'`])(.*?)\3/g, (match, tag, before, quote, classStr) => {
        // We want to replace container curves like rounded-lg, rounded-xl, rounded-2xl, rounded-3xl, rounded-[anything] with rounded-[10px]
        // EXCEPT we do NOT replace rounded-full because that's for circles/badges.

        let originalClasses = classStr.split(' ');
        let newClasses = originalClasses.map(c => {
            if (c.startsWith('rounded-') && c !== 'rounded-full' && c !== 'rounded-t-lg' && c !== 'rounded-b-lg' && c !== 'rounded-l-md' && c !== 'rounded-r-md' && !c.includes('rounded-full')) {
                return 'rounded-[10px]';
            }
            if (c === 'rounded') {
                return 'rounded-[10px]';
            }
            return c;
        });

        return `<${tag}${before}className=${quote}${newClasses.join(' ')}${quote}`;
    });

    fs.writeFileSync(file, content);
});
console.log("Fixed");
