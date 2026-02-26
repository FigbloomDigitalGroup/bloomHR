import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Let's search where the "Export" button is rendered.
lines = text.split('\n')
for i, line in enumerate(lines):
    if "setShowExportModal(true)" in line:
        print(f"Found setShowExportModal(true) at line {i}")
        for j in range(i-5, i+5):
            if 0 <= j < len(lines):
                print(f"{j}: {lines[j]}")

