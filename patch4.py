import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    content = f.read()

match = re.search(r"export_advances", content)
if match:
    print("Found export_advances")
else:
    print("Not found")

