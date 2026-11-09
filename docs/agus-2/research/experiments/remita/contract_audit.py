"""Network-free static audit of already downloaded public SDKs/specification.
No imports/execution of third-party code, HTTP clients, credentials or financial requests.
"""
import re, json, pathlib, argparse, hashlib
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", required=True, type=pathlib.Path)
args = parser.parse_args()
p = args.cache_dir
manifest = json.loads(pathlib.Path(__file__).with_name("sources.json").read_text())
for name, entry in manifest.items():
    actual = hashlib.sha256((p / name).read_bytes()).hexdigest()
    if actual != entry["sha256"]:
        raise SystemExit(f"Source differs from observed snapshot: {name}; do not reuse historical conclusions without review")
php=(p/'rits-service.php').read_text();cs=(p/'v3-single-payload.cs').read_text();wire=(p/'v3-single.cs').read_text();enquiry=(p/'v3-enquiry-data.cs').read_text()
methods=re.findall(r'public static function\s+(\w+)',php)
fields=re.findall(r'public\s+(?:string|int|bool)\s+(\w+)\s*\{',cs)
wire_fields=re.findall(r'(\w+)\s*=\s*singlePaymentPayload\.',wire)
assert {'sourceAccount','sourceBankCode','destinationAccount','destinationBankCode'} <= set(fields)
assert set(fields)==set(wire_fields)
assert 'addAccount' not in methods and 'validateAccountOTP' not in methods
rows=[]
def walk(xs,path=''):
 for x in xs:
  n=path+'/'+x.get('name','')
  if 'item'in x:walk(x['item'],n)
  else:rows.append(n)
walk(json.loads((p/'remita-collection.raw').read_text())['item'])
result={'kind':'offline_static_contract_inspection','third_party_code_executed':False,'network_calls_during_audit':0,'financial_operations':0,'php_v1_gateway_methods':methods,'php_readme_link_methods_missing_from_gateway':['addAccount','validateAccountOTP'],'v3_payload_fields':fields,'v3_serialized_body_matches_payload_fields':True,'v3_enquiry_fields':re.findall(r'public\s+string\s+(\w+)\s*\{',enquiry),'current_postman_endpoint_count':len(rows),'history_named_endpoints':[r for r in rows if 'history'in r.lower()],'not_proven':['bank_source_authority','20_source_bank_coverage','general_balance_or_transaction_history','provider_access','fee_parity','payment_execution']}
result['source_hashes'] = {name: entry['sha256'] for name, entry in manifest.items()}
print(json.dumps(result, indent=2))
