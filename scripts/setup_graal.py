#!/usr/bin/env python3
"""Dashboard/GLPI Ubuntu: rede privada ou HTTPS em servidor compartilhado."""
import argparse, contextlib, datetime, hashlib, ipaddress, json, os, pathlib, re
import secrets, shlex, shutil, socket, stat, subprocess, sys, tarfile, tempfile, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
DIAGNOSTIC_PHASES={"bootstrap","resources","kernel","security","read-config","payload-validation","api-read","persist","verify-persist","commit","version","backup","status","deactivate","install","activate","cache-clear"}
DIAGNOSTIC_REASONS={"instance-in-use","instance-mismatch","invalid-fields","invalid-action","payload-too-large","invalid-input","invalid-local-flag","invalid-loopback","invalid-url","invalid-mode","invalid-http-mode","invalid-instance","invalid-token","invalid-timeout","disabled","invalid-json","validation-exception"}
class SetupError(Exception):
    def __init__(self,message,diagnostic=None):
        super().__init__(message);self.diagnostic=diagnostic

def safe_diagnostic(raw):
    for line in (raw or "").splitlines():
        if not line.startswith("GRAAL_DIAGNOSTIC "):continue
        try: value=json.loads(line.removeprefix("GRAAL_DIAGNOSTIC "))
        except ValueError:continue
        if not isinstance(value,dict) or not isinstance(value.get("phase"),str) or value["phase"] not in DIAGNOSTIC_PHASES:continue
        result={"phase":value["phase"]}
        if type(value.get("status")) is int and 100<=value["status"]<=599:result["status"]=value["status"]
        if isinstance(value.get("reason"),str) and value["reason"] in DIAGNOSTIC_REASONS:result["reason"]=value["reason"]
        return result
    return None

def glpi_step(phase,cmd,**kwargs):
    try:return run_command(cmd,**kwargs)
    except SetupError as exc:
        diagnostic=exc.diagnostic or {"phase":phase}
        raise SetupError(f"Etapa GLPI {phase}: {exc}",diagnostic) from None

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
    except (subprocess.CalledProcessError,OSError) as exc:
        diagnostic=safe_diagnostic(getattr(exc,"stderr",None))
        detail=(f" Etapa: {diagnostic['phase']}."+(f" HTTP {diagnostic['status']}." if 'status' in diagnostic else "")) if diagnostic else ""
        if diagnostic and "reason" in diagnostic:
            detail+=f" Motivo: {diagnostic['reason']}."
            if diagnostic['reason']=="instance-in-use":detail+=" Há intenções/histórico no plugin; a instância foi preservada. Não apague a tabela nem force a troca."
        raise SetupError(f"Falha em {pathlib.Path(str(cmd[0])).name}."+detail+" Nenhum segredo é exibido.",diagnostic) from None
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
    p=argparse.ArgumentParser(description="Graal Ubuntu: rede privada ou HTTPS, GLPI no host ou por SSH.")
    sub=p.add_subparsers(dest="action",required=True);d=sub.add_parser("dashboard")
    d.add_argument("--configure-only",action="store_true");d.add_argument("--skip-glpi",action="store_true")
    d.add_argument("--mode",choices=["local","online"],help="local: HTTP privado; online: proxy HTTPS existente no servidor");d.add_argument("--public-origin");d.add_argument("--api-url")
    d.add_argument("--glpi-connection",choices=["local","ssh"]);d.add_argument("--glpi-local",dest="glpi_connection",action="store_const",const="local",help="Instalar/configurar GLPI no próprio host, sem SSH")
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
    g.add_argument("--diagnose-only",action="store_true")
    return p.parse_args(argv)
def parsed_url(value,api=False):
    from urllib.parse import urlsplit
    need(isinstance(value,str) and value and not re.search(r"\s|[\x00-\x1f\x7f]",value),"URL inválida.")
    try:
        u=urlsplit(value);port=u.port
        need(u.scheme in ("http","https") and u.hostname and u.username is None and u.password is None and not u.query and not u.fragment,"URL inválida.")
        need(u.path==("/api/integration/v1" if api else ""),"Use origem sem caminho/barra final; API exige /api/integration/v1.")
        need(port is None or 1<=port<=65535,"Porta inválida.")
        return u
    except ValueError:raise SetupError("URL inválida.") from None

def loopback_host(host):return host in ("localhost","127.0.0.1","::1")

