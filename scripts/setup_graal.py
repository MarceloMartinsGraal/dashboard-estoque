#!/usr/bin/env python3
"""Homologação Ubuntu: orquestração sem dependências Python externas."""
import argparse, contextlib, datetime, hashlib, ipaddress, json, os, pathlib, re
import secrets, shlex, shutil, socket, stat, subprocess, sys, tarfile, tempfile, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
class SetupError(Exception):pass
def need(value,message):
    if not value:raise SetupError(message)
def private_ipv4(value):
    try:return any(ipaddress.IPv4Address(value) in ipaddress.ip_network(n) for n in ("10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"))
    except (ValueError,TypeError):return False
def parse_env(text):
    values={}
    for number,line in enumerate(text.splitlines(),1):
        line=line.strip()
        if not line or line.startswith("#"):continue
        m=re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)",line)
        need(m,f".env: sintaxe inválida na linha {number}.")
        key,value=m.groups();need(key not in values,f".env: chave duplicada {key}.")
        if value.startswith(("'",'"')):
            need(len(value)>=2 and value[-1]==value[0],f".env: aspas inválidas em {key}.");value=value[1:-1]
        need("\x00" not in value,f".env: valor inválido em {key}.");values[key]=value
    return values
def run_command(cmd,*,input_text=None,capture=True,cwd=None):
    command_env=os.environ.copy()
    if len(cmd)>1 and str(cmd[0])=="docker" and cmd[1]=="compose" and "--env-file" in cmd:
        env_path=pathlib.Path(cmd[cmd.index("--env-file")+1])
        parsed=parse_env(env_path.read_text(encoding="utf-8"))
        need(not any(k.startswith("DOCKER_") for k in parsed),"Não configure DOCKER_HOST/DOCKER_CONTEXT ou opções DOCKER_ no .env; use somente daemon local revisado.")
        allowed={"DASHBOARD_IP","DASHBOARD_PORT","PUBLIC_ORIGIN","COMPOSE_PROJECT_NAME","POSTGRES_USER","POSTGRES_DB","POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET","INTEGRATION_ENABLED"}
        command_env.update({k:v for k,v in parsed.items() if k in allowed})
    try:return subprocess.run([str(x) for x in cmd],input=input_text,text=True,encoding="utf-8",capture_output=capture,check=True,cwd=cwd,env=command_env)
    except (subprocess.CalledProcessError,OSError):
        raise SetupError(f"Falha em {pathlib.Path(str(cmd[0])).name}; consulte os logs protegidos do serviço, sem publicar segredos.") from None
def atomic_write(path,text,mode=0o600):
    path=pathlib.Path(path);need(not path.is_symlink(),f"Link simbólico recusado: {path.name}")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        os.chmod(tmp,mode)
        with os.fdopen(fd,"w",encoding="utf-8",newline="\n") as f:f.write(text);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
@contextlib.contextmanager
def setup_lock(root):
    path=root/".setup-graal.lock"
    try:fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:raise SetupError("Configuração em andamento: verifique .setup-graal.lock antes de removê-lo.")
    try:os.write(fd,str(os.getpid()).encode());os.close(fd);yield
    finally:path.unlink(missing_ok=True)
def discover_ips():
    raw=run_command(["ip","-j","-4","address","show","up"]).stdout;result=[]
    try:
        for interface in json.loads(raw):
            name=interface.get("ifname","")
            if name=="lo" or re.match(r"^(docker|br-|veth|virbr|cni|flannel|tun|tailscale)",name):continue
            for address in interface.get("addr_info",[]):
                ip=address.get("local")
                if private_ipv4(ip):result.append(ip)
    except (ValueError,TypeError):raise SetupError("Endereços de rede inválidos.")
    return list(dict.fromkeys(result))
def choose_ip(available,explicit):
    if explicit:
        need(private_ipv4(explicit),"Use IPv4 privado RFC1918.")
        need(explicit in available,"O IP escolhido não está atribuído à máquina.");return explicit
    need(len(available)==1,"IP privado ambíguo ou ausente. Informe --ip com endereço desta máquina.");return available[0]
