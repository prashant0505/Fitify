import base64
import unittest
import pymupdf
from engine import DocumentError
from highlight import highlight_pdf,render_preview_page
from pdf_engine import extract_pdf,generate_pdf
from test_pdf_engine import fixture,edit_for

class HighlightTests(unittest.TestCase):
    def test_tailored_and_original_review_copies_do_not_modify_clean_text(self):
        original=fixture();change=edit_for(original);generated=generate_pdf(original,[change]);clean=base64.b64decode(generated['pdf']);regions=extract_pdf(original)['previewRegions']
        for data,is_original in [(clean,False),(original,True)]:
            result=highlight_pdf(data,[change],regions,is_original)
            self.assertEqual(result['highlightedChanges'],1)
            with pymupdf.open(stream=base64.b64decode(result['pdf']),filetype='pdf') as marked,pymupdf.open(stream=data,filetype='pdf') as plain:
                self.assertEqual([p.get_text() for p in marked],[p.get_text() for p in plain])
                self.assertTrue(any(list(p.annots() or []) for p in marked))
                self.assertFalse(any(list(p.annots() or []) for p in plain))
    def test_unique_text_fallback_for_docx_render(self):
        original=fixture();change=edit_for(original);generated=generate_pdf(original,[change]);clean=base64.b64decode(generated['pdf'])
        self.assertEqual(highlight_pdf(clean,[change])['highlightedChanges'],1)
    def test_missing_change_fails_without_returning_a_misleading_preview(self):
        original=fixture();change=edit_for(original);change['replacement']='Text that is absent from this document.'
        with self.assertRaises(DocumentError):highlight_pdf(original,[change])

    def test_rendered_review_page_visibly_contains_highlights(self):
        original=fixture();change=edit_for(original);clean=base64.b64decode(generate_pdf(original,[change])['pdf'])
        highlighted=base64.b64decode(highlight_pdf(clean,[change],extract_pdf(original)['previewRegions'])['pdf'])
        plain=render_preview_page(clean,1);marked=render_preview_page(highlighted,1)
        self.assertEqual(plain['width'],marked['width'])
        self.assertNotEqual(plain['image'],marked['image'])
