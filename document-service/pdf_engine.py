"""Edit supported text regions in the original PDF, preserving all other pixels.

No rasterization, template recreation, font substitution, or font-size reduction.
Unsupported mixed-style, rotated, scanned, or unavailable-font regions stay protected.
"""
import base64
import io
import math
import re
import threading
from functools import wraps

_LOCK=threading.RLock()
def serialized(fn):
    @wraps(fn)
    def run(*args,**kwargs):
        with _LOCK:return fn(*args,**kwargs)
    return run
from collections import Counter

import pymupdf
from PIL import Image, ImageChops, ImageDraw

ENGINE_VERSION = 2
BASE_FONTS = {
    'Helvetica':'helv','Helvetica-Bold':'hebo','Helvetica-Oblique':'heit','Helvetica-BoldOblique':'hebi',
    'Times-Roman':'tiro','Times-Bold':'tibo','Times-Italic':'tiit','Times-BoldItalic':'tibi',
    'Courier':'cour','Courier-Bold':'cobo','Courier-Oblique':'coit','Courier-BoldOblique':'cobi',
}

def _error(message):
    from engine import DocumentError
    return DocumentError(message)

def _name(name): return re.sub(r'^[A-Z]{6}\+','',name).replace(' ','').lower()
def _normal(text): return re.sub(r'\s+',' ',text).strip()

def _font(doc,page,name):
    for info in page.get_fonts(full=True):
        xref,ext,kind,base,resource,*_=info
        if _name(base)!=_name(name):continue
        if kind=='Type3':return None
        if xref:
            try:
                _,_,_,buffer=doc.extract_font(xref)
                if buffer:
                    return {'font':pymupdf.Font(fontbuffer=buffer),'buffer':buffer,'base':None,'name':name}
            except Exception:pass
    if name in BASE_FONTS:
        alias=BASE_FONTS[name]
        return {'font':pymupdf.Font(fontname=alias),'buffer':None,'base':alias,'name':name}
    return None