def arguments(argv=None):
    p=argparse.ArgumentParser(description="Graal: homologação por IP e configuração GLPI via SSH.")
    sub=p.add_subparsers(dest="action",required=True);d=sub.add_parser("dashboard")
    d.add_argument("--configure-only",action="store_true");d.add_argument("--skip-glpi",action="store_true")
    d.add_argument("--ip");d.add_argument("--port",type=int);d.add_argument("--project")
    d.add_argument("--glpi-host");d.add_argument("--glpi-user");d.add_argument("--glpi-port",type=int)
    d.add_argument("--ssh-key");d.add_argument("--glpi-dir");d.add_argument("--web-user");d.add_argument("--instance")
    d.add_argument("--admin-id");d.add_argument("--valid-days",type=int,default=30)
    d.add_argument("--link",action="append",default=[],metavar="GLPI_ID:FUNCIONARIO_UUID")
    d.add_argument("--adopt-env",action="store_true")
    g=sub.add_parser("glpi")
    g.add_argument("--glpi-dir",required=True);g.add_argument("--web-user",default="www-data")
    g.add_argument("--package",required=True);g.add_argument("--sha256",required=True)
    g.add_argument("--backup-dir",default="/var/backups/estoque-graal")
    return p.parse_args(argv)
def configure_env(root,args,available):
    path=root/".env";need(not path.is_symlink(),".env não pode ser link simbólico.")
    old=path.read_text(encoding="utf-8") if path.exists() else "";env=parse_env(old);initial=dict(env);existing=bool(old)
    need(not any(k.startswith("DOCKER_") for k in env),"Opções DOCKER_ no .env exigem remoção/revisão manual; não serão executadas.")
    if existing and env.get("GRAAL_SETUP_MODE")!="homologacao":
        need(args.adopt_env,".env não gerenciado: revise --adopt-env; arquivo preservado.")
        need(env.get("NODE_ENV") in ("development","test"),"Não adotar configuração de produção.")
        need(args.ip and args.project,"Adoção exige --ip e --project explícitos.")
        need(all(env.get(k) for k in ("POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET")),"Adoção exige segredos existentes; não serão regenerados.")
    ip=choose_ip(available,args.ip or env.get("DASHBOARD_IP"));port=args.port or int(env.get("DASHBOARD_PORT","8080"))
    need(1024<=port<=65535,"Porta deve estar entre 1024 e 65535.")
    project=args.project or env.get("COMPOSE_PROJECT_NAME","graal-homologacao")
    need(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,50}",project),"Projeto Compose inválido.")
    if env.get("GRAAL_SETUP_MODE")=="homologacao":
        for k,v in {"DASHBOARD_IP":ip,"DASHBOARD_PORT":str(port),"COMPOSE_PROJECT_NAME":project}.items():
            need(not env.get(k) or env[k]==v,f"{k} já configurado; revisão manual necessária.")
    defaults={"GRAAL_SETUP_MODE":"homologacao","NODE_ENV":"development","PORT":"3000",
        "DASHBOARD_IP":ip,"DASHBOARD_PORT":str(port),"COMPOSE_PROJECT_NAME":project,"PUBLIC_ORIGIN":f"http://{ip}:{port}",
        "POSTGRES_USER":"graal_owner","POSTGRES_DB":"graal","INTEGRATION_ENABLED":"true",
        "GLPI_INSTANCE_ID":"glpi-"+socket.gethostname().lower().replace(" ","-"),"GLPI_SSH_PORT":"22",
        "GLPI_DIR":"/var/www/glpi","GLPI_WEB_USER":"www-data","INTEGRATION_TOKEN_FILE":".local-setup/integration-token"}
    need(not env.get("PUBLIC_ORIGIN") or env["PUBLIC_ORIGIN"]==defaults["PUBLIC_ORIGIN"],"PUBLIC_ORIGIN diverge do IP/porta; arquivo preservado.")
    for k,v in defaults.items():
        if k not in env:env[k]=v
    for k in ("POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET"):
        if not env.get(k):
            need(not existing,f"{k} ausente; forneça o segredo correto do ambiente.");env[k]=secrets.token_hex(32)
    need(all(re.fullmatch(r"[A-Za-z0-9_]{1,63}",env[k]) for k in ("POSTGRES_USER","POSTGRES_DB")),"Nome de banco/usuário inválido.")
    need(env["POSTGRES_USER"]!="graal_app","Dono do banco não pode ser graal_app.")
    need(re.fullmatch(r"[a-f0-9]{64,}",env["DB_APP_PASSWORD"]),"DB_APP_PASSWORD deve ser hexadecimal com ao menos 64 caracteres.")
    need(len(env["SESSION_SECRET"])>=32,"SESSION_SECRET curto.")
    need(env["NODE_ENV"] in ("development","test") and env["INTEGRATION_ENABLED"]=="true","Homologação requer NODE_ENV development/test e INTEGRATION_ENABLED=true.")
    env.setdefault("DATABASE_URL",f"postgresql://graal_app:{env['DB_APP_PASSWORD']}@db:5432/{env['POSTGRES_DB']}")
    for attr,key in {"glpi_host":"GLPI_SSH_HOST","glpi_user":"GLPI_SSH_USER","glpi_port":"GLPI_SSH_PORT","ssh_key":"GLPI_SSH_KEY","glpi_dir":"GLPI_DIR","web_user":"GLPI_WEB_USER","instance":"GLPI_INSTANCE_ID"}.items():
        value=getattr(args,attr,None)
        if value is not None:
            need(key not in initial or initial[key]==str(value),f"{key} existente não será alterado automaticamente.");env[key]=str(value)
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,120}",env["GLPI_INSTANCE_ID"]),"Instância inválida.")
    for k in initial:need(env[k]==initial[k],f"{k} existente não será reescrito.")
    new=old.rstrip("\r\n")+"\n" if old else "# Homologação HTTP privada. Nunca versionar.\n"
    for k,v in env.items():
        if k in initial:continue
        need(not any(c in str(v) for c in ("\r","\n","\x00","'","$",chr(96))),f"Valor não suportado em {k}.")
        new+=f"{k}='{v}'\n"
    if new!=old:
        if existing:atomic_write(root/".local-setup"/("env-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")+".bak"),old)
        atomic_write(path,new)
    else:os.chmod(path,0o600)
    return env
