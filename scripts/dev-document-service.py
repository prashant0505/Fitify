"""Generate and share a local-only document token without printing it."""
import os,secrets,sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
values={}
file=root/'.dev.vars'
if file.exists():
    for line in file.read_text().splitlines():
        if '=' in line:
            k,v=line.split('=',1);values[k]=v.strip('"')
values.setdefault('DOCUMENT_SERVICE_TOKEN',secrets.token_urlsafe(32))
values['DOCUMENT_SERVICE_URL']='http://127.0.0.1:8091'
file.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));file.chmod(0o600)
os.environ.update(values)
os.execv(sys.executable,[sys.executable,str(root/'document-service/server.py')])