def inspect_pdf(data):
    from engine import HEADINGS, VERBS
    try:doc=pymupdf.open(stream=data,filetype='pdf')
    except Exception:raise _error('This PDF is corrupted or cannot be opened.')
    try:
        if doc.needs_pass or doc.is_encrypted:raise _error('Password-protected PDFs are not supported.')
        if not 0<len(doc)<=10:raise _error('Use a PDF resume with 1 to 10 pages.')
        if doc.is_form_pdf:raise _error('Interactive or signed PDFs are not editable. Upload a non-interactive export of the PDF.')
        segments=[];regions={};reasons=Counter();font_cache={}
        for page_number,page in enumerate(doc):
            if page.rect.width>1440 or page.rect.height>2160 or page.rect.width*page.rect.height>2500000:raise _error('PDF page dimensions exceed the safe resume rendering limit.')
            if any(image[2]*image[3]>20000000 for image in page.get_images(full=True)):raise _error('An embedded PDF image exceeds the safe processing limit.')
            blocks=page.get_text('dict',sort=True)['blocks']
            headings=[]
            for block in blocks:
                if block.get('type')!=0:continue
                for line in block['lines']:
                    label=_normal(''.join(s['text'] for s in line['spans']))
                    if HEADINGS.match(label):headings.append((label,line['bbox']))
            def section_for(box):
                matching=[(label,b) for label,b in headings if b[3]<=box[1]+1 and (box[0]-30<=(b[0]+b[2])/2<=box[2]+30 or abs(box[0]-b[0])<60)]
                return max(matching,key=lambda item:item[1][1])[0] if matching else 'Unclassified'
            units=[]
            for block in blocks:
                if block.get('type')!=0:continue
                styles={(s['font'],round(s['size'],3),s['color']) for line in block['lines'] for s in line['spans'] if s['text'].strip()}
                if len(styles)==1:
                    units.append(block);continue
                # Protect emphasized runs, but allow their neighboring uniform runs
                # to be edited in place without flattening the paragraph styling.
                context=_normal(' '.join(''.join(s['text'] for s in l['spans']) for l in block['lines']))
                for line in block['lines']:
                    groups=[]
                    for span in line['spans']:
                        if not span['text'].strip():
                            if groups:groups[-1].append(span)
                            continue
                        signature=(span['font'],round(span['size'],3),span['color'])
                        previous=groups[-1][-1] if groups else None
                        if previous and (previous['font'],round(previous['size'],3),previous['color'])==signature:groups[-1].append(span)
                        else:groups.append([span])
                    for group in groups:
                        box=pymupdf.Rect(group[0]['bbox'])
                        for span in group[1:]:box|=pymupdf.Rect(span['bbox'])
                        units.append({'type':0,'bbox':tuple(box),'context':context,'lines':[dict(line,spans=group,bbox=tuple(box))]})
            obstacles=[pymupdf.Rect(s['bbox']) for b in blocks if b.get('type')==0 for line in b['lines'] for s in line['spans'] if s['text'].strip()]
            protected_areas=[pymupdf.Rect(x['from']) for x in page.get_links() if 'from' in x]
            protected_areas += [pymupdf.Rect(a.rect) for a in (page.annots() or [])]
            for block in units:
                if block.get('type')!=0:continue
                lines=[line for line in block['lines'] if any(s['text'].strip() for s in line['spans'])]
                if not lines:continue
                texts=[_normal(''.join(s['text'] for s in line['spans'])) for line in lines]
                text=_normal(' '.join(texts));identifier=len(segments)
                section=section_for(block['bbox'])
                spans=[s for line in lines for s in line['spans'] if s['text'].strip()]
                style={(s['font'],round(s['size'],3),s['color']) for s in spans}
                bbox=pymupdf.Rect(block['bbox']);reason=None
                description=(VERBS.match(text) or re.search('summary|profile|experience|employment|project',section,re.I)) and not HEADINGS.match(text)
                if len(text)<=35 or len(text.split())<6 or not description or re.search('education|certification|award',section,re.I):reason='Protected identity, heading or non-description text'
                elif re.search(r'\b(?:19|20)\d{2}\b',text) and not VERBS.match(text):reason='Protected date or employment header'
                elif any('bold' in s['font'].lower() or s.get('flags',0)&16 for s in spans):reason='Emphasized text protected'
                elif page.rotation or any(tuple(line.get('dir',(1,0)))!=(1.0,0.0) for line in lines):reason='Rotated text'
                elif len(style)!=1:reason='Mixed fonts, sizes or colors'
                elif any(bbox.intersects(rect) for rect in protected_areas):reason='Linked or annotated text'
                elif any(bbox.intersects(rect) and not bbox.contains(rect) for rect in obstacles):reason='Overlapping text regions'
                font=None
                if reason is None:
                    name,size,color=next(iter(style));cache_key=(page_number,name)
                    if cache_key not in font_cache:font_cache[cache_key]=_font(doc,page,name)
                    font=font_cache[cache_key]
                    if not font:reason='Original font is not available for exact editing'
                    elif not all(font['font'].has_glyph(ord(c)) for c in text if not c.isspace()):reason='Original font encoding cannot reproduce this text'
                    elif any(abs(line['bbox'][0]-lines[0]['bbox'][0])>3 for line in lines):reason='Irregular line indentation'
                editable=reason is None
                segments.append({'id':identifier,'text':text,'editable':editable,'section':section,
                    'context':block.get('context',text),'maxCharacters':len(text),'layoutHint':'Keep this PDF paragraph shorter than its original; use only characters present in the original font.'})
                if editable:
                    line_x=[]
                    for line in lines:
                        raw=''.join(span['text'] for span in line['spans'])
                        leading=raw[:len(raw)-len(raw.lstrip())]
                        line_x.append(line['spans'][0]['origin'][0]+font['font'].text_length(leading,fontsize=size))
                    regions[identifier]={'page':page_number,'bbox':tuple(bbox),'font':font,'size':size,'color':color,
                        'baselines':[line['spans'][0]['origin'][1] for line in lines],
                        'lineX':line_x,'x':line_x[0], 'text':text}
                else:reasons[reason]+=1
        if sum(len(s['text']) for s in segments)>60000 or len(segments)>500:raise _error('Resume exceeds the PDF text limit.')
        if sum(len(s['text']) for s in segments)<30:raise _error('No readable PDF text was found. Scanned image PDFs need OCR before tailoring.')
        return doc,segments,regions,reasons
    except Exception:
        doc.close();raise

