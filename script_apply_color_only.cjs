const fs = require('fs');

let content = fs.readFileSync('src/components/Settings/SalaryAdmin.tsx', 'utf8');

// 1. Report Header Bar
content = content.replace(
    'className="mb-6 bg-white rounded-[10px] border border-gray-300 p-6 shadow-sm"',
    'className="mb-6 bg-[#f2f7ff] rounded-[10px] border border-[#d4e4ff] p-6 shadow-sm"'
);

// 2. Action Bar
content = content.replace(
    'className="bg-white rounded-[10px] border border-gray-300 shadow-sm p-4 mb-6"',
    'className="bg-[#f2f7ff] rounded-[10px] border border-[#d4e4ff] shadow-sm p-4 mb-6"'
);

// 3. Search / Filter bar
content = content.replace(
    'className="p-4 bg-gray-50 rounded-[10px] border border-gray-300"',
    'className="p-4 bg-white rounded-[10px] border border-[#d4e4ff]"'
);

// Active Tab buttons
content = content.replace(
    /'bg-blue-600 text-white'/g,
    "'bg-[#d4e4ff] text-blue-800 border border-[#b8d1ff]'"
);

// Inactive Tab Buttons:
content = content.replace(
    /'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'/g,
    "'bg-white text-gray-600 border border-[#d4e4ff] hover:bg-[#f2f7ff] hover:text-gray-900'"
);

// Pending approvals button
content = content.replace(
    /bg-orange-500 hover:bg-orange-600 text-white/g,
    "bg-white text-orange-600 hover:text-orange-700 border border-[#d4e4ff] hover:bg-[#f2f7ff]"
);

// Process Payments button
content = content.replace(
    /bg-green-700 hover:bg-green-800 text-white/g,
    "bg-white text-green-700 hover:text-green-800 border border-[#d4e4ff] hover:bg-[#f2f7ff]"
);

// Export button
content = content.replace(
    /bg-green-600 hover:bg-green-700 text-white/g,
    "bg-white text-green-600 hover:text-green-700 border border-[#d4e4ff] hover:bg-[#f2f7ff]"
);

// Import button
content = content.replace(
    /bg-purple-600 hover:bg-purple-700 text-white/g,
    "bg-white text-purple-600 hover:text-purple-700 border border-[#d4e4ff] hover:bg-[#f2f7ff]"
);

// Reset Filters button
content = content.replace(
    /text-gray-600 hover:text-gray-800 border border-gray-300 rounded bg-white hover:bg-gray-50/g,
    "text-gray-600 hover:text-gray-800 border border-[#d4e4ff] rounded bg-white hover:bg-[#f2f7ff]"
);

fs.writeFileSync('src/components/Settings/SalaryAdmin.tsx', content);

// Also staff Setting bars
let content2 = fs.readFileSync('src/components/Settings/staffSetting.tsx', 'utf8');

// Change generic white bar backgrounds
content2 = content2.replace(
    /className="bg-white rounded-\[10px\] shadow-sm border border-gray-200 p-6"/g,
    'className="bg-[#f2f7ff] rounded-[10px] shadow-sm border border-[#d4e4ff] p-6"'
);

// Buttons in staffSetting
content2 = content2.replace(
    /bg-red-600 text-white/g,
    'bg-white text-red-600 border border-[#d4e4ff] hover:bg-[#f2f7ff]'
);
content2 = content2.replace(
    /bg-green-600 text-white/g,
    'bg-white text-green-600 border border-[#d4e4ff] hover:bg-[#f2f7ff]'
);

// Schedule settings button
content2 = content2.replace(
    /border border-gray-300 text-gray-700 rounded-\[10px\]/g,
    'border border-[#d4e4ff] text-gray-700 bg-white rounded-[10px] hover:bg-[#f2f7ff]'
);

// Cancel button
content2 = content2.replace(
    /border border-gray-300 text-gray-700 font-medium rounded-\[10px\] hover:bg-gray-50/g,
    'border border-[#d4e4ff] text-gray-700 bg-white font-medium rounded-[10px] hover:bg-[#f2f7ff]'
);

fs.writeFileSync('src/components/Settings/staffSetting.tsx', content2);

console.log('Restored simple beautiful bars with simple styling only.');
