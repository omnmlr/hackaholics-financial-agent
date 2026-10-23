import os,json,urllib.request,urllib.parse,pathlib
stage='b9f8d2af-8aba-494b-a012-4d0424df33c8'
url='https://api.netlify.com/api/v1/accounts/6a744f70ab2dff1e7f50d8e2/env?site_id='+stage
request=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN']})
with urllib.request.urlopen(request,timeout=30) as response: variables=json.load(response)
assert variables and all(not item['key'].startswith('NEXT_PUBLIC_') for item in variables)
assert all(value.get('context')=='deploy-preview' for item in variables for value in item['values'])
values={item['key']:item['values'][0].get('value','') for item in variables}
assert values['AI_API_KEY']==os.environ['AI_API_KEY']
u=urllib.parse.urlparse(values['DATABASE_URL'])
assert u.hostname=='ep-square-sky-bazwbdb9-pooler.c-8.eu-central-1.aws.neon.tech'
assert u.username=='agus_staging_owner' and u.path=='/agus_staging'
assert values['AI_MODEL']=='gemini-3.5-flash-lite'
assert values['PAYMENT_MODE']=='fixture' and values['PAYMENTS_EMERGENCY_DISABLED']=='true'
assert not values['PAYSTACK_SECRET_KEY'] and not values['PAYSTACK_INTEGRATION_ID']
assert all(values[key]=='false' for key in ['PAYSTACK_TRANSFERS_ENABLED','LIVE_OWNER_AUTHORIZED','LIVE_TRANSFERS_ENABLED','LIVE_WEBHOOK_VALIDATED','LIVE_RECONCILIATION_VALIDATED'])
private=json.loads(pathlib.Path('/workspace/work/isolated-staging-private.json').read_text())
secrets=[values['DATABASE_URL'],u.password,values['AI_API_KEY'],values['OPERATOR_PASSWORD_HASH'],private['operatorPassword']]
paths=set()
for root in ['/workspace/work/agus-staging-app/.next/static','/workspace/work/agus-staging-app/.netlify/static']:
 paths.update(p for p in pathlib.Path(root).rglob('*') if p.is_file())
assert paths
for path in paths:
 data=path.read_bytes()
 assert all(value.encode() not in data for value in secrets if value)
result={'siteId':stage,'context':'deploy-preview','newGeminiKeyMatches':True,'isolatedDatabaseMatches':True,'noPublicEnvironmentNames':True,'paymentMode':'fixture','allTransfersDisabled':True,'clientFilesScanned':len(paths),'credentialLeaks':0,'configurationPassed':True}
if '--public' in __import__('sys').argv:
 import re,subprocess
 origin=private['origin']
 with urllib.request.urlopen(origin+'/conversation',timeout=45) as response:html=response.read()
 assert all(value.encode() not in html for value in secrets if value)
 scripts=set(re.findall(rb'<script[^>]+src="([^"]+)"',html))
 assert scripts
 for raw in scripts:
  path=raw.decode().replace('&amp;','&')
  assert path.startswith('/') and not path.startswith('//')
  with urllib.request.urlopen(origin+path,timeout=30) as response:data=response.read()
  assert all(value.encode() not in data for value in secrets if value)
 tracked=subprocess.check_output(['git','ls-files','-z'],cwd='/workspace/hackaholics-financial-agent').split(b'\0')
 for raw in tracked:
  if raw:
   data=(pathlib.Path('/workspace/hackaholics-financial-agent')/os.fsdecode(raw)).read_bytes()
   assert all(value.encode() not in data for value in secrets if value)
 result.update({'publicHtmlScanned':True,'publicScriptResponsesScanned':len(scripts),'trackedSourceCredentialLeaks':0})
if '--logs' in __import__('sys').argv:
 import time
 params=urllib.parse.urlencode({'from':int((time.time()-10800)*1000),'to':int(time.time()*1000)})
 logs_url='https://analytics.services.netlify.com/v2/sites/'+stage+'/function_logs/___netlify-server-handler?'+params
 request=urllib.request.Request(logs_url,headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN']})
 with urllib.request.urlopen(request,timeout=30) as response:rows=json.load(response).get('logs',[])
 matches=sum(any(value and value in row.get('message','') for value in secrets) for row in rows)
 assert matches==0
 result.update({'availableLogRowsScanned':len(rows),'logCredentialMatches':matches})
 candidates=__import__('subprocess').check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd='/workspace/work/agus-recovery-evidence').split(b'\0')
 for raw in candidates:
  if raw:
   path=pathlib.Path('/workspace/work/agus-recovery-evidence')/os.fsdecode(raw)
   if path.is_file():
    data=path.read_bytes()
    assert all(value.encode() not in data for value in secrets if value)
 result['evidenceBranchCredentialLeaks']=0
pathlib.Path('/workspace/work/staging-config-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
