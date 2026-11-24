"""Conservative OOXML editing. Original ZIP members remain byte-identical except document.xml."""
import base64, copy, io, json, os, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
import pdfplumber
from pypdf import PdfReader

MAX_FILE = 5 * 1024 * 1024
MAX_EXPANDED = 30 * 1024 * 1024
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}
HEADINGS = re.compile(r'^(professional summary|summary|profile|experience|professional experience|work experience|employment|technical skills|skills|projects|selected projects|education|certifications|awards)\s*:?$', re.I)
VERBS = re.compile(r'^(?:[•●\-]\s*)?(?:built|developed|designed|implemented|led|managed|created|delivered|improved|optimized|maintained|collaborated|engineered|automated|integrated|reduced|increased|supported|contributed|tested|deployed|resolved|analyzed|architected)\b', re.I)

class DocumentError(ValueError): pass

def decode(value):
    if not isinstance(value, str) or len(value) > MAX_FILE * 1.4: raise DocumentError('File exceeds the 5 MiB limit.')
    try: data = base64.b64decode(value, validate=True)
    except Exception: raise DocumentError('Invalid document encoding.')
    if not data or len(data) > MAX_FILE: raise DocumentError('Empty file or file exceeds 5 MiB.')
    return data

def open_docx(data):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        info = z.infolist()
        if len(info)>2000 or sum(x.file_size for x in info)>MAX_EXPANDED: raise DocumentError('Document archive exceeds safe extraction limits.')
        if len({i.filename for i in info}) != len(info): raise DocumentError('Duplicate archive entries are not supported.')
        for item in info:
            if item.flag_bits & 1: raise DocumentError('Password-protected documents are not supported.')
            if '..' in Path(item.filename).parts or item.filename.startswith('/'): raise DocumentError('Unsafe document archive.')
            if item.compress_size and item.file_size/item.compress_size>250: raise DocumentError('Unsafe document compression ratio.')
            if re.search(r'vbaProject|activeX|embeddings/',item.filename,re.I): raise DocumentError('Active or embedded content is not supported. Save a clean DOCX.')
            if item.filename.endswith('.rels'):
                rel=z.read(item)
                # External hyperlinks are allowed; externally loaded templates/images are not.
                for node in ET.fromstring(rel):
                    if node.attrib.get('TargetMode')=='External' and not node.attrib.get('Type','').endswith('/hyperlink'):
                        raise DocumentError('External document resources are not supported.')
        xml=z.read('word/document.xml')
        if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml: raise DocumentError('Unsafe XML document.')
        ET.fromstring(xml)
        return z,xml
    except DocumentError: raise
    except Exception: raise DocumentError('This DOCX is corrupted or is not a valid Word document.')

def paragraphs(xml):
    # Retain raw bytes and namespaces. Do not serialize the original XML tree.
    return list(re.finditer(rb'<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>',xml))

def extract_docx(data):
    z,xml=open_docx(data)
    section='Contact'
    segments=[]
    for i,p in enumerate(paragraphs(xml)):
        raw=p.group()
        node=ET.fromstring(b'<root xmlns:w="'+NS['w'].encode()+b'" '+ namespace_declarations(xml)+b'>'+raw+b'</root>')
        texts=node.findall('.//w:t',NS)
        text=''.join(t.text or '' for t in texts)
        if not text.strip(): continue
        if HEADINGS.match(text.strip()): section=text.strip().rstrip(':')
        protected=bool(re.search('education|certification|award|contact',section,re.I))
        description=bool(VERBS.match(text.strip())) or bool(re.search('summary|profile',section,re.I))
        complex_content=bool(re.search(rb'<w:(?:hyperlink|fldChar|instrText|drawing|object|tab|br|ins|del)\b',raw))
        editable=len(texts)==1 and not protected and not complex_content and len(text)>65 and len(text.split())>8 and description and not HEADINGS.match(text.strip())
        segments.append({'id':i,'text':text,'editable':bool(editable),'section':section})
    if len(segments)>500 or sum(len(s['text']) for s in segments)>60000: raise DocumentError('Resume is too long. Use a document under 60,000 characters and 500 paragraphs.')
    if not segments: raise DocumentError('No readable text was found in this DOCX.')
    return {'segments':segments,'pages':None,'editable':any(s['editable'] for s in segments),'notice':'Mixed-format paragraphs, headings, education and contact details are protected. Only supported single-run descriptions are editable.'}

