import re

with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'r') as f:
    text = f.read()

# Let's count where the return statement is
returns = [m.start() for m in re.finditer('return \\(', text)]
print(len(returns), "returns found")
if len(returns) == 2:
    text = text[:returns[1]] + text[returns[1]:].replace('return (', '', 1)

with open('/Users/mac/Downloads/ZiraPro/src/components/HR/AdvanceDeductionModule.tsx', 'w') as f:
    f.write(text)

