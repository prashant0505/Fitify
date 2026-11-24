"""Private, token-authenticated document service; never expose without HTTPS and a sandbox."""
import hmac,json,os,threading
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from engine import extract,decode,generate,DocumentError
GATE=threading.BoundedSemaphore(2)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass # No document content, names, tokens or payload logs.
    def reply(self,status,value):
        data=json.dumps(value).encode();self.send_response(status)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path=='/health':self.reply(200,{'ok':True});return
        self.reply(404,{'error':'Not found'})
    def do_POST(self):
        token=os.environ.get('DOCUMENT_SERVICE_TOKEN','')
        if len(token)<24 or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):self.reply(401,{'error':'Unauthorized'});return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:self.reply(400,{'error':'Invalid request'});return
        if not 0<length<9*1024*1024:self.reply(413,{'error':'Request exceeds safe size limit'});return
        if not GATE.acquire(blocking=False):self.reply(429,{'error':'Document service is busy. Retry shortly.'});return
        try:
            payload=json.loads(self.rfile.read(length));data=decode(payload.get('file'))
            if self.path=='/extract':result=extract(data,payload.get('format'))
            elif self.path=='/generate':result=generate(data,payload.get('changes'),payload.get('format','docx'))
            elif self.path=='/render-page':
                from highlight import render_preview_page
                result=render_preview_page(data,payload.get('page'))
            elif self.path=='/highlight':
                from highlight import highlight_pdf
                result=highlight_pdf(data,payload.get('changes'),payload.get('regions'),payload.get('original',False))
            elif self.path=='/check-pdf':
                from pdf_engine import check_fit
                result=check_fit(data,payload.get('changes'))
            else:self.reply(404,{'error':'Not found'});return
            self.reply(200,result)
        except DocumentError as e:self.reply(422,{'error':str(e)})
        except Exception:self.reply(500,{'error':'Document processing failed safely. Your original file was not modified.'})
        finally:GATE.release()
if __name__=='__main__':
    if len(os.environ.get('DOCUMENT_SERVICE_TOKEN',''))<24:raise SystemExit('Set DOCUMENT_SERVICE_TOKEN to a random value of at least 24 characters.')
    server=ThreadingHTTPServer((os.environ.get('HOST','127.0.0.1'),int(os.environ.get('PORT','8091'))),Handler)
    server.daemon_threads=True;server.serve_forever()