def namespace_declarations(xml):
    root=re.search(rb'<w:document\b([^>]*)>',xml)
    if not root: raise DocumentError('Unsupported OOXML namespace. Use a standard Word DOCX.')
    return b' '.join(x.group() for x in re.finditer(rb'xmlns:(?!w=)[\w]+="[^"]*"',root.group(1)))

def extract_pdf(data):
    from pdf_engine import extract_pdf as implementation
    return implementation(data)

def extract(data,fmt):
    if fmt=='docx': return extract_docx(data)
    if fmt=='pdf' and data.startswith(b'%PDF-'): return extract_pdf(data)
    raise DocumentError('Supported formats are valid PDF and DOCX documents.')

def edit_docx(data,changes):
    parsed=extract_docx(data)
    source={s['id']:s for s in parsed['segments']}
    if not changes or len(changes)>100: raise DocumentError('No valid edits were provided, or too many edits were requested.')
    z,xml=open_docx(data)
    replacements={}
    for c in changes:
        s=source.get(c.get('id'))
        if not s or not s['editable'] or c.get('original')!=s['text'] or c['id'] in replacements: raise DocumentError('An edit targets protected or mismatched text.')
        replacement=c.get('replacement','')
        if not replacement.strip() or '\n' in replacement or len(replacement)>max(len(s['text'])*1.12,len(s['text'])+8): raise DocumentError('An edit exceeds its original text budget.')
        if re.findall(r'\d+(?:[.,]\d+)?%?',s['text'])!=re.findall(r'\d+(?:[.,]\d+)?%?',replacement): raise DocumentError('An edit changes a numerical claim.')
        if not c.get('evidence') or c['evidence'] not in s['text']: raise DocumentError('An edit lacks source evidence.')
        replacements[c['id']]=replacement
    from xml.sax.saxutils import escape
    pieces=[];cursor=0
    for i,p in enumerate(paragraphs(xml)):
        if i not in replacements: continue
        updated=re.sub(rb'(<w:t\b[^>]*>)[\s\S]*?(</w:t>)',lambda m:m.group(1)+escape(replacements[i]).encode()+m.group(2),p.group(),count=1)
        pieces.extend([xml[cursor:p.start()],updated]);cursor=p.end()
    pieces.append(xml[cursor:]);newxml=b''.join(pieces)
    # All formatting, styles, attributes and non-text XML must be byte-identical.
    strip=lambda b:re.sub(rb'(<w:t\b[^>]*>)[\s\S]*?(</w:t>)',rb'\1\2',b)
    if strip(xml)!=strip(newxml): raise DocumentError('Document structure changed; download was blocked.')
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as out:
        for item in z.infolist(): out.writestr(item,newxml if item.filename=='word/document.xml' else z.read(item.filename))
    return output.getvalue()

