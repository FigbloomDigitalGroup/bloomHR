import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/staffSetting.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "Export" in line or "export" in line:
        print(f"[{i}] {line}")