def configure_env(root,args,available):
    path=root/".env";need(not path.is_symlink(),".env não pode ser link simbólico.")
    old=path.read_text(encoding="utf-8") if path.exists() else "";env=parse_env(old);initial=dict(env);existing=bool(old)
    need(not any(k.startswith("DOCKER_") for k in env),"Opções DOCKER_ no .env exigem revisão manual.")
    mode=args.mode or ("online" if env.get("GRAAL_SETUP_MODE")=="production" else "local")
    marker="production" if mode=="online" else "homologacao"
    if existing and env.get("GRAAL_SETUP_MODE") not in ("homologacao","production"):
        need(args.adopt_env,".env não gerenciado: revise --adopt-env; arquivo preservado.")
        need(args.project and (args.public_origin if mode=="online" else args.ip),"Adoção exige projeto e origem/IP explícitos.")
        need(all(env.get(k) for k in ("POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET")),"Adoção exige segredos existentes; não serão regenerados.")
    if env.get("GRAAL_SETUP_MODE") in ("homologacao","production"):
        need(env["GRAAL_SETUP_MODE"]==marker,"Modo existente diferente: revise a transição mantendo projeto, banco, volumes e segredos; .env preservado.")
    port=args.port or int(env.get("DASHBOARD_PORT","8080"));need(1024<=port<=65535,"Porta deve estar entre1024 e65535.")
    need(mode!="online" or not args.ip or args.ip=="127.0.0.1","Modo online publica só em127.0.0.1; use --public-origin para o domínio público.")
    ip="127.0.0.1" if mode=="online" else choose_ip(available,args.ip or env.get("DASHBOARD_IP"))
    origin=args.public_origin or env.get("PUBLIC_ORIGIN") or (None if mode=="online" else f"http://{ip}:{port}")
    need(origin,"Modo online exige --public-origin https://DOMINIO ou PUBLIC_ORIGIN HTTPS existente.")
    u=parsed_url(origin)
    if mode=="online":
        need(u.scheme=="https" and not loopback_host(u.hostname),"Modo online exige origem HTTPS alcançável pelos navegadores.")
        hostname="["+u.hostname+"]" if ":" in u.hostname else u.hostname
        canonical="https://"+hostname+(":"+str(u.port) if u.port and u.port!=443 else "")
        need(origin==canonical,"PUBLIC_ORIGIN deve ser canônica: HTTPS, host minúsculo, sem porta443 redundante ou barra final.")
    else:need(origin==f"http://{ip}:{port}","PUBLIC_ORIGIN diverge do IP/porta; arquivo preservado.")
    connection=args.glpi_connection or env.get("GLPI_CONNECTION","ssh");need(connection in ("local","ssh"),"GLPI_CONNECTION deve ser local ou ssh.")
    api=args.api_url or env.get("GLPI_API_BASE_URL") or (f"http://127.0.0.1:{port}/api/integration/v1" if connection=="local" and mode=="online" else origin+"/api/integration/v1")
    project=args.project or env.get("COMPOSE_PROJECT_NAME", "graal-estoque" if mode=="online" else "graal-homologacao")
    need(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,50}",project),"Projeto Compose inválido.")
    defaults={"GRAAL_SETUP_MODE":marker,"NODE_ENV":"production" if mode=="online" else "development","PORT":"3000",
        "DASHBOARD_IP":ip,"DASHBOARD_PORT":str(port),"COMPOSE_PROJECT_NAME":project,"PUBLIC_ORIGIN":origin,
        "GLPI_CONNECTION":connection,"GLPI_API_BASE_URL":api,
        "POSTGRES_USER":"graal_owner","POSTGRES_DB":"graal","INTEGRATION_ENABLED":"true",
        "GLPI_INSTANCE_ID":"glpi-"+socket.gethostname().lower().replace(" ","-"),"GLPI_SSH_PORT":"22",
        "GLPI_DIR":"/var/www/glpi","GLPI_WEB_USER":"www-data","INTEGRATION_TOKEN_FILE":".local-setup/integration-token"}
    for key,value in defaults.items():
        if key in initial and key in ("DASHBOARD_IP","DASHBOARD_PORT","COMPOSE_PROJECT_NAME","PUBLIC_ORIGIN","GLPI_CONNECTION","GLPI_API_BASE_URL"):
            need(initial[key]==value,f"{key} já configurado; revisão manual necessária.")
        env.setdefault(key,value)
    need(env["NODE_ENV"] in (("production",) if mode=="online" else ("development","test")),"NODE_ENV incompatível com o modo escolhido.")
    for key in ("POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET"):
        if not env.get(key):need(not existing,f"{key} ausente; forneça o segredo correto do ambiente.");env[key]=secrets.token_hex(32)
    need(all(re.fullmatch(r"[A-Za-z0-9_]{1,63}",env[k]) for k in ("POSTGRES_USER","POSTGRES_DB")),"Nome de banco/usuário inválido.")
    need(env["POSTGRES_USER"]!="graal_app","Dono do banco não pode ser graal_app.")
    need(re.fullmatch(r"[a-f0-9]{64,}",env["DB_APP_PASSWORD"]),"DB_APP_PASSWORD deve ser hexadecimal com ao menos64 caracteres.")
    need(len(env["SESSION_SECRET"])>=32,"SESSION_SECRET curto.")
    need(env["INTEGRATION_ENABLED"] in ("true","false"),"INTEGRATION_ENABLED deve ser true ou false.")
    env.setdefault("DATABASE_URL",f"postgresql://graal_app:{env['DB_APP_PASSWORD']}@db:5432/{env['POSTGRES_DB']}")
    for attr,key in {"glpi_host":"GLPI_SSH_HOST","glpi_user":"GLPI_SSH_USER","glpi_port":"GLPI_SSH_PORT","ssh_key":"GLPI_SSH_KEY","glpi_dir":"GLPI_DIR","web_user":"GLPI_WEB_USER","instance":"GLPI_INSTANCE_ID"}.items():
        value=getattr(args,attr,None)
        if value is not None:need(key not in initial or initial[key]==str(value),f"{key} existente não será alterado automaticamente.");env[key]=str(value)
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,120}",env["GLPI_INSTANCE_ID"]),"Instância inválida.")
    # Validar endereços/flags antes de gravar qualquer configuração ou segredo.
    make_payload(env,"11111111-1111-4111-8111-111111111111."+"a"*64)
    for key in initial:need(env[key]==initial[key],f"{key} existente não será reescrito.")
    new=old.rstrip("\r\n")+"\n" if old else "# Configuração Ubuntu privada/HTTPS. Nunca versionar.\n"
    for key,value in env.items():
        if key in initial:continue
        need(not any(c in str(value) for c in ("\r","\n","\x00","'","$",chr(96))),f"Valor não suportado em {key}.")
        new+=f"{key}='{value}'\n"
    if new!=old:
        if existing:atomic_write(root/".local-setup"/("env-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")+".bak"),old)
        atomic_write(path,new)
    else:os.chmod(path,0o600)
    return env

