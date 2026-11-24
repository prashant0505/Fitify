from pathlib import Path
import sys
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'document-service'))
from test_engine import fixture
(root/'work').mkdir(exist_ok=True)
(root/'work/sample-resume.docx').write_bytes(fixture())
print('Created synthetic work/sample-resume.docx')

from test_pdf_engine import fixture as pdf_fixture
(root/'work/sample-resume.pdf').write_bytes(pdf_fixture())
print('Created synthetic work/sample-resume.pdf')
