#!/usr/bin/env python3
"""Public TEST authentication admission only. Defaults to dry-run; never calls banking APIs."""
import argparse
import datetime
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request

COLLECTION_URL = 'https://api.remita.net/api/collections/24289864/2sAY4vi3YC?segregateAuth=true&versionTag=latest'
SDK_SHA = 'af6ae4b62b600cfb07c128103d63c81a3963d491'
SDK_URL = f'https://raw.githubusercontent.com/RemitaPaymentServices/rits-sdk-dotnet-v3/{SDK_SHA}/README.md'
TOKEN_URL = 'https://demo.remita.net/remita/exapp/api/v1/send/api/uaasvc/uaa/token'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def requests(items, prefix=''):
    for item in items:
        path = prefix + '/' + item.get('name', '')
        if 'item' in item:
            yield from requests(item['item'], path)
        elif 'request' in item:
            yield path, item['request']

def folders(items, prefix=''):
    for item in items:
        path = prefix + '/' + item.get('name', '')
        if 'item' in item:
            yield path, re.sub('<[^>]+>', ' ', item.get('description', ''))
            yield from folders(item['item'], path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sandbox-token', action='store_true', help='One public TEST token POST; no banking operations')
    args = parser.parse_args()
    result = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'mode': 'sandbox_token' if args.sandbox_token else 'dry_run',
              'token_endpoint': TOKEN_URL, 'sdk_commit': SDK_SHA,
              'source_links': [COLLECTION_URL, SDK_URL],
              'financial_api_calls': 0, 'token_posts': 0,
              'returned_token_persisted': False,
              'consumer_source_authority': 'unknown; engine token cannot establish source consent'}
    if not args.sandbox_token:
        result['outcome'] = 'No network requests; use --sandbox-token for public documented TEST admission only'
        print(json.dumps(result, indent=2))
        return
    opener = urllib.request.build_opener(NoRedirect())
    def read_public(url):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with opener.open(req, timeout=20) as response:
            return response.read()
    collection_bytes = read_public(COLLECTION_URL)
    sdk_bytes = read_public(SDK_URL)
    collection = json.loads(collection_bytes)
    sdk = sdk_bytes.decode('utf-8-sig')
    result['source_sha256'] = {'collection': hashlib.sha256(collection_bytes).hexdigest(),
                               'sdk_readme': hashlib.sha256(sdk_bytes).hexdigest()}
    firstgen = next(text for path, text in folders(collection['item']) if path == '/Authentication- First Generation APIs')
    result['first_generation_public_test_permission_found'] = bool(re.search(r'utilise test credentials', firstgen, re.I))
    result['sdk_explicit_demo_test_provenance'] = 'Sample Demo Code' in sdk and 'RemitaRITs(EnvironmentConfig.TEST)' in sdk
    if not result['first_generation_public_test_permission_found'] or not result['sdk_explicit_demo_test_provenance']:
        raise SystemExit('Public TEST provenance changed; stop for review')
    transfer = next(text for path, text in folders(collection['item']) if path == '/Funds Transfer/Rest Interface')
    result['current_rest_invitation_gate_documented'] = 'invitation link' in transfer.lower()
    token_request = next(req for path, req in requests(collection['item']) if path.endswith('/Generate Token'))
    token_url = token_request['url']
    if isinstance(token_url, dict):
        token_url = token_url.get('raw', '')
    if token_url != TOKEN_URL or urllib.parse.urlparse(token_url).hostname != 'demo.remita.net':
        raise SystemExit('Token URL changed or is not exact allowlisted demo endpoint')
    current_body = json.loads(token_request['body']['raw'])
    result['current_collection_credential_fields_are_placeholders'] = all(
        isinstance(v, str) and bool(re.search(r'[<>]|\{\{', v)) for v in current_body.values())
    # Only public literal values in the explicitly labelled demo TEST example.
    username = re.search(r'generateTokenPayload\.username\s*=\s*"([^"{}<>]+)"', sdk)
    password = re.search(r'generateTokenPayload\.password\s*=\s*"([^"{}<>]+)"', sdk)
    if not username or not password:
        raise SystemExit('No explicitly documented literal demo sample; stop without probing')
    body = json.dumps({'username': username.group(1), 'password': password.group(1)}).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method='POST',
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    result['token_posts'] = 1
    try:
        with opener.open(req, timeout=20) as response:
            result['http_status'] = response.status
            payload_bytes = response.read()
    except urllib.error.HTTPError as error:
        result['http_status'] = error.code
        payload_bytes = error.read()
    except (urllib.error.URLError, TimeoutError) as error:
        result['transport_failure_type'] = type(error).__name__
        result['outcome'] = 'No admission result; transport failed; no retry'
        print(json.dumps(result, indent=2))
        return
    try:
        payload = json.loads(payload_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = None
    result['response_is_json'] = payload is not None
    result['response_bytes'] = len(payload_bytes)
    token_keys = []
    def inspect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.lower().replace('_', '') in ('accesstoken', 'token') and isinstance(child, str) and child:
                    token_keys.append(key)
                if isinstance(child, (dict, list)):
                    inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)
    inspect(payload)
    result['response_top_level_keys'] = sorted(payload) if isinstance(payload, dict) else []
    result['nonempty_token_field_names'] = sorted(set(token_keys))
    result['outcome'] = ('Engine authentication token returned; consumer-source authority unproven'
                         if 200 <= result['http_status'] < 300 and token_keys
                         else 'Public TEST sample did not establish token admission; no retry or bank call')
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
