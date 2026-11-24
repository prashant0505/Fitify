"""Create an annotated review copy. Never mutate the validated download file."""
import base64
import io
import re
import pdfplumber
import pymupdf
from pdf_engine import serialized

@serialized
def highlight_pdf(data,changes,regions=None,original=False):
    from engine import DocumentError
    if not isinstance(changes,list) or not 0<len(changes)<=100:raise DocumentError('No content changes are available to highlight.')
    geometry={region['id']:region for region in (regions or [])}
    highlighted=0
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        before=[page.get_text() for page in doc]
        for change in changes:
            text=change['original'] if original else change['replacement']
            region=geometry.get(change['id']);matches=[]
            if not region:
                # DOCX renders have no source PDF coordinates. Require a unique
                # text occurrence rather than marking unrelated duplicate text.
                pattern=r'\s+'.join(re.escape(word) for word in text.split())
                with pdfplumber.open(io.BytesIO(data)) as rendered:
                    count=sum(len(page.search(pattern,regex=True,case=True)) for page in rendered.pages)
                if count!=1:raise DocumentError('This change could not be located uniquely in the PDF preview. Use the content changes tab to review it.')
            for page_number,page in enumerate(doc):
                if region and page_number!=region['page']:continue
                quads=page.search_for(text,quads=True)
                if region:
                    box=pymupdf.Rect(region['bbox'])+(-.5,-.5,.5,.5)
                    quads=[quad for quad in quads if box.intersects(quad.rect)]
                if quads:matches.append((page,quads))
            if not matches:raise DocumentError('An updated text region could not be located for highlighting. The clean PDF is still available.')
            for page,quads in matches:
                annotation=page.add_highlight_annot(quads)
                annotation.set_colors(stroke=(1,.76,.18))
                annotation.set_opacity(.35)
                annotation.set_info(title='FitiFy review',content='Replaced original content' if original else 'Updated content')
                annotation.update()
            highlighted+=1
        result=doc.tobytes(garbage=4,deflate=True)
    with pymupdf.open(stream=result,filetype='pdf') as check:
        if [page.get_text() for page in check]!=before:raise DocumentError('Preview annotation changed document text. Use the clean preview.')
    return {'pdf':base64.b64encode(result).decode(),'highlightedChanges':highlighted}

@serialized
def render_preview_page(data,page_number):
    from engine import DocumentError
    if not isinstance(page_number,int) or page_number<1:raise DocumentError('Invalid preview page.')
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        if page_number>len(doc):raise DocumentError('Preview page does not exist.')
        page=doc[page_number-1]
        if page.rect.width*page.rect.height>2500000:raise DocumentError('PDF preview page is too large to render safely.')
        pixels=page.get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False,annots=True)
        return {'image':base64.b64encode(pixels.tobytes('png')).decode(),'width':pixels.width,'height':pixels.height}