def compose_command(root,env,tail):
    return ["docker","compose","--env-file",str(root/".env"),"-p",env["COMPOSE_PROJECT_NAME"],"-f",str(root/"compose.homologacao.yaml"),*tail]
def ssh_command(env,program="ssh"):
    host=env.get("GLPI_SSH_HOST","");user=env.get("GLPI_SSH_USER","");port=env.get("GLPI_SSH_PORT","22")
    need(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host),"GLPI_SSH_HOST inválido.")
    need(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}",user),"GLPI_SSH_USER inválido.")
    need(str(port).isdigit() and 1<=int(port)<=65535,"Porta SSH inválida.")
    cmd=[program,"-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=15",("-P" if program=="scp" else "-p"),str(port)]
    if env.get("GLPI_SSH_KEY"):cmd+=["-i",str(pathlib.Path(env["GLPI_SSH_KEY"]).expanduser())]
    if program=="ssh":cmd+=[user+"@"+host]
    return cmd
def validate_payload(p):
    fields={"enabled","base_url","instance_id","token","timeout","connect_timeout","private_http","deployment_mode"}
    need(isinstance(p,dict) and set(p)==fields,"Payload inválido.")
    need(re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.[a-f0-9]{64}",p["token"]),"Credencial inválida.")
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,120}",p["instance_id"]),"Instância inválida.")
    from urllib.parse import urlsplit
    u=urlsplit(p["base_url"])
    need(u.path=="/api/integration/v1" and not u.query and not u.fragment and not u.username and u.hostname,"URL inválida.")
    need(u.scheme=="https" or (p["private_http"] is True and p["deployment_mode"]=="homologacao" and u.scheme=="http" and private_ipv4(u.hostname)),"HTTP somente privado com homologação explícita.")
    need(p["enabled"] is True and p["timeout"]==10 and p["connect_timeout"]==3,"Parâmetros inesperados.")