def compose_command(root,env,tail):
    file="compose.same-host.yaml" if env.get("GRAAL_SETUP_MODE")=="production" else "compose.homologacao.yaml"
    return ["docker","compose","--env-file",str(root/".env"),"-p",env["COMPOSE_PROJECT_NAME"],"-f",str(root/file),*tail]

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
    need(isinstance(p,dict) and fields<=set(p) and set(p)<=fields|{"local_http"},"Payload inválido.")
    need(re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.[a-f0-9]{64}",p["token"]),"Credencial inválida.")
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,120}",p["instance_id"]),"Instância inválida.")
    u=parsed_url(p["base_url"],True)
    need(p["deployment_mode"] in ("production","homologacao") and type(p["private_http"]) is bool and type(p.get("local_http",False)) is bool,"Modo/flags inválidos.")
    local=p.get("local_http",False);private=p["private_http"]
    need(not local or loopback_host(u.hostname),"HTTP local exige loopback do mesmo servidor.")
    need(not private or (p["deployment_mode"]=="homologacao" and private_ipv4(u.hostname)),"HTTP privado exige homologação explícita.")
    need(not (local and private),"Flags HTTP incompatíveis.")
    need((u.scheme=="https" and not local and not private) or (u.scheme=="http" and (local or private)),"Use HTTPS; HTTP somente privado ou loopback explícito.")
    need(p["enabled"] is True and p["timeout"]==10 and p["connect_timeout"]==3,"Parâmetros inesperados.")

