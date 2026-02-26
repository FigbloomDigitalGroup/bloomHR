import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Let's search where ExportModal is declared
# It appears around line 6615 based on our previous view_file.

lines = text.split('\n')
for i, line in enumerate(lines):
    if "ExportModal" in line and "isOpen" in line:
        print(f"Found ExportModal at line {i}")
        for j in range(i-5, i+5):
            if 0 <= j < len(lines):
                print(f"{j}: {lines[j]}")
        break

