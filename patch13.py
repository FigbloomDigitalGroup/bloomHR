import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "export_advances" in line or "export advances" in line.lower() or "export_salary" in line:
        print(f"[{i}] {line}")
