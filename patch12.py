import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "setShowExportModal(true)" in line:
        print(f"[{i}] {line}")
