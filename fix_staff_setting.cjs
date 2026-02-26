const fs = require('fs');
const files = ['src/components/Settings/staffSetting.tsx', 'src/components/Settings/SalaryAdmin.tsx'];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // Change generic white bar backgrounds
    content = content.replace(
        /className="bg-white rounded-\[10px\] shadow-sm border border-gray-200 p-6"/g,
        'className="bg-[#f2f7ff] rounded-[10px] shadow-sm border border-[#d4e4ff] p-6"'
    );

    // Buttons in staffSetting
    content = content.replace(
        /bg-red-600 text-white/g,
        'bg-white text-red-600 border border-[#d4e4ff] hover:bg-[#f2f7ff]'
    );
    content = content.replace(
        /bg-green-600 text-white/g,
        'bg-white text-green-600 border border-[#d4e4ff] hover:bg-[#f2f7ff]'
    );

    // Schedule settings button
    content = content.replace(
        /border border-gray-300 text-gray-700 rounded-\[10px\]/g,
        'border border-[#d4e4ff] text-gray-700 bg-white rounded-[10px] hover:bg-[#f2f7ff]'
    );

    // Cancel button
    content = content.replace(
        /border border-gray-300 text-gray-700 font-medium rounded-\[10px\] hover:bg-gray-50/g,
        'border border-[#d4e4ff] text-gray-700 bg-white font-medium rounded-[10px] hover:bg-[#f2f7ff]'
    );

    fs.writeFileSync(file, content);
});

console.log('staffSetting / extra bars style updated.');