@serialized
def extract_pdf(data):
    doc,segments,regions,reasons=inspect_pdf(data)
    try:
        count=len(regions)
        notice=(f'{count} editable PDF text region'+('s' if count!=1 else '')+' found. Original fonts, sizes, colors and page positions will be retained. '
            'Mixed-style, linked, rotated and unsupported-font regions remain unchanged.') if count else 'This PDF has no safely editable text regions. Scanned pages, mixed formatting or unavailable original fonts may prevent editing.'
        return {'segments':segments,'pages':len(doc),'editable':bool(count),'notice':notice,'pdfEngineVersion':ENGINE_VERSION,
            'pdfProtectedRegions':dict(reasons),'previewRegions':[{'id':identifier,'page':r['page'],'bbox':list(r['bbox'])} for identifier,r in regions.items()]}
    finally:doc.close()

def _wrap(text,font,size,width):
    words=text.split();lines=[];line=''
    for word in words:
        if font.text_length(word,fontsize=size)>width+.25:raise _error('A replacement word exceeds the original PDF text width.')
        candidate=(line+' '+word).strip()
        if font.text_length(candidate,fontsize=size)<=width+.25:line=candidate
        else:lines.append(line);line=word
    if line:lines.append(line)
    return lines

def plans_for(data,changes):
    doc,segments,regions,reasons=inspect_pdf(data)
    try:
        if not isinstance(changes,list) or not 0<len(changes)<=100:raise _error('No valid PDF edits were provided.')
        seen=set();plans=[]
        for c in changes:
            identifier=c.get('id');r=regions.get(identifier)
            if identifier in seen or not r or c.get('original')!=r['text']:raise _error('A PDF edit targets protected or mismatched source text.')
            seen.add(identifier);replacement=c.get('replacement','')
            if not replacement.strip() or '\n' in replacement or len(replacement)>max(len(r['text'])*1.12,len(r['text'])+8):raise _error('A PDF edit exceeds its original text budget.')
            if re.findall(r'\d+(?:[.,]\d+)?%?',r['text'])!=re.findall(r'\d+(?:[.,]\d+)?%?',replacement):raise _error('A PDF edit changes a numerical claim.')
            if not c.get('evidence') or c['evidence'] not in r['text']:raise _error('A PDF edit lacks source evidence.')
            if not all(r['font']['font'].has_glyph(ord(ch)) for ch in replacement if not ch.isspace()):raise _error('The original embedded PDF font does not contain a requested character. Use simpler wording with available characters.')
            bbox=pymupdf.Rect(r['bbox']);lines=_wrap(replacement,r['font']['font'],r['size'],bbox.x1-max(r['lineX']))
            if len(lines)>len(r['baselines']):raise _error('The rewrite exceeds the original PDF line count. Return shorter replacements within the existing text regions.')
            plans.append((c,r,lines))
        return doc,segments,plans
    except Exception:doc.close();raise

@serialized
def check_fit(data,changes):
    if not isinstance(changes,list) or not changes:return {'fits':False,'reason':'No PDF edits supplied.','rejectedIds':[]}
    rejected=[];reason=''
    for change in changes:
        try:
            doc,_,_=plans_for(data,[change]);doc.close()
        except ValueError as error:
            rejected.append(change.get('id'));reason=str(error)
    return {'fits':not rejected,'reason':reason,'rejectedIds':rejected}

