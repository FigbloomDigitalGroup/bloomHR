import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "export_advances" in line or "export_salary" in line or "export" in line:
        pass # Too much output?

matches = []
for i, line in enumerate(lines):
    if "<button" in line and "Export" in line:
        matches.append(line.strip() + " (line " + str(i) + ")")

print("\n".join(matches))

