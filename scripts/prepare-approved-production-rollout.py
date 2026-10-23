"""Prepared production release. Do not execute before explicit final approval.

No secret arguments, printing, environment dumps, migrations, payment operations,
or changes to DATABASE_URL/operator/Railway. Errors expose HTTP status only.
"""
import os,sys,json,pathlib,hashlib,urllib.request,urllib.error,subprocess,datetime,time
ROOT=pathlib.Path('/workspace/work/agus-production-release')
SITE='fee8fc4a-b59d-4c8c-894b-599cf6d5a1e6'
ACCOUNT='6a744f70ab2dff1e7f50d8e2'
OLD='6ada1aa358e288da5818c039'
NODE='/tmp/agus-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node'
CLI='/tmp/agus-netlify-cli-cache/_npx/da5c1b6ea715e8b4/node_modules/netlify-cli/bin/run.js'
BASE=json.loads((ROOT/'site-environment.json').read_text())
def operator_password():
 return os.environ.get('PRODUCTION_OPERATOR_PASSWORD') or json.loads((ROOT/'production-operator-private.json').read_text())['operatorPassword']
def private(name,value):
 fd=os.open(ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2)
def api(path,method='GET',body=None):
 req=urllib.request.Request('https://api.netlify.com/api/v1'+path,method=method,
  headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN'],'Content-Type':'application/json'},
  data=json.dumps(body).encode() if body is not None else None)
 try:
  with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError('Netlify HTTP '+str(e.code)) from None
def env():return api('/accounts/'+ACCOUNT+'/env?site_id='+SITE)
def path(key):return '/accounts/'+ACCOUNT+'/env/'+key+'?site_id='+SITE
def normalized(v):
 return {k:x for k,x in v.items() if k not in ['updated_at','updated_by']}
def stable_untouched(current,allow=()):
 a={v['key']:normalized(v) for v in BASE if v['key'] not in allow}
 b={v['key']:normalized(v) for v in current if v['key'] not in allow}
 assert a==b,'Unapproved environment drift; stop and review'
def key_metadata(current):
 original=next(v for v in BASE if v['key']=='AI_API_KEY')
 new=next(v for v in current if v['key']=='AI_API_KEY')
 assert new['is_secret'] is True and new['scopes']==original['scopes']
 assert [{k:x for k,x in v.items() if k!='value'} for v in new['values']]==[{k:x for k,x in v.items() if k!='value'} for v in original['values']]
 assert [v for v in new['values'] if v['context']!='production']==[v for v in original['values'] if v['context']!='production']
