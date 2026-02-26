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
  'className="p-4 bg-white rounded-[10px] border border-[#d4e4ff]"' // maybe leave it white with new border, or `#f2f7ff`? Let's make it `#f8fbff`
);

// Tab Buttons:
// Currently: 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
content = content.replace(
  /'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'/g,
  "'bg-white text-gray-700 border border-[#d4e4ff] hover:bg-[#e6f0ff]'"
);

// Fix the active tab button to also have a matching border if needed, but it's already 'bg-blue-600 text-white'. Let's give it a border too.
// Wait, the action buttons: Export, Import, Process Payments, Alerts.
// Let's change action buttons to have `border border-[#d4e4ff]` instead of just background colors, OR if they already have `bg-green-600` they might not need the blue border. 
// "buttons to have a thin border of a darker variation of that color": e.g. border-[#d4e4ff].
// Let's add `border border-[#b8d1ff]` to the colored ones, or maybe they should be white buttons with text colors?
// Let's just add `border border-[#d4e4ff]` to all the tab buttons.

fs.writeFileSync('src/components/Settings/SalaryAdmin.tsx', content);
console.log("Replaced bars");