def make_payload(env,token):
    origin=parsed_url(env["PUBLIC_ORIGIN"]);url=env.get("GLPI_API_BASE_URL") or env["PUBLIC_ORIGIN"]+"/api/integration/v1";u=parsed_url(url,True)
    local=u.scheme=="http" and loopback_host(u.hostname)
    need(not local or env.get("GLPI_CONNECTION")=="local","Loopback da API só pode ser usado com GLPI local no mesmo servidor.")
    production=env.get("GRAAL_SETUP_MODE")=="production" or origin.scheme=="https" or u.scheme=="https"
    p={"enabled":True,"base_url":url,"instance_id":env["GLPI_INSTANCE_ID"],"token":token,
       "timeout":10,"connect_timeout":3,"private_http":u.scheme=="http" and not local,"deployment_mode":"production" if production else "homologacao"}
    if local:p["local_http"]=True
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
    result=call({"operation":"list-admins"})
    need(not result.get("requiresFirstAccess",False),"Conclua o primeiro acesso e a troca de senha no dashboard antes de provisionar a integração. Nenhuma credencial foi criada.")
    admins=result["items"]
    need(admins,"Nenhum responsável ativo e apto. Use a administração de contas; não recrie o bootstrap em banco já configurado.")
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
def build_package(root):
    run_command([sys.executable,str(root/"scripts/package-glpi-plugin.py")],cwd=root)
    ver=re.search(r"PLUGIN_ESTOQUEGRAAL_VERSION','([0-9.]+)'",(root/"glpi-plugin/estoquegraal/setup.php").read_text()).group(1)
    package=root/"dist"/f"estoquegraal-{ver}.zip";validate_package(package)
    return package,hashlib.sha256(package.read_bytes()).hexdigest()

def configure_local(root,env,token,*,diagnose=False):
    directory=env["GLPI_DIR"];web=env["GLPI_WEB_USER"]
    need(re.fullmatch(r"/[A-Za-z0-9_./-]+",directory) and ".." not in pathlib.PurePosixPath(directory).parts and directory!="/","GLPI_DIR inválido.")
    need(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}",web),"Usuário PHP inválido.")
    package,digest=build_package(root)
    prefix=[] if getattr(os,"geteuid",lambda:-1)()==0 else ["sudo","-n"]
    require_tools(["bash"]+([] if not prefix else ["sudo"]))
    command=prefix+["bash",str(root/"scripts/configurar-glpi.sh"),"--glpi-dir",directory,"--web-user",web,"--package",str(package),"--sha256",digest]
    if diagnose:command+=["--diagnose-only"]
    result=run_command(command,input_text=json.dumps(make_payload(env,token))+"\n",cwd=root)
    try:report=json.loads(result.stdout)
    except ValueError:raise SetupError("Resposta de instalação local inválida; confira backup GLPI.")
    need(report.get("ok") is True,"Instalação local não confirmada.")
    if diagnose:print("Diagnóstico OK: PHP/GLPI, chave e leitura autenticada da API. Nenhuma configuração ou movimento gravado.")
    else:print("Backup local:",report.get("backup","consulte /var/backups/estoque-graal"));print("GLPI local configurado. Confira perfis e vínculos.")

def configure_remote(root,env,token):
    require_tools(["ssh","scp"]);ssh=ssh_command(env);scp=ssh_command(env,"scp")
    directory=env["GLPI_DIR"];web=env["GLPI_WEB_USER"]
    need(re.fullmatch(r"/[A-Za-z0-9_./-]+",directory) and ".." not in pathlib.PurePosixPath(directory).parts and directory!="/","GLPI_DIR inválido.")
    need(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}",web),"Usuário PHP inválido.")
    stage=run_command(ssh+["umask 077; mktemp -d /tmp/estoque-graal.XXXXXXXX"]).stdout.strip()
    need(re.fullmatch(r"/tmp/estoque-graal\.[A-Za-z0-9]+",stage),"Diretório remoto inesperado.")
    try:
        package,digest=build_package(root)
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
    need(re.search(r"\b11\.0\.5\b",glpi_step("version",cli+["--version"],cwd=root).stdout),"Versão GLPI diferente de 11.0.5: exige revisão.")
    if args.diagnose_only:
        parent=root/"plugins";parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".estoquegraal-probe-",dir=parent) as stage:
            os.chmod(stage,0o755)
            with zipfile.ZipFile(package) as archive:archive.extractall(stage)
            probe=pathlib.Path(stage)/"estoquegraal"
            for item in [probe,*probe.rglob("*")]:os.chmod(item,0o755 if item.is_dir() else 0o644)
            glpi_step("api-read",php+[str(probe/"tools/configure-cli.php"),"probe","--root",str(root)],input_text=json.dumps(payload),cwd=root)
        print(json.dumps({"ok":True,"readCheck":True}));return
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
            exported=glpi_step("backup",php+[str(new/"tools/configure-cli.php"),"backup","--root",str(root)],cwd=root).stdout
            atomic_write(backup/"config.json",exported)
            state=json.loads(glpi_step("status",php+[str(new/"tools/configure-cli.php"),"status","--root",str(root)],cwd=root).stdout)
            if state.get("active"):glpi_step("deactivate",cli+["plugin:deactivate","estoquegraal"],cwd=root)
            shutil.copytree(dest,backup/"plugin")
        try:
            if existed:dest.rename(pathlib.Path(tmp)/"previous")
            new.rename(dest)
            glpi_step("install",cli+["plugin:install","--force","estoquegraal"],cwd=root)
            glpi_step("activate",cli+["plugin:activate","estoquegraal"],cwd=root)
            helper=php+[str(dest/"tools/configure-cli.php")]
            if not existed:atomic_write(backup/"config.json",glpi_step("backup",helper+["backup"],cwd=root).stdout)
            glpi_step("persist",helper+["apply"],input_text=json.dumps(payload),cwd=root)
            glpi_step("cache-clear",cli+["cache:clear"],cwd=root)
        except (SetupError,OSError,ValueError) as exc:
            if not dest.exists() and (pathlib.Path(tmp)/"previous").exists():(pathlib.Path(tmp)/"previous").rename(dest)
            try:glpi_step("deactivate",cli+["plugin:deactivate","estoquegraal"],cwd=root)
            except SetupError:pass
            raise SetupError(f"GLPI incompleto; plugin desativado quando possível. Backup: {backup}. {exc}",getattr(exc,"diagnostic",None)) from None
    print(json.dumps({"ok":True,"backup":str(backup)}))
