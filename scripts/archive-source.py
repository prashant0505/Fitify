"""Build a local source-only handoff; never include credentials or user documents."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent.parent
ignored={'node_modules','dist','.vinext','.wrangler','.sites-runtime','.git','work','output','outputs','test-results','playwright-report','__pycache__','.venv'}
(root/'outputs').mkdir(exist_ok=True)
with zipfile.ZipFile(root/'outputs/fitify-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for source in root.rglob('*'):
        relative=source.relative_to(root)
        if any(part in ignored for part in relative.parts) or not source.is_file(): continue
        if relative.parts[0]=='.next' and relative.as_posix()!='.next/types/routes.d.ts': continue
        if source.name.startswith('.env') and source.name!='.env.example': continue
        if source.name.startswith('.dev.vars') or source.name.endswith(('.tsbuildinfo','.pyc')) or source.name=='.DS_Store': continue
        archive.write(source,relative)
print('Saved outputs/fitify-source.zip (secrets and runtime data excluded).')
