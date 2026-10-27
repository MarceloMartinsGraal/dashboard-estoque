"""Pacote determinístico a partir do código atual; sem runtime, testes ou segredos locais."""
from pathlib import Path
import hashlib, re, zipfile
base=Path(__file__).resolve().parents[1]
source=base/'glpi-plugin/estoquegraal'
docs=base/'docs/integracoes/glpi'
version=re.search(r"define\('PLUGIN_ESTOQUEGRAAL_VERSION','([0-9]+\.[0-9]+\.[0-9]+)'\)", (source/'setup.php').read_text(encoding='utf-8'))
if not version:
    raise SystemExit('Versão do plugin ausente ou inválida')
out=base/'dist'/('estoquegraal-'+version.group(1)+'.zip')
out.parent.mkdir(parents=True,exist_ok=True)
files={n:(source/n).read_bytes() for n in ['setup.php','hook.php','README.md','LICENSE']}
for folder in ['lib','inc','front','ajax','public','tools']:
    for p in (source/folder).rglob('*'):
        if p.is_file(): files[p.relative_to(source).as_posix()]=p.read_bytes()
for required in ['public/js/core.js','public/js/app.js','public/css/plugin.css','public/pics/logo.svg']:
    if required not in files: raise SystemExit('Asset público ausente: '+required)
for name in ['operacao.md','verificacao.md','fontes.json']:
    files['docs/'+name]=(docs/name).read_bytes()
# No ZIP os guias ficam junto do plugin; no repositório a documentação é centralizada.
readme=files['README.md'].decode('utf-8').replace('../../docs/integracoes/glpi/', 'docs/')
readme='\n'.join(line for line in readme.split('\n') if '../../docs/integracoes/integration-v1.md' not in line)
files['README.md']=readme.encode('utf-8')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for name,data in sorted(files.items()):
        info=zipfile.ZipInfo('estoquegraal/'+name,(2026,10,22,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644<<16
        z.writestr(info,data)
digest=hashlib.sha256(out.read_bytes()).hexdigest()
out.with_suffix('.zip.sha256').write_text(digest+'  '+out.name+'\n',encoding='ascii')
print(str(out));print('SHA256 '+digest)