def make_payload(env,token):
    p={"enabled":True,"base_url":env["PUBLIC_ORIGIN"]+"/api/integration/v1","instance_id":env["GLPI_INSTANCE_ID"],"token":token,
       "timeout":10,"connect_timeout":3,"private_http":True,"deployment_mode":"homologacao"}
    validate_payload(p);return p
def validate_package(path):
    with zipfile.ZipFile(path) as z:
        need(sum(i.file_size for i in z.infolist())<20*1024*1024 and len(z.infolist())<1000,"ZIP excede limite.")
        need(len(z.namelist())==len(set(z.namelist())),"ZIP com nomes repetidos.")
        need(z.testzip() is None,"ZIP corrompido.")
        for i in z.infolist():
            p=pathlib.PurePosixPath(i.filename)
            need(not p.is_absolute() and p.parts and p.parts[0]=="estoquegraal" and ".." not in p.parts and "\\" not in i.filename,"Caminho inválido no ZIP.")
            need(not stat.S_ISLNK(i.external_attr>>16),"Link simbólico recusado no ZIP.")
        need(sum(i.file_size for i in z.infolist())<20*1024*1024,"ZIP excede limite.")
        for n in ("setup.php","hook.php","tools/configure-cli.php","public/js/app.js","public/css/plugin.css","public/pics/logo.svg"):
            need("estoquegraal/"+n in z.namelist(),f"Pacote incompleto: {n}.")
def require_tools(names):
    for n in names:need(shutil.which(n),f"Dependência ausente: {n}; instale antes de executar.")
def ask(value,prompt):
    if value:return value
    need(sys.stdin.isatty(),prompt+"; informe em argumento/.env.");return input(prompt+": ").strip()
def provision(root,env,args):
    def call(data):
        out=run_command(compose_command(root,env,["run","--rm","-T","--no-deps","api","node","scripts/provision-integration.cjs"]),input_text=json.dumps(data),cwd=root)
        try:return json.loads(out.stdout)
        except ValueError:raise SetupError("Resposta administrativa inválida; segredo não será exibido.")
    admins=call({"operation":"list-admins"})["items"]
    if not admins:
        need(sys.stdin.isatty(),"Execute o bootstrap interativo para criar o primeiro responsável.")
        run_command(compose_command(root,env,["run","--rm","api","node","dist/backend/bootstrap.js"]),capture=False,cwd=root)
        admins=call({"operation":"list-admins"})["items"]
    for item in admins:print("Responsável:",item["username"],item["id"])
    admin=ask(args.admin_id,"UUID do responsável que autoriza a integração")
    raw=root/env["INTEGRATION_TOKEN_FILE"];need(not raw.is_symlink(),"Arquivo de credencial não pode ser link.")
    path=raw.resolve();need(path.is_relative_to(root.resolve()/".local-setup"),"Credencial deve ficar em .local-setup/.")
    existing=path.read_text().strip() if path.exists() else None;links=[]
    for link in args.link:
        external,sep,employee=link.partition(":");need(sep and external and employee,"Use --link GLPI_ID:FUNCIONARIO_UUID.")
        links.append({"externalUserId":external,"employeeId":employee})
    result=call({"operation":"provision","instanceId":env["GLPI_INSTANCE_ID"],"adminId":admin,"existingToken":existing,"validDays":args.valid_days,"links":links})
    atomic_write(path,result["token"]+"\n")
    print("Credencial preservada." if existing else "Credencial criada e armazenada em arquivo protegido.")
    if not links:print("Configure vínculos explícitos de funcionários antes das movimentações.")
    return result["token"]
