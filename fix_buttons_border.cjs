const fs = require('fs');

let content = fs.readFileSync('src/components/Settings/SalaryAdmin.tsx', 'utf8');

// The active tab was bg-blue-600, let's change it to a deeper matching style, or maybe user meant all buttons.
content = content.replace(
    /'bg-blue-600 text-white'/g,
    "'bg-[#d4e4ff] text-blue-800 border border-[#b8d1ff]'"
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

// The actual filter div
content = content.replace(
    /p-4 bg-gray-50 rounded-\[10px\] border border-gray-300/g,
    "p-4 bg-white rounded-[10px] border border-[#d4e4ff]"
);

// In case the tab buttons hover needs adjustment:
content = content.replace(
    /'bg-white text-gray-700 border border-\[\#d4e4ff\] hover:bg-\[\#e6f0ff\]'/g,
    "'bg-white text-gray-600 border border-[#d4e4ff] hover:bg-[#f2f7ff] hover:text-gray-900'"
);

fs.writeFileSync('src/components/Settings/SalaryAdmin.tsx', content);
console.log('Button styles updated.');
