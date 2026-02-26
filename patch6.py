import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Let's search where ExportModal is called
lines = text.split('\n')
for i, line in enumerate(lines):
    if "<ExportModal" in line:
        print(f"Found <ExportModal at line {i}")