def main(argv=None):
    os.umask(0o077)
    args=arguments(argv)
    if args.action=="glpi":install_glpi(args,json.loads(sys.stdin.read(65537)));return
    need(sys.platform.startswith("linux"),"Execute no Ubuntu; testes Python funcionam em outras plataformas.")
    require_tools(["ip"])
    with setup_lock(ROOT):
        env=configure_env(ROOT,args,discover_ips())
        print("Dashboard:",env["PUBLIC_ORIGIN"],"| modo:",env["GRAAL_SETUP_MODE"],"| projeto:",env["COMPOSE_PROJECT_NAME"])
        if args.configure_only:print(".env preparado, sem Docker/SSH.");return
        require_tools(["docker"]);run_command(["docker","compose","version"])
        context=os.environ.get("DOCKER_CONTEXT") or run_command(["docker","context","show"]).stdout.strip()
        daemon=(os.environ.get("DOCKER_HOST") if not os.environ.get("DOCKER_CONTEXT") else None) or run_command(["docker","context","inspect",context,"--format","{{.Endpoints.docker.Host}}"]).stdout.strip()
        need(daemon.startswith("unix://"),"Use um daemon Docker local via socket Unix; contexto remoto não será alterado.")
        run_command(compose_command(ROOT,env,["config","--quiet"]),cwd=ROOT)
        print("Construindo imagens e iniciando serviços; aguarde.")
        run_command(compose_command(ROOT,env,["up","-d","--build","--wait","--wait-timeout","240"]),cwd=ROOT)
        print("Serviços internos iniciados; acesso HTTPS depende do proxy/DNS/certificado existentes:" if env["GRAAL_SETUP_MODE"]=="production" else "Dashboard iniciado:",env["PUBLIC_ORIGIN"])
        if env["INTEGRATION_ENABLED"]=="false":print("Integração explicitamente desabilitada; GLPI e credenciais não foram alterados.");return
        if args.skip_glpi:print("GLPI não acessado. Reexecute sem --skip-glpi para configurar.");return
        if env.get("GLPI_CONNECTION")=="local":
            token=provision(ROOT,env,args);configure_local(ROOT,env,token)
        else:
            for key,prompt in [("GLPI_SSH_HOST","Host SSH do GLPI"),("GLPI_SSH_USER","Usuário SSH do GLPI")]:
                if not env.get(key):
                    value=ask(None,prompt);need(not any(c in value for c in ("'","\n","\r","$",chr(96))),"Valor inválido.")
                    atomic_write(ROOT/".env",(ROOT/".env").read_text()+f"{key}='{value}'\n");env[key]=value
            ssh_command(env)
            token=provision(ROOT,env,args);configure_remote(ROOT,env,token)
if __name__=="__main__":
    try:main()
    except (SetupError,ValueError,KeyError,OSError,TypeError) as e:
        if len(sys.argv)>1 and sys.argv[1]=="glpi":print("GRAAL_DIAGNOSTIC "+json.dumps(getattr(e,"diagnostic",None) or {"phase":"bootstrap"}),file=sys.stderr)
        print("ERRO:",str(e) if isinstance(e,SetupError) else "Falha de arquivo/configuração; revise parâmetros e permissões.",file=sys.stderr);sys.exit(1)
