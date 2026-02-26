import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "ExportModal" in line and "Export Salary Advances" in line:
        print(f"Found 'Export Salary Advances' at line {i}")
        for j in range(i-5, i+5):
            if 0 <= j < len(lines):
                print(f"{j}: {lines[j]}")
        break

