import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/staffSetting.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "export" in line.lower():
        print(f"[{i}] {line}")
