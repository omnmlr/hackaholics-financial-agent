"""Execute unmodified OBN Kong authorization handler under liblua with local test doubles.
No bank network, account, real token or payment integration is exercised.
Default mode retrieves only the pinned public source; --source permits offline use.
"""
import argparse, ctypes, hashlib, json, pathlib, tempfile, urllib.request
lib=ctypes.CDLL('liblua5.4.so.0')
lib.luaL_newstate.restype=ctypes.c_void_p
lib.luaL_openlibs.argtypes=[ctypes.c_void_p]
lib.luaL_loadstring.argtypes=[ctypes.c_void_p,ctypes.c_char_p]
lib.lua_pcallk.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_longlong,ctypes.c_void_p]
lib.lua_tolstring.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.POINTER(ctypes.c_size_t)]
lib.lua_tolstring.restype=ctypes.c_char_p
lib.lua_close.argtypes=[ctypes.c_void_p]
UPSTREAM_SHA = "5c85a0a6386841584c460a6ccd652e0873347f9a"
EXPECTED_HASH = "492bf26cf9f7ebbc9d44e7984a3d12e11be942b635042bfc063d3a2c5ca4bdc5"
SOURCE_URL = "https://raw.githubusercontent.com/openbankingnigeria/obn-gateway/" + UPSTREAM_SHA + "/apps/kong/plugins/obn-authorization/handler.lua"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=pathlib.Path, help="Optional already downloaded pinned upstream handler")
args = parser.parse_args()
if args.source:
    source_bytes = args.source.read_bytes()
else:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "AGUS-research/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        source_bytes = response.read()
assert hashlib.sha256(source_bytes).hexdigest() == EXPECTED_HASH, "Upstream source hash mismatch"
source_dir = tempfile.TemporaryDirectory(prefix="agus-obn-scope-")
source = pathlib.Path(source_dir.name) / "handler.lua"
source.write_bytes(source_bytes)
print("Upstream commit:", UPSTREAM_SHA, flush=True)
print("Upstream source SHA-256:", EXPECTED_HASH, flush=True)
print("Local unit experiment; Kong, HTTP introspection and token response are test doubles.", flush=True)
bootstrap=r'''
TOKEN={active=true,scope="accounts:read payments:write",client_id="agus-test-client"}
HEADERS={}; REQUEST_HEADER="Bearer synthetic-unit-test-token"; CONSUMER="agus-test-client"; HTTP_STATUS=200
package.preload["resty.http"]=function() return {new=function() return {request_uri=function(_,url,opts) return {status=HTTP_STATUS,body="local-double"} end} end} end
package.preload["resty.openssl.x509"]=function() return {} end
package.preload["cjson.safe"]=function() return {decode=function(_) return TOKEN end} end
ngx={re={gmatch=function(v,_) local token=string.match(v,"^%s*[Bb]earer%s+(.+)");return function() if token then return {token} end end end}}
kong={log={debug=function()end,err=function()end},request={get_header=function(_)return REQUEST_HEADER end},response={error=function(status,_) error("HTTP_"..status,0) end},client={get_consumer=function()return {username=CONSUMER}end},service={request={set_header=function(k,v)HEADERS[k]=v end,clear_header=function(_)end}}}
local handler=dofile(SOURCE)
local config={token_header="Authorization",introspection_endpoint="http://local-test-double.invalid",client_id="unit",client_secret="unit",ttl=0,scope={"payments:write"}}
local cases={
 {name="missing bearer",header=false,want="HTTP_401"},
 {name="inactive consent token",active=false,want="HTTP_401"},
 {name="read permission cannot write",scope="accounts:read",want="HTTP_403"},
 {name="wrong registered client",client="another-client",want="HTTP_403"},
 {name="empty token client identity",client="",want="HTTP_403"},
 {name="authorization server rejects",status=401,want="HTTP_401"},
 {name="active matching write grant",want="OK"}
}
for _,c in ipairs(cases) do
 REQUEST_HEADER=c.header==false and nil or "Bearer synthetic-unit-test-token"
 if c.header==false then REQUEST_HEADER=nil end
 TOKEN={active=c.active~=false,scope=c.scope or "accounts:read payments:write",client_id=c.client or "agus-test-client"}
 HTTP_STATUS=c.status or 200;HEADERS={}
 local ok,err=pcall(function()handler:access(config)end)
 local actual=ok and "OK" or tostring(err)
 assert(actual==c.want,c.name..": expected "..c.want.." got "..actual)
 if ok then assert(HEADERS["X-Credential-Client-ID"]=="agus-test-client") end
 print(c.name..": PASS ("..actual..")")
end
'''
code=('SOURCE='+json.dumps(str(source))+'\n'+bootstrap).encode()
state=lib.luaL_newstate();lib.luaL_openlibs(state)
try:
 result=lib.luaL_loadstring(state,code)
 if result==0:result=lib.lua_pcallk(state,0,0,0,0,None)
 if result:raise RuntimeError(lib.lua_tolstring(state,-1,None).decode())
finally:
    lib.lua_close(state)
    source_dir.cleanup()
