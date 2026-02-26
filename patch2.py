import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/SalaryAdmin.tsx', 'r') as f:
    content = f.read()

# Let's inspect the activeTab rendering block again to make sure I know how it's structured.
import sys

match = re.search(r"activeTab === 'settings'.*?\n(.*?)export default SalaryAdvanceAdmin;", content, re.DOTALL)
if match:
    print(match.group(1)[:1000])
else:
    print("Not found")

