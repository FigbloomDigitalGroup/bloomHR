import re

with open('/Users/mac/Downloads/ZiraPro/src/components/Settings/staffSetting.tsx', 'r') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if "button" in line and "Export" in line:
        print(f"[{i}] {line}")