def configure_remote(root,env,token):
    require_tools(["ssh","scp"]);ssh=ssh_command(env);scp=ssh_command(env,"scp")
    directory=env["GLPI_DIR"];web=env["GLPI_WEB_USER"]
    need(re.fullmatch(r"/[A-Za-z0-9_./-]+",directory) and ".." not in pathlib.PurePosixPath(directory).parts and directory!="/","GLPI_DIR inválido.")
    need(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}",web),"Usuário PHP inválido.")
    stage=run_command(ssh+["umask 077; mktemp -d /tmp/estoque-graal.XXXXXXXX"]).stdout.strip()
    need(re.fullmatch(r"/tmp/estoque-graal\.[A-Za-z0-9]+",stage),"Diretório remoto inesperado.")
    try:
        run_command([sys.executable,str(root/"scripts/package-glpi-plugin.py")],cwd=root)
        ver=re.search(r"PLUGIN_ESTOQUEGRAAL_VERSION','([0-9.]+)'",(root/"glpi-plugin/estoquegraal/setup.php").read_text()).group(1)
        package=root/"dist"/f"estoquegraal-{ver}.zip";validate_package(package)
        digest=hashlib.sha256(package.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix="graal-deploy-") as tmp:
            bundle=pathlib.Path(tmp)/"bundle.tar"
            with tarfile.open(bundle,"w") as tar:
                for n in ["scripts/configurar-glpi.sh","scripts/setup_graal.py"]:tar.add(root/n,arcname=pathlib.Path(n).name)
                tar.add(package,arcname="plugin.zip")
            target=env["GLPI_SSH_USER"]+"@"+env["GLPI_SSH_HOST"]+":"+stage+"/bundle.tar"
            run_command(scp+["--",str(bundle),target])
        prefix=[] if env["GLPI_SSH_USER"]=="root" else ["sudo","-n"]
        cmd=prefix+["bash",stage+"/configurar-glpi.sh","--glpi-dir",directory,"--web-user",web,"--package",stage+"/plugin.zip","--sha256",digest]
        shell="tar -xf "+shlex.quote(stage+"/bundle.tar")+" -C "+shlex.quote(stage)+" && "+shlex.join(cmd)
        result=run_command(ssh+[shell],input_text=json.dumps(make_payload(env,token))+"\n")
        try:report=json.loads(result.stdout)
        except ValueError:raise SetupError("Resposta de instalação remota inválida; confira o backup no GLPI.")
        need(report.get("ok") is True,"Instalação remota não confirmada.")
        print("Backup remoto:",report.get("backup","consulte /var/backups/estoque-graal"))
        print("GLPI configurado. Confira direitos de perfil e vínculos.")
    finally:
        try:run_command(ssh+["rm -rf -- "+shlex.quote(stage)])
        except SetupError:print("Remova manualmente o diretório temporário:",stage)
def install_glpi(args,payload):
    validate_payload(payload);need(sys.platform.startswith("linux") and getattr(os,"geteuid",lambda:-1)()==0,"Execute como root/sudo no Ubuntu GLPI.")
    import pwd
    root=pathlib.Path(args.glpi_dir).resolve()
    need(root!=pathlib.Path("/") and (root/"bin/console").is_file() and (root/"vendor/autoload.php").is_file(),"GLPI_DIR inválido.")
    need(not (root/"marketplace/estoquegraal").exists(),"Cópia em marketplace; concilie antes.")
    package=pathlib.Path(args.package)
    need(re.fullmatch(r"[a-f0-9]{64}",args.sha256) and hashlib.sha256(package.read_bytes()).hexdigest()==args.sha256,"Checksum inválido.")
    validate_package(package);require_tools(["php","sudo"])
    try:account=pwd.getpwnam(args.web_user)
    except KeyError:raise SetupError("Usuário PHP inexistente.")
    php=["sudo","-n","-u",args.web_user,"--","php"];cli=php+[str(root/"bin/console"),"--no-interaction"]
    need(re.search(r"\b11\.0\.5\b",run_command(cli+["--version"],cwd=root).stdout),"Versão GLPI diferente de 11.0.5: exige revisão.")
    backup_root=pathlib.Path(args.backup_dir).resolve();need(not backup_root.is_relative_to(root),"Backup deve ficar fora da instalação GLPI.")
    backup_root.mkdir(parents=True,exist_ok=True);os.chmod(backup_root,0o700)
    backup=backup_root/datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f");backup.mkdir(mode=0o700)
    dest=root/"plugins/estoquegraal";need(not dest.is_symlink(),"Plugin não pode ser link.");dest.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".estoquegraal-",dir=dest.parent) as tmp:
        with zipfile.ZipFile(package) as z:z.extractall(tmp)
        new=pathlib.Path(tmp)/"estoquegraal"
        for item in [new,*new.rglob("*")]:os.chown(item,account.pw_uid,account.pw_gid);os.chmod(item,0o755 if item.is_dir() else 0o644)
        existed=dest.exists()
        if existed:
            os.chmod(tmp,0o755)
            exported=run_command(php+[str(new/"tools/configure-cli.php"),"backup","--root",str(root)],cwd=root).stdout
            atomic_write(backup/"config.json",exported)
            state=json.loads(run_command(php+[str(new/"tools/configure-cli.php"),"status","--root",str(root)],cwd=root).stdout)
            if state.get("active"):run_command(cli+["plugin:deactivate","estoquegraal"],cwd=root)
            shutil.copytree(dest,backup/"plugin")
        try:
            if existed:dest.rename(pathlib.Path(tmp)/"previous")
            new.rename(dest)
            run_command(cli+["plugin:install","--force","estoquegraal"],cwd=root)
            run_command(cli+["plugin:activate","estoquegraal"],cwd=root)
            helper=php+[str(dest/"tools/configure-cli.php")]
            if not existed:atomic_write(backup/"config.json",run_command(helper+["backup"],cwd=root).stdout)
            run_command(helper+["apply"],input_text=json.dumps(payload),cwd=root)
            run_command(cli+["cache:clear"],cwd=root)
        except (SetupError,OSError,ValueError):
            if not dest.exists() and (pathlib.Path(tmp)/"previous").exists():(pathlib.Path(tmp)/"previous").rename(dest)
            try:run_command(cli+["plugin:deactivate","estoquegraal"],cwd=root)
            except SetupError:pass
            raise SetupError(f"GLPI incompleto; plugin desativado quando possível. Backup: {backup}. Consulte recuperação; não desinstale.") from None
    print(json.dumps({"ok":True,"backup":str(backup)}))
