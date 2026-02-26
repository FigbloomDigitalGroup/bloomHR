import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    text = f.read()

# Let's search inside the `MpesaCallbacks` function for export buttons.
lines = text.split('\n')
for i, line in enumerate(lines):
    if "ExportMpesaModal" in line:
        print(f"Found 'ExportMpesaModal' at line {i}")
