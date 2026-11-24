import io, sys, unittest, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from engine import extract, edit_docx, DocumentError, generate
from docx import Document
from docx.shared import Inches, Pt, RGBColor

def fixture():
    doc=Document();doc.sections[0].top_margin=Inches(.7)
    p=doc.add_paragraph('ALEX MORGAN');p.runs[0].bold=True
    doc.add_paragraph('alex@example.test | Bengaluru')
    doc.add_paragraph('PROFESSIONAL SUMMARY')
    p=doc.add_paragraph('Developed accessible React applications with TypeScript and collaborated with product teams to deliver reliable web experiences.')
    p.runs[0].font.name='Liberation Sans';p.runs[0].font.size=Pt(10);p.runs[0].font.color.rgb=RGBColor(43,43,43)
    doc.add_paragraph('EXPERIENCE');doc.add_paragraph('Software Engineer | Example Company | 2022–2025')
    doc.add_paragraph('Built reusable React components and automated testing workflows, reducing manual verification time by 20%.',style='List Bullet')
    p=doc.add_paragraph();p.add_run('Designed ').bold=True;p.add_run('accessible React interfaces and reusable components for internal product dashboards.')
    table=doc.add_table(rows=1,cols=2);table.cell(0,0).text='SKILLS';table.cell(0,1).text='React, TypeScript, Python'
    doc.add_paragraph('EDUCATION');doc.add_paragraph('Bachelor of Technology | Example University | 2022')
    doc.sections[0].header.paragraphs[0].text='Portfolio · example.test'
    out=io.BytesIO();doc.save(out);return out.getvalue()

def change(data):
    s=next(s for s in extract(data,'docx')['segments'] if 'accessible React applications' in s['text'])
    return {'id':s['id'],'original':s['text'],'replacement':s['text'].replace('reliable','robust'),'evidence':'Developed accessible React applications','reason':'Concise language'}
class EngineTests(unittest.TestCase):
    def test_extract_protects_identity_and_mixed_runs(self):
        segments=extract(fixture(),'docx')['segments']
        self.assertTrue(any(s['editable'] for s in segments))
        for s in segments:
            if s['text'].startswith(('ALEX','Software Engineer','Bachelor','Designed')):self.assertFalse(s['editable'])
    def test_preserves_all_other_zip_members(self):
        data=fixture();out=edit_docx(data,[change(data)])
        with zipfile.ZipFile(io.BytesIO(data)) as a,zipfile.ZipFile(io.BytesIO(out)) as b:
            self.assertEqual(a.namelist(),b.namelist())
            for name in a.namelist():
                if name!='word/document.xml':self.assertEqual(a.read(name),b.read(name),name)
        result=Document(io.BytesIO(out));self.assertEqual(result.sections[0].top_margin, Inches(.7))
        self.assertEqual(result.paragraphs[3].runs[0].font.name,'Liberation Sans')
        self.assertEqual(result.paragraphs[3].runs[0].font.size,Pt(10))
    def test_rejects_metric_change(self):
        data=fixture();s=next(s for s in extract(data,'docx')['segments'] if '20%' in s['text'])
        with self.assertRaises(DocumentError):edit_docx(data,[{'id':s['id'],'original':s['text'],'replacement':s['text'].replace('20%','90%'),'evidence':'React'}])
    def test_rejects_protected_text(self):
        data=fixture();s=extract(data,'docx')['segments'][0]
        with self.assertRaises(DocumentError):edit_docx(data,[{'id':s['id'],'original':s['text'],'replacement':'FAKE NAME','evidence':'ALEX'}])
    def test_rejects_corrupt_docx(self):
        with self.assertRaises(DocumentError):extract(b'PKgarbage','docx')
    def test_rejects_unsafe_zip(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('../evil','x')
        with self.assertRaises(DocumentError):extract(out.getvalue(),'docx')
    def test_rejects_expansion(self):
        data=fixture();c=change(data);c['replacement']=c['original']*3
        with self.assertRaises(DocumentError):edit_docx(data,[c])
    def test_render_validate_real_document(self):
        data=fixture();result=generate(data,[change(data)])
        self.assertTrue(result['validation']['passed'])
        self.assertEqual(result['validation']['pagesOriginal'],result['validation']['pagesTailored'])
if __name__=='__main__':unittest.main()
