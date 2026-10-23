import os,json,pathlib,urllib.request,urllib.error,re,time,hashlib
ROOT=pathlib.Path('/workspace/work/agus-production-release')
SITE='fee8fc4a-b59d-4c8c-894b-599cf6d5a1e6'
ACCOUNT='6a744f70ab2dff1e7f50d8e2'
def fetch(url,authenticated=False):
 req=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN']} if authenticated else {})
 with urllib.request.urlopen(req,timeout=45) as r:return r.read()
def api(path):return json.loads(fetch('https://api.netlify.com/api/v1'+path,True))
def private(name,value):
 fd=os.open(ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2)
baseline={v['key']:v for v in json.loads((ROOT/'site-environment.json').read_text())}
current={v['key']:v for v in api('/accounts/'+ACCOUNT+'/env?site_id='+SITE)}
def normalized(v):return {k:x for k,x in v.items() if k not in ['updated_at','updated_by']}
assert set(baseline)==set(current)
for key in baseline:
 if key not in ['AI_API_KEY','AI_MODEL']:assert normalized(baseline[key])==normalized(current[key]),'Unapproved configuration drift'
old=baseline['AI_API_KEY'];new=current['AI_API_KEY']
assert new['is_secret'] is True and new['scopes']==old['scopes']
assert [v for v in old['values'] if v['context']!='production']==[v for v in new['values'] if v['context']!='production']
assert [(v['context'],v['id']) for v in old['values']]==[(v['context'],v['id']) for v in new['values']]
model=current['AI_MODEL']
old_model=next(v['value'] for v in baseline['AI_MODEL']['values'] if v['context']=='all')
assert model['is_secret']==baseline['AI_MODEL']['is_secret'] and model['scopes']==baseline['AI_MODEL']['scopes']
assert {v['context'] for v in model['values']}=={'dev','dev-server','branch-deploy','deploy-preview','production'}
assert all(v['value']==old_model for v in model['values'] if v['context']!='production')
assert next(v['value'] for v in model['values'] if v['context']=='production')=='gemini-3.5-flash-lite'
site=api('/sites/'+SITE);deploy=api('/deploys/'+site['published_deploy']['id'])
expected=json.loads((ROOT/'release-execution.json').read_text())
assert deploy['id']==expected['deployId'] and deploy['context']=='production' and deploy['state']=='ready' and deploy['locked'] is True
origin='https://askagus.netlify.app'
password=json.loads((ROOT/'production-operator-private.json').read_text())['operatorPassword']
stagepassword=json.loads(pathlib.Path('/workspace/work/isolated-staging-private.json').read_text())['operatorPassword']
secrets=[os.environ['AI_API_KEY'],password,stagepassword]
assert password!=stagepassword
html=fetch(origin+'/conversation')
assert all(s.encode() not in html for s in secrets if s)
scripts=set(re.findall(rb'<script[^>]+src="([^"]+)"',html));assert scripts
vendor_overlap=False
vendor=(ROOT/'app/node_modules/next/dist/build/polyfills/polyfill-nomodule.js').read_bytes()
for raw in scripts:
 path=raw.decode().replace('&amp;','&');assert path.startswith('/') and not path.startswith('//')
 data=fetch(origin+path)
 assert os.environ['AI_API_KEY'].encode() not in data and stagepassword.encode() not in data,'Credential found in public bundle'
 if password.encode() in data:
  # The supplied password overlaps a generic upstream feature-test literal.
  # Exclude it ONLY when the full asset exactly equals the installed vendor
  # file, which also predates receipt of this production password. No substring
  # redaction or heuristic allowance is used for application-generated assets.
  assert data==vendor,'Operator credential found in non-vendor public bundle'
  vendor_overlap=True
 assert b'ep-square-sky-bazwbdb9' not in data and b'ep-super-shadow-b9bfvcxs' not in data
params='from='+str(int((time.time()-3600)*1000))+'&to='+str(int(time.time()*1000))+'&deploy_id='+deploy['id']
logs=json.loads(fetch('https://analytics.services.netlify.com/v2/sites/'+SITE+'/function_logs/___netlify-server-handler?'+params,True)).get('logs',[])
assert all(not any(s and s in row.get('message','') for s in secrets) for row in logs),'Credential match in available logs'
# Never print raw log text or guessed redactions. Export only approved vocabulary.
vocabulary=['AUTHENTICATION_ERROR','UNAUTHENTICATED','API_KEY_INVALID','RESOURCE_EXHAUSTED','NARRATION_REFERENCE','missing_required_limit']
diagnostics={word:sum(word in row.get('message','') for row in logs) for word in vocabulary}
result={'siteId':SITE,'productionDeployId':deploy['id'],'releaseCommit':expected['commit'],'model':'gemini-3.5-flash-lite','state':'ready','context':'production','locked':True,'productionKeySecret':True,'productionKeyScopes':new['scopes'],'nonProductionKeyContextsUnchanged':True,'nonProductionModelEffectiveValuesUnchanged':True,'modelAllContextExpandedByNetlify':True,'allOtherVariablesUnchanged':True,'productionDatabaseBindingUnchanged':True,'operatorIdentityAndHashUnchanged':True,'paymentSettingsUnchanged':True,'stagingOperatorPasswordNotReused':True,'publicScriptResponsesScanned':len(scripts),'publicCredentialDerivedLeaks':0,'preExistingVendorTextOverlapExcludedByExactFileEquality':vendor_overlap,'availableLogRowsScanned':len(logs),'logCredentialMatches':0,'closedDiagnosticCounts':diagnostics,'oldDeploymentRetained':api('/deploys/6ada1aa358e288da5818c039')['state']=='ready'}
private('final-site-environment.json',list(current.values()))
private('live-configuration-verification.json',result)
print(json.dumps(result,indent=2))
