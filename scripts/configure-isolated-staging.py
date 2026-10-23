import sys,os,json,pathlib,secrets,hashlib,urllib.request,urllib.parse

uri=os.environ.get('STAGING_DATABASE_URL')
if not uri:
 print(json.dumps({'configured':False,'code':'SECURE_STAGING_DATABASE_BINDING_REQUIRED'}),flush=True)
 sys.exit(2)
u=urllib.parse.urlparse(uri)
assert u.hostname in ['ep-square-sky-bazwbdb9.c-8.eu-central-1.aws.neon.tech','ep-square-sky-bazwbdb9-pooler.c-8.eu-central-1.aws.neon.tech']
assert u.path=='/agus_staging' and u.username=='agus_staging_owner'
site=json.loads(pathlib.Path('/workspace/work/staging-site.json').read_text())
assert site['id']=='b9f8d2af-8aba-494b-a012-4d0424df33c8'
assert site['id']!='fee8fc4a-b59d-4c8c-894b-599cf6d5a1e6'
origin='https://staging--'+site['name']+'.netlify.app'
password=secrets.token_urlsafe(24)
salt=secrets.token_hex(16)
password_hash=salt+':'+hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64).hex()
settings={
 'DATABASE_URL':uri,'AI_API_KEY':os.environ['AI_API_KEY'],
 'OPERATOR_PASSWORD_HASH':password_hash,'OPERATOR_ID':'isolated-staging-operator',
 'AI_PROVIDER':'gemini','AI_MODEL':'gemini-3.5-flash-lite',
 'AGUS_AGENT_ARCHITECTURE':'native-gemini','PAYMENT_MODE':'fixture',
 'FINANCIAL_DEMO_ENABLED':'true','APP_ORIGIN':origin,'APP_TIMEZONE':'Africa/Lagos',
 'PAYSTACK_SECRET_KEY':'','PAYSTACK_INTEGRATION_ID':'',
 'PAYSTACK_TRANSFERS_ENABLED':'false','LIVE_OWNER_AUTHORIZED':'false',
 'LIVE_TRANSFERS_ENABLED':'false','LIVE_WEBHOOK_VALIDATED':'false',
 'LIVE_RECONCILIATION_VALIDATED':'false','PAYMENTS_EMERGENCY_DISABLED':'true',
 'NODE_VERSION':'22','NEXT_TELEMETRY_DISABLED':'1',
}
secret_keys={'DATABASE_URL','AI_API_KEY','OPERATOR_PASSWORD_HASH'}
env=[{'key':k,'scopes':['functions'] if k!='NODE_VERSION' else ['builds'],
 'is_secret':k in secret_keys,'values':[{'context':'all','value':v}]} for k,v in settings.items()]
headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN'],'Content-Type':'application/json'}
url='https://api.netlify.com/api/v1/accounts/'+site['account_id']+'/env?site_id='+site['id']
req=urllib.request.Request(url,headers=headers,data=json.dumps(env).encode(),method='POST')
try:
 with urllib.request.urlopen(req,timeout=30) as response: response.read()
except Exception as error:
 print(json.dumps({'configured':False,'httpStatus':getattr(error,'code',None)}),flush=True)
 sys.exit(1)
private={'siteId':site['id'],'origin':origin,'operatorPassword':password,'operatorId':settings['OPERATOR_ID']}
p=pathlib.Path('/workspace/work/isolated-staging-private.json')
fd=os.open(str(p),os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(private,f)
print(json.dumps({'configured':True,'siteId':site['id'],'origin':origin,'settingNames':list(settings),'privateValuesLogged':False}),flush=True)
