import os
import json
import urllib.request
from urllib.error import HTTPError

env_path = '/Users/mac/Desktop/ZIRA/.env'
env = {}
with open(env_path) as f:
    for line in f:
        if '=' in line:
            k, v = line.strip().split('=', 1)
            env[k] = v.strip('\"\'')

url = f"{env['VITE_SUPABASE_URL']}/rest/v1/hr_salary_advances?select=*&limit=5"
req = urllib.request.Request(url, headers={
    'apikey': env['VITE_SUPABASE_ANON_KEY'],
    'Authorization': f"Bearer {env['VITE_SUPABASE_ANON_KEY']}"
})

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        print(json.dumps(data, indent=2))
except HTTPError as e:
    print(e.read())
