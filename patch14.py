import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Checking where "Export M-Pesa Statements" vs "Export Salary Advances" are located
lines = text.split('\n')
for i, line in enumerate(lines):
    if "Export M-Pesa Statements" in line or "Export Salary Advances" in line:
        print(f"Found '{line.strip()}' at line {i}")