def render(data,directory,name):
    source=directory/(name+'.docx');source.write_bytes(data)
    executable=os.environ.get('SOFFICE_BIN') or shutil.which('soffice') or shutil.which('libreoffice')
    if not executable: raise DocumentError('LibreOffice renderer is unavailable. Output cannot be validated for download.')
    profile=directory/(name+'-profile');out=directory/(name+'-render');out.mkdir()
    try:
        subprocess.run([executable,'-env:UserInstallation='+profile.as_uri(),'--headless','--convert-to','pdf','--outdir',str(out),str(source)],timeout=45,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    except Exception: raise DocumentError('Document rendering failed or timed out. Download was blocked.')
    target=out/(name+'.pdf')
    if not target.exists(): raise DocumentError('Renderer produced no PDF. Download was blocked.')
    return target.read_bytes()

def normalize(t): return re.sub(r'\s+',' ',t).strip()

def validate(original,tailored,segments,changes):
    checks=['Original OOXML structure and all formatting attributes unchanged','All unchanged ZIP parts retained byte for byte']
    warnings=['Rendered using LibreOffice; Word and installed-font differences can affect appearance. Review both previews before applying.','Automated factual checks reduce risk but cannot guarantee every claim; review all edits.']
    with pdfplumber.open(io.BytesIO(original)) as a,pdfplumber.open(io.BytesIO(tailored)) as b:
        if len(a.pages)!=len(b.pages): raise DocumentError('Page count changed. Try a shorter rewrite; download was blocked.')
        if len(a.pages)>10: raise DocumentError('Resume exceeds the 10-page limit.')
        checks.append('Original and tailored page counts match')
        full=' '.join(normalize(p.extract_text() or '') for p in b.pages)
        for c in changes:
            if normalize(c['replacement']) not in full: raise DocumentError('Generated text is missing, clipped or reordered. Download was blocked.')
        checks.append('Every replacement is present in the rendered output')
        changed={c['id'] for c in changes}
        for s in segments:
            if s['id'] in changed or len(s['text'])<8: continue
            pattern=r'\s+'.join(re.escape(w) for w in s['text'].split())
            anchors=[]
            for pages in (a.pages,b.pages):
                found=[]
                for pi,p in enumerate(pages):
                    for m in p.search(pattern,regex=True,case=True):found.append((pi,m['x0'],m['top'],m['x1'],m['bottom']))
                anchors.append(found)
            if not anchors[0] or len(anchors[0])!=len(anchors[1]): raise DocumentError('An unchanged paragraph could not be verified in both renders. Download was blocked.')
            for old,new in zip(*anchors):
                if old[0]!=new[0] or max(abs(old[i]-new[i]) for i in range(1,5))>1.5: raise DocumentError('Content moved outside the original layout tolerance. Shorten the edit and retry.')
        checks.append('Unchanged paragraph positions match within 1.5 points')
        for pages in (a.pages,b.pages):
            for p in pages:
                words=p.extract_words()
                for word in words:
                    if word['x0']<0 or word['top']<0 or word['x1']>p.width+1 or word['bottom']>p.height+1: raise DocumentError('Text overflow detected. Download was blocked.')
                for i,x in enumerate(words):
                    for y in words[i+1:]:
                        overlap=min(x['x1'],y['x1'])-max(x['x0'],y['x0'])
                        height=min(x['bottom'],y['bottom'])-max(x['top'],y['top'])
                        if overlap>2 and height>min(x['bottom']-x['top'],y['bottom']-y['top'])*.7: raise DocumentError('Overlapping rendered text detected. Download was blocked.')
        checks.append('Rendered words remain inside pages with no detected collisions')
        return {'passed':True,'pagesOriginal':len(a.pages),'pagesTailored':len(b.pages),'checks':checks,'warnings':warnings}

def generate(data,changes,fmt="docx"):
    if fmt=="pdf":
        from pdf_engine import generate_pdf
        return generate_pdf(data,changes)
    if fmt!="docx":raise DocumentError("Unsupported output format.")
    segments=extract_docx(data)['segments']
    result=edit_docx(data,changes)
    with tempfile.TemporaryDirectory(prefix='fitify-') as tmp:
        original_pdf=render(data,Path(tmp),'original');tailored_pdf=render(result,Path(tmp),'tailored')
        validation=validate(original_pdf,tailored_pdf,segments,changes)
    encode=lambda d:base64.b64encode(d).decode()
    return {'document':encode(result),'pdf':encode(tailored_pdf),'originalPdf':encode(original_pdf),'validation':validation}
