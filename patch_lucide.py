import re

with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'r') as f:
    text = f.read()

import_match = re.search(r"import \s*\{(.*?)\}\s*from\s*'lucide-react';", text, flags=re.DOTALL)
if import_match:
    old_lucide = import_match.group(1)
    if 'AlertTriangle' not in old_lucide:
        text = text.replace(old_lucide, old_lucide + ', AlertTriangle')
    if 'Clock' not in old_lucide:
        text = text.replace(old_lucide, old_lucide + ', Clock')
        
    with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'w') as f:
        f.write(text)

