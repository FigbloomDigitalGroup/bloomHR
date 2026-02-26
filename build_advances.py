import re

with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'r') as f:
    text = f.read()

text = re.sub(r'const formatDate =\s*\(date: string\) => new Date\(date\)\.toLocaleDateString\(\'en-GB\', \{ day: \'2-digit\', month: \'short\', year: \'numeric\' \}\);\s*const totalActive = .*?return\s*\(', 'return (', text, flags=re.DOTALL)

with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'w') as f:
    f.write(text)