def remove_model_override():
 var=api(path('AI_MODEL'))
 prod=[v for v in var['values'] if v['context']=='production']
 assert not any(v['context']=='production' for v in next(v for v in BASE if v['key']=='AI_MODEL')['values'])
 for v in prod:
  req=urllib.request.Request('https://api.netlify.com/api/v1/accounts/'+ACCOUNT+'/env/AI_MODEL/value/'+v['id']+'?site_id='+SITE,method='DELETE',headers={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN']})
  with urllib.request.urlopen(req,timeout=30) as r:r.read()
def restore_runtime(reason):
 restored=api('/sites/'+SITE+'/deploys/'+OLD+'/restore','POST')
 assert restored['id']==OLD
 locked=api('/deploys/'+OLD+'/lock','POST');assert locked['locked'] is True
 remove_model_override()
 stable_untouched(env(),allow=('AI_API_KEY','AI_MODEL'))
 private('rollback-execution.json',{'reason':reason,'restoredDeploy':OLD,'locked':True,'runtimeEnvironmentRestoredByDeploy':True,'siteKeyBindingMayStillBeNew':True,'oldSecretNotRetrievable':True})
 print(json.dumps({'rollbackPublished':OLD,'locked':True,'siteKeyBindingMayStillBeNew':True}))
def preflight():
 assert api('/sites/'+SITE)['published_deploy']['id']==OLD,'Production deployment changed'
 stable_untouched(env())
 assert os.environ.get('AI_API_KEY') and operator_password(),'Required secure runtime credential missing'
 manifest=json.loads((ROOT/'package-manifest.json').read_text())
 assert manifest['commit']=='6fbbcf66fb5233e4b554f91cbde1508ad72a369d'
 for item in manifest['files']:
  p=ROOT/'app'/item['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],'Artifact drift'
 state=json.loads(pathlib.Path('/workspace/work/isolated-staging-private.json').read_text())
 assert operator_password()!=state['operatorPassword'],'Staging password must not be reused'
 print(json.dumps({'preflightPassed':True,'productionUnchanged':True}))
mode=sys.argv[1] if len(sys.argv)>1 else '--check'
if mode=='--check':preflight()
elif mode=='--execute-approved':
 preflight()
 # Production override leaves all-context model and other contexts intact.
 api(path('AI_MODEL'),'PATCH',{'context':'production','value':'gemini-3.5-flash-lite'})
 try:
  # Value-only PATCH does not request a scope/secret-flag change. A rejection
  # stops the rollout; it NEVER falls back to a standard variable.
  api(path('AI_API_KEY'),'PATCH',{'context':'production','value':os.environ['AI_API_KEY']})
 except Exception:
  remove_model_override()
  raise
 current=env();key_metadata(current);stable_untouched(current,allow=('AI_API_KEY','AI_MODEL'))
 private('after-value-update.json',current)
 # Deploy the independently built, scanned zip rather than silently rebundling
 # dependencies. CLI's two-minute function cache is renewed only after preflight.
 manifest_path=ROOT/'app/.netlify/functions/manifest.json'
 manifest=json.loads(manifest_path.read_text())
 manifest['timestamp']=int(time.time()*1000)
 manifest_path.write_text(json.dumps(manifest))
 deploy_env=dict(os.environ,XDG_CONFIG_HOME='/workspace/work/netlify-cli-config',NETLIFY_TELEMETRY_DISABLED='1',NODE_USE_ENV_PROXY='1')
 deploy_env.pop('PRODUCTION_OPERATOR_PASSWORD',None)
 result=subprocess.run([NODE,CLI,'deploy','--site',SITE,'--prod','--dir','.netlify/static','--no-build','--json','--message','Approved AGUS recovery 6fbbcf6 Gemini 3.5 Flash-Lite'],cwd=ROOT/'app',env=deploy_env,text=True,capture_output=True)
 # Keep complete tool output private, then scan for credential matches before
 # exposing even the filtered deployment identifiers.
 private('deploy-command-result.json',{'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
 assert all(s not in result.stdout+result.stderr for s in [os.environ['AI_API_KEY'],operator_password()]),'Credential found in private CLI output; no output exposed'
 if result.returncode:
  restore_runtime('deployment-command-failed')
  raise RuntimeError('Deploy failed; runtime rolled back and locked')
 try:
  parsed=json.loads(result.stdout)
  deployed=api('/deploys/'+parsed['deploy_id'])
  assert deployed['site_id']==SITE and deployed['context']=='production' and deployed['state']=='ready'
  assert api('/sites/'+SITE)['published_deploy']['id']==deployed['id']
  stable_untouched(env(),allow=('AI_API_KEY','AI_MODEL'));key_metadata(env())
  # The connected Git production branch still points to 869b5b9. A deploy lock
  # prevents an automatic rebuild of that branch from replacing the repair.
  locked=api('/deploys/'+deployed['id']+'/lock','POST');assert locked['locked'] is True
 except Exception:
  restore_runtime('deployment-verification-failed')
  raise
 private('release-execution.json',{'siteId':SITE,'deployId':deployed['id'],'commit':'6fbbcf66fb5233e4b554f91cbde1508ad72a369d','model':'gemini-3.5-flash-lite','state':'deployed-awaiting-genuine-acceptance','locked':True,'rollbackDeployId':OLD,'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 print(json.dumps({'productionDeployId':deployed['id'],'state':'deployed-awaiting-genuine-acceptance','url':'https://askagus.netlify.app'}))
elif mode=='--rollback-approved':
 assert (ROOT/'release-execution.json').exists() or (ROOT/'after-value-update.json').exists(),'No recovery rollout recorded'
 restore_runtime('genuine-acceptance-regression')
else:raise SystemExit('Unknown mode')
