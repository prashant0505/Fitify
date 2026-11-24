import base64
import io
import sys
import unittest
from pathlib import Path

import pymupdf
from reportlab.pdfgen import canvas
sys.path.insert(0,str(Path(__file__).parent))
from engine import extract,generate,DocumentError
from pdf_engine import check_fit

TEXT='Developed accessible React interfaces and automated testing workflows for reliable web applications.'

def fixture(mixed=False,leading=False):
    output=io.BytesIO();c=canvas.Canvas(output,pagesize=(612,792))
    c.setFillColorRGB(.16,.14,.25);c.rect(35,730,540,20,fill=1,stroke=0)
    c.setFont('Helvetica-Bold',16);c.drawString(42,704,'EXAMPLE CANDIDATE')
    c.setFont('Helvetica-Bold',11);c.drawString(42,665,'Summary')
    c.setFillColorRGB(.1,.12,.15)
    if mixed:
        c.setFont('Helvetica-Bold',9);c.drawString(42,640,'Product contribution: ')
        c.setFont('Helvetica',9);c.drawString(145,640,(' ' if leading else '')+TEXT)
    else:
        c.setFont('Helvetica',10);c.drawString(42,640,TEXT)
    c.setFont('Helvetica-Bold',11);c.drawString(42,590,'Education')
    c.setFont('Helvetica',10);c.drawString(42,570,'Bachelor of Technology | Example University | 2022')
    c.showPage();c.setFont('Helvetica',10);c.drawString(42,740,'Additional page, retained without changes.');c.save()
    return output.getvalue()

def edit_for(data):
    seg=next(s for s in extract(data,'pdf')['segments'] if s['editable'])
    return {'id':seg['id'],'original':seg['text'],'replacement':seg['text'].replace('reliable','robust'),'evidence':'React interfaces','reason':'More concise wording'}

class PdfEngineTests(unittest.TestCase):
    def test_supported_pdf_is_editable_and_headers_are_protected(self):
        result=extract(fixture(),'pdf');self.assertTrue(result['editable']);self.assertEqual(result['pages'],2)
        self.assertFalse(next(s for s in result['segments'] if 'EXAMPLE CANDIDATE' in s['text'])['editable'])
        self.assertFalse(next(s for s in result['segments'] if 'Bachelor' in s['text'])['editable'])
    def test_generates_real_pdf_and_preserves_unedited_rendered_pixels(self):
        data=fixture();result=generate(data,[edit_for(data)],'pdf')
        self.assertTrue(result['validation']['passed']);out=base64.b64decode(result['pdf'])
        with pymupdf.open(stream=out,filetype='pdf') as doc:
            self.assertEqual(len(doc),2);self.assertIn('robust web applications',doc[0].get_text());self.assertNotIn('reliable web applications',doc[0].get_text())
        self.assertEqual(base64.b64decode(result['originalPdf']),data)
    def test_mixed_style_pdf_can_edit_regular_run_without_flattening_bold(self):
        data=fixture(True);result=generate(data,[edit_for(data)],'pdf')
        with pymupdf.open(stream=base64.b64decode(result['pdf']),filetype='pdf') as doc:
            spans=[s for b in doc[0].get_text('dict')['blocks'] if b.get('type')==0 for l in b['lines'] for s in l['spans']]
            self.assertTrue(any('Product contribution' in s['text'] and s['font']=='Helvetica-Bold' for s in spans))
    def test_overflow_and_protected_edits_are_rejected(self):
        data=fixture();c=edit_for(data);c['replacement']='W'*len(c['original']);self.assertFalse(check_fit(data,[c])['fits'])
        c=edit_for(data);c['id']=0
        with self.assertRaises(DocumentError):generate(data,[c],'pdf')
    def test_metric_change_is_rejected(self):
        data=fixture();c=edit_for(data);c['replacement']+=' 50%'
        with self.assertRaises(DocumentError):generate(data,[c],'pdf')
    def test_password_protection_and_scanned_pages_fail_explicitly(self):
        with pymupdf.open(stream=fixture(),filetype='pdf') as d:encrypted=d.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,user_pw='example-test-password',owner_pw='example-owner-password')
        with self.assertRaises(DocumentError):extract(encrypted,'pdf')
        d=pymupdf.open();d.new_page();scanned=d.tobytes();d.close()
        with self.assertRaises(DocumentError):extract(scanned,'pdf')
    def test_original_font_and_size_retained(self):
        data=fixture();result=generate(data,[edit_for(data)],'pdf')
        with pymupdf.open(stream=base64.b64decode(result['pdf']),filetype='pdf') as d:
            spans=[s for b in d[0].get_text('dict')['blocks'] if b.get('type')==0 for l in b['lines'] for s in l['spans']]
            edited=next(s for s in spans if 'robust' in s['text']);self.assertEqual(edited['font'],'Helvetica');self.assertAlmostEqual(edited['size'],10)

    def test_preserves_leading_space_after_emphasized_run(self):
        data=fixture(True,True);change=edit_for(data);out=base64.b64decode(generate(data,[change],'pdf')['pdf'])
        positions=[]
        for content in [data,out]:
            with pymupdf.open(stream=content,filetype='pdf') as doc:
                spans=[s for b in doc[0].get_text('rawdict')['blocks'] if b.get('type')==0 for l in b['lines'] for s in l['spans']]
                target=next(s for s in spans if ''.join(c['c'] for c in s['chars']).lstrip().startswith('Developed accessible'))
                positions.append(next(c['origin'][0] for c in target['chars'] if not c['c'].isspace()))
        self.assertAlmostEqual(positions[0],positions[1],places=2)
