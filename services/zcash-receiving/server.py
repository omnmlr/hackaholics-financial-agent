"""Receiving-only boundary over pinned zaw 0.1.2. Never forwards signing/owner APIs.
Native wallet runs locked on loopback. Its viewing database is private to this service.
"""
import os, json, sqlite3, subprocess, threading, time, urllib.request, hmac, hashlib, re
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(os.environ.get('ZCASH_DATA_DIR', '/data'))
WALLET = ROOT / 'wallet'
TOKEN = os.environ['ZCASH_RECEIVE_TOKEN']
LOCK = threading.Lock()
NATIVE = None
READY = False
os.umask(0o077)
ROOT.mkdir(parents=True, exist_ok=True)
def db(path):
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn
def native(path, body=None):
    token = (WALLET / 'agent-token').read_text().strip()
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('http://127.0.0.1:7341/api/agent/' + path,
        data=data, headers={'Authorization':'Bearer ' + token, 'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)
def status():
    s = native('status')
    if s['network'] != 'testnet' or s['unlocked']:
        raise ValueError('Unsafe wallet mode')
    if not s['synced']:
        raise ValueError('Wallet still scanning')
    return s
def snapshot(binding):
    status()
    key, digest, amount, reqid, created = binding
    with db(WALLET/'zaw.sqlite') as c:
        req = c.execute('SELECT * FROM requests WHERE id=?', (reqid,)).fetchone()
    if req is None or str(req['amount']) != amount:
        raise ValueError('Wallet binding mismatch')
    # Query only decrypted receiving output metadata; never select memo or account keys.
    with db(WALLET/'wallet.sqlite') as c:
        outputs = c.execute('''SELECT ro.value,t.mined_height,hex(t.txid) txid,
              ro.pool,ro.output_index,t.block, b.time block_time
          FROM v_received_outputs ro JOIN addresses a ON a.id=ro.address_id
          JOIN transactions t ON t.id_tx=ro.transaction_id
          LEFT JOIN blocks b ON b.height=t.mined_height
          WHERE a.address=? AND ro.is_change=0 AND ro.pool IN (3,4)''', (req['address'],)).fetchall()
        tip, tip_time = c.execute('SELECT height,time FROM blocks ORDER BY height DESC LIMIT 1').fetchone()
    if tip is None or tip_time is None or abs(time.time()-tip_time)>300:
        raise ValueError('No scanned blocks')
    clean=[]
    for row in outputs:
        mined=row['mined_height']
        if mined is not None and row['block'] is None:
            continue # Unmined/reorged notes are never confirmed.
        confirmations=0 if mined is None else max(0,tip-mined+1)
        clean.append({'amountAtoms':str(row['value']), 'transactionId':bytes.fromhex(row['txid'])[::-1].hex(),
            'height':mined,'confirmations':confirmations,'pool':row['pool'],'outputIndex':row['output_index'],
            'blockTime':row['block_time']})
    return {'network':'testnet','walletId':wallet_id(),'invoiceKey':key,'termsDigest':digest,
        'walletRequestId':reqid,'address':req['address'],'amountAtoms':amount,
        'chainTip':tip,'synced':True,'observedAt':int(time.time()),'outputs':clean,
        'source':'zaw-librustzcash-receiving-wallet','signingAvailable':False}
def wallet_id():
    # Fingerprint of wallet-controlled public receiving address, never a viewing key.
    with db(WALLET/'wallet.sqlite') as c:
        address=c.execute('SELECT address FROM addresses ORDER BY id LIMIT 1').fetchone()[0]
    return hashlib.sha256(address.encode()).hexdigest()[:24]
def initialize():
    global READY, NATIVE
    try:
        if not (WALLET/'config.json').exists():
            # dev init never prints the mnemonic without --show-mnemonic.
            result=subprocess.run(['zaw','--network','testnet','--data-dir',str(WALLET),'dev','init'],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
            if result.returncode:
                raise RuntimeError('native_init exit '+str(result.returncode)+': '+result.stderr.decode(errors='replace')[:1800])
        config=json.loads((WALLET/'config.json').read_text())
        if config['network']!='testnet' or config['lightwalletd']!='https://testnet.zec.rocks:443':
            raise ValueError('Unexpected network')
        NATIVE=subprocess.Popen(['zaw','--network','testnet','--data-dir',str(WALLET),'daemon',
            '--listen','127.0.0.1:7341'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        with db(ROOT/'bindings.sqlite') as c:
            c.execute('CREATE TABLE IF NOT EXISTS bindings (key TEXT PRIMARY KEY,digest TEXT NOT NULL,amount TEXT NOT NULL,request_id TEXT UNIQUE NOT NULL,created INTEGER NOT NULL)')
        READY=True
        print('Native receiving wallet initialized; locked signer; testnet only',flush=True)
    except Exception as error:
        # Initialization stderr cannot contain a mnemonic (--show-mnemonic is never used).
        print('Native receiving wallet initialization failed: '+str(error),flush=True)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,code,payload):
        raw=json.dumps(payload,separators=(',',':')).encode()
        self.send_response(code);self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)
    def do_GET(self): self.handle_api()
    def do_POST(self): self.handle_api()
    def handle_api(self):
        if self.path=='/healthz' and self.command=='GET':
            return self.send(200 if READY and NATIVE.poll() is None else 503,{'ready':READY})
        if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+TOKEN):
            return self.send(401,{'error':'Authentication required'})
        if not READY: return self.send(503,{'error':'Receiving wallet unavailable'})
        try:
            with LOCK:
                if self.path=='/status' and self.command=='GET':
                    s=status()
                    return self.send(200,{'network':'testnet','synced':True,'walletId':wallet_id(),
                        'spendableZec':s['spendable']['zec'],'pendingZec':s['pending']['zec'],
                        'signingAvailable':False,'implementation':'zaw-0.1.2','nu7Compatible':True})
                if self.path=='/invoices' and self.command=='POST':
                    size=int(self.headers.get('Content-Length','0'))
                    if size<1 or size>2048: return self.send(400,{'error':'Invalid body'})
                    body=json.loads(self.rfile.read(size));key=body['invoiceKey'];digest=body['termsDigest'];amount=body['amountAtoms']
                    if set(body)!={'invoiceKey','termsDigest','amountAtoms'} or not re.fullmatch(r'[a-f0-9]{64}',key) or not re.fullmatch(r'[a-f0-9]{64}',digest) or not re.fullmatch(r'[1-9][0-9]{0,15}',amount) or int(amount)>21000000*100000000:
                        return self.send(400,{'error':'Invalid terms'})
                    status()
                    with db(ROOT/'bindings.sqlite') as c:
                        binding=c.execute('SELECT * FROM bindings WHERE key=?',(key,)).fetchone()
                        if binding and (binding['digest']!=digest or binding['amount']!=amount):
                            return self.send(409,{'error':'Invoice identity already bound'})
                        if not binding:
                            zec=f'{int(amount)//100000000}.{int(amount)%100000000:08d}'
                            result=native('requests',{'amount':zec,'label':'AGUS private invoice','idempotency_key':key})
                            reqid=result['request_id']
                            c.execute('INSERT INTO bindings VALUES(?,?,?,?,?)',(key,digest,amount,reqid,int(time.time())))
                            binding=c.execute('SELECT * FROM bindings WHERE key=?',(key,)).fetchone()
                    return self.send(200,snapshot(tuple(binding)))
                if re.fullmatch(r'/invoices/[a-f0-9]{64}',self.path) and self.command=='GET':
                    with db(ROOT/'bindings.sqlite') as c:
                        binding=c.execute('SELECT * FROM bindings WHERE key=?',(self.path.split('/')[-1],)).fetchone()
                    return self.send(404,{'error':'Not found'}) if not binding else self.send(200,snapshot(tuple(binding)))
                return self.send(404,{'error':'Endpoint unavailable'})
        except Exception:
            return self.send(503,{'error':'Trusted receiving observation unavailable; no settlement assumed'})
if __name__=='__main__':
    threading.Thread(target=initialize,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