def main(argv=None):
    os.umask(0o077)
    args=arguments(argv)
    if args.action=="glpi":install_glpi(args,json.loads(sys.stdin.read(65537)));return
    need(sys.platform.startswith("linux"),"Execute no Ubuntu; testes Python funcionam em outras plataformas.")
    require_tools(["ip"])
    with setup_lock(ROOT):
        env=configure_env(ROOT,args,discover_ips())
        print("Homologação HTTP privada:",env["PUBLIC_ORIGIN"],"| projeto:",env["COMPOSE_PROJECT_NAME"])
        if args.configure_only:print(".env preparado, sem Docker/SSH.");return
        require_tools(["docker"]);run_command(["docker","compose","version"])
        context=os.environ.get("DOCKER_CONTEXT") or run_command(["docker","context","show"]).stdout.strip()
        daemon=(os.environ.get("DOCKER_HOST") if not os.environ.get("DOCKER_CONTEXT") else None) or run_command(["docker","context","inspect",context,"--format","{{.Endpoints.docker.Host}}"]).stdout.strip()
        need(daemon.startswith("unix://"),"Use um daemon Docker local via socket Unix; contexto remoto não será alterado.")
        run_command(compose_command(ROOT,env,["config","--quiet"]),cwd=ROOT)
        print("Construindo imagens e iniciando serviços; aguarde.")
        run_command(compose_command(ROOT,env,["up","-d","--build","--wait","--wait-timeout","240"]),cwd=ROOT)
        print("Dashboard iniciado:",env["PUBLIC_ORIGIN"])
        if args.skip_glpi:print("GLPI não acessado. Reexecute sem --skip-glpi para configurar.");return
        for key,prompt in [("GLPI_SSH_HOST","Host SSH do GLPI"),("GLPI_SSH_USER","Usuário SSH do GLPI")]:
            if not env.get(key):
                value=ask(None,prompt);need(not any(c in value for c in ("'","\n","\r","$",chr(96))),"Valor inválido.")
                atomic_write(ROOT/".env",(ROOT/".env").read_text()+f"{key}='{value}'\n");env[key]=value
        ssh_command(env)
        token=provision(ROOT,env,args);configure_remote(ROOT,env,token)
if __name__=="__main__":
    try:main()
    except (SetupError,ValueError,KeyError,OSError,TypeError) as e:
        print("ERRO:",str(e) if isinstance(e,SetupError) else "Falha de arquivo/configuração; revise parâmetros e permissões.",file=sys.stderr);sys.exit(1)
