import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Just checking `onExport={handleExport}` inside the applications tab block
lines = text.split('\n')
export_def = []
for i, line in enumerate(lines):
    if "const handleExport =" in line:
        for j in range(i, i+50):
            if 0 <= j < len(lines):
                export_def.append(lines[j])
                if "};" in lines[j] and j > i + 5:
                    break

print("\n".join(export_def))