def _validate(original,result,segments,plans):
    checks=['Original PDF pages edited directly; no document recreation','Original page count, dimensions and rotation retained',
        'Original font programs, sizes, colors and line baselines reused','Every replacement is searchable in the output',
        'Unchanged text remains at its original position','Rendered pixels outside edited text regions remain identical']
    with pymupdf.open(stream=original,filetype='pdf') as before,pymupdf.open(stream=result,filetype='pdf') as after:
        if len(before)!=len(after):raise _error('PDF page count changed. Download blocked.')
        for pi,(a,b) in enumerate(zip(before,after)):
            if a.rect!=b.rect or a.rotation!=b.rotation:raise _error('PDF page geometry changed. Download blocked.')
            page_plans=[p for p in plans if p[1]['page']==pi]
            for c,r,_ in page_plans:
                area=pymupdf.Rect(r['bbox'])+(-.05,-.05,.05,.05)
                actual=_normal(b.get_text('text',clip=area))
                if actual!=_normal(c['replacement']):raise _error('Replacement text is missing or clipped. PDF download blocked.')
                original_styles=[(s['font'],round(s['size'],2),s['color']) for block in a.get_text('dict')['blocks'] if block.get('type')==0 for line in block['lines'] for s in line['spans'] if area.contains(pymupdf.Rect(s['bbox']))]
                output_styles=[(s['font'],round(s['size'],2),s['color']) for block in b.get_text('dict')['blocks'] if block.get('type')==0 for line in block['lines'] for s in line['spans'] if area.contains((pymupdf.Rect(s['bbox']).tl+pymupdf.Rect(s['bbox']).br)/2)]
                # Embedded resource names can gain a subset prefix; compare canonical face names.
                allowed={(_name(n),size,color) for n,size,color in original_styles}
                if not output_styles or any((_name(n),size,color) not in allowed for n,size,color in output_styles):raise _error('PDF font style changed. Download blocked.')
            edited=[pymupdf.Rect(r['bbox']) for _,r,_ in page_plans]
            def stable_spans(page):
                result=[]
                for block in page.get_text('dict')['blocks']:
                    if block.get('type')!=0:continue
                    for line in block['lines']:
                        for span in line['spans']:
                            if span['text'].strip() and not any(rect.intersects(pymupdf.Rect(span['bbox'])) for rect in edited):
                                result.append((span['text'],tuple(round(x,2) for x in span['bbox']),span['font'],round(span['size'],2),span['color']))
                return Counter(result)
            if stable_spans(a)!=stable_spans(b):raise _error('Untouched PDF text changed. Download blocked.')
            pix_a=a.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False)
            pix_b=b.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False)
            image_a=Image.frombytes('RGB',[pix_a.width,pix_a.height],pix_a.samples)
            image_b=Image.frombytes('RGB',[pix_b.width,pix_b.height],pix_b.samples)
            diff=ImageChops.difference(image_a,image_b)
            mask=ImageDraw.Draw(diff)
            for rect in edited:
                mask.rectangle((math.floor((rect.x0-1)*1.5),math.floor((rect.y0-1)*1.5),math.ceil((rect.x1+1)*1.5),math.ceil((rect.y1+1)*1.5)),fill=(0,0,0))
            if diff.getbbox():raise _error('PDF artwork or content outside the edited regions changed. Download blocked.')
        return {'passed':True,'pagesOriginal':len(before),'pagesTailored':len(after),'checks':checks,
            'warnings':['Only supported text regions were changed. Protected text and unsupported fonts were retained.','Review every rewrite and both PDF previews before applying. Automated factual auditing is not a guarantee of truth.']}

@serialized
def generate_pdf(data,changes):
    doc,segments,plans=plans_for(data,changes)
    try:
        # Keep the original font programs in memory, then register after redaction.
        font_resources={}
        for index,(_,r,_) in enumerate(plans):
            page=doc[r['page']];spec=r['font'];key=(r['page'],spec['name'])
            if key not in font_resources:
                resource=spec['base'] or f'FitifyOriginal{index}'
                font_resources[key]=resource
        for pi in sorted({r['page'] for _,r,_ in plans}):
            page=doc[pi]
            for _,r,_ in plans:
                if r['page']==pi:page.add_redact_annot(pymupdf.Rect(r['bbox']),fill=False,cross_out=False)
            page.apply_redactions(images=0,graphics=0,text=0)
            for _,r,lines in plans:
                if r['page']!=pi:continue
                color=tuple(((r['color']>>shift)&255)/255 for shift in (16,8,0))
                resource=font_resources[(pi,r['font']['name'])]
                page.insert_font(fontname=resource,fontbuffer=r['font']['buffer'])
                for text,baseline,x in zip(lines,r['baselines'],r['lineX']):
                    page.insert_text((x,baseline),text,fontname=resource,fontsize=r['size'],color=color,overlay=True)
        result=doc.tobytes(garbage=4,deflate=True)
    finally:doc.close()
    validation=_validate(data,result,segments,plans)
    encode=lambda value:base64.b64encode(value).decode()
    return {'document':encode(result),'pdf':encode(result),'originalPdf':encode(data),'validation':validation,'format':'pdf'}
