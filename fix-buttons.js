const fs = require('fs');
const files = [
  'src/components/Settings/SalaryAdmin.tsx',
  'src/components/Settings/TransactionStatusChecker.tsx',
  'src/components/Settings/staffSetting.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Find all <button ... > tags
  content = content.replace(/<button[^>]*>/g, (match) => {
    // Check if it has a className
    if (match.includes('className="')) {
      return match.replace(/className="([^"]*)"/, (classMatch, classString) => {
        // Remove existing text sizes
        let newClasses = classString.split(' ').filter(c => !c.match(/^text-(sm|base|lg|xl|2xl|3xl|4xl|[0-9]+px|\[[0-9]+px\])$/)).join(' ');
        if (!newClasses.includes('text-xs')) {
            newClasses += ' text-xs';
        }
        return `className="${newClasses.trim()}"`;
      });
    } else {
      // Add className="text-xs"
      return match.replace(/<button/, '<button className="text-xs"');
    }
  });

  fs.writeFileSync(file, content);
});
console.log("Done");
