"""Pacote determinístico, sem ferramentas PHP/GLPI, testes ou segredos locais."""
from pathlib import Path
import hashlib, zipfile
base=Path(__file__).resolve().parents[1]
source=base/'glpi-plugin/estoquegraal'
out=base/'glpi-plugin/dist/estoquegraal-0.1.0.zip'
out.parent.mkdir(parents=True,exist_ok=True)
files=[source/n for n in ['setup.php','hook.php','README.md','LICENSE']]
for folder in ['lib','inc','front','ajax','js','css','pics','docs']:
    files.extend(p for p in (source/folder).rglob('*') if p.is_file())
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for f in sorted(files):
        info=zipfile.ZipInfo('estoquegraal/'+f.relative_to(source).as_posix(),(2026,10,22,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644<<16
        z.writestr(info,f.read_bytes())
digest=hashlib.sha256(out.read_bytes()).hexdigest()
out.with_suffix('.zip.sha256').write_text(digest+'  '+out.name+'\n',encoding='ascii')
print(str(out));print('SHA256 '+digest)
