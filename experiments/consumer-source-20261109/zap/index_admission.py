#!/usr/bin/env python3
"""Read-only discovery of Index's public developer surface, never bank access.

Default is offline. --live performs only fixed public GETs. No registration,
OAuth authorization/token exchange, MCP methods, account reads or payments exist
in this program. Public registration metadata is not permission for a custom agent.
"""
import argparse
import datetime
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

PUBLIC = {
    'server': 'https://mcp.paystack.africa/',
    'oauth': 'https://mcp.paystack.africa/.well-known/oauth-authorization-server',
    'supported_agents': 'https://index.paystack.com/legal/support/supported-agents',
    'transfers': 'https://index.paystack.com/legal/support/transfers-and-zap',
    'privacy': 'https://index.paystack.com/legal/privacy',
    'terms': 'https://index.paystack.com/legal/terms',
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def normalized_html(raw):
    parser = Text()
    parser.feed(raw.decode('utf-8', errors='replace'))
    return ' '.join(' '.join(parser.parts).split()).casefold()


def discover():
    opener = urllib.request.build_opener(NoRedirect())
    records, payloads = {}, {}
    for label, url in PUBLIC.items():
        # Only fixed public metadata/documentation URLs; never follow redirects
        # to an authorization page, token service, account or payment endpoint.
        request = urllib.request.Request(url, method='GET', headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with opener.open(request, timeout=20) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError('Public document exceeded evidence size limit')
                records[label] = {'url': url, 'http_status': response.status,
                                  'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                payloads[label] = raw
        except urllib.error.HTTPError as error:
            records[label] = {'url': url, 'http_status': error.code, 'body_retained': False}
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            records[label] = {'url': url, 'failure_type': type(error).__name__}

    server, oauth = {}, {}
    for label in ('server', 'oauth'):
        try:
            value = json.loads(payloads.get(label, b'{}'))
            if isinstance(value, dict):
                if label == 'server':
                    server = {key: value[key] for key in ('name', 'version', 'status', 'docs') if key in value}
                else:
                    oauth = {key: value[key] for key in (
                        'issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint',
                        'grant_types_supported', 'response_types_supported',
                        'code_challenge_methods_supported', 'scopes_supported',
                        'token_endpoint_auth_methods_supported') if key in value}
        except (json.JSONDecodeError, UnicodeDecodeError):
            records[label]['valid_json'] = False

    text = {label: normalized_html(raw) for label, raw in payloads.items()
            if label not in ('server', 'oauth')}
    agent_text = text.get('supported_agents', '')
    source_text = text.get('transfers', '')
    docs_observations = {
        'supported_agent_names_present': [name for name in ('Claude', 'ChatGPT', 'OpenClaw')
                                          if name.casefold() in agent_text],
        'not_supported_at_launch_text_present': 'not supported at launch' in agent_text,
        'zap_balance_source_text_present': 'zap balance' in source_text,
        'privacy_zap_balance_text_present': 'zap balance' in text.get('privacy', ''),
        'merchant_restriction_text_present': 'no general-purpose payments' in text.get('terms', ''),
    }
    known_hosts = {'index.paystack.com', 'mcp.paystack.africa'}
    endpoint_hosts = {}
    for key in ('authorization_endpoint', 'token_endpoint', 'registration_endpoint'):
        endpoint = oauth.get(key)
        if isinstance(endpoint, str):
            parsed = urllib.parse.urlparse(endpoint)
            endpoint_hosts[key] = parsed.scheme == 'https' and parsed.hostname in known_hosts

    return {
        'observed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'experiment': 'actual_public_metadata_and_policy_discovery_only',
        'http_methods_used': ['GET'], 'sources': records, 'server': server, 'oauth': oauth,
        'advertised_endpoint_hosts_expected': endpoint_hosts,
        'document_text_observations': docs_observations,
        'registration_advertised': bool(oauth.get('registration_endpoint')),
        'registration_attempted': False, 'oauth_token_requests': 0,
        'mcp_method_calls': 0, 'customer_account_reads': 0, 'financial_operations': 0,
        'banking_integration_established': False, 'verified_existing_source_banks': 0,
        'stop_reason': 'No approved AGUS client/customer-source grant. Public discovery is not bank authority. '
                       'Published Zap-balance/agent-policy constraints need explicit provider resolution.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Six fixed public GETs only; never authenticate or register')
    parser.add_argument('--output', type=Path, help='Optional sanitized discovery result')
    args = parser.parse_args()
    result = discover() if args.live else {
        'mode': 'offline', 'network_calls': 0, 'planned_public_urls': PUBLIC,
        'registration_attempted': False, 'financial_operations': 0,
        'banking_integration_established': False,
    }
    rendered = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(rendered)
    print(rendered, end='')


if __name__ == '__main__':
    main()
