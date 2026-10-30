#!/usr/bin/env python3
"""Assistente Ubuntu para dashboard/GLPI no mesmo host. Sem dependências novas."""
import argparse
import contextlib
import datetime
import ipaddress
import json
import os
import pathlib
import re
import shlex
import sys
import tempfile
import urllib.request
import urllib.error
import setup_graal as sg

MARKER = "# Gerenciado pelo assistente Graal; nao editar manualmente."
STATE = "assistant.json"


def question(label, default=""):
    sg.need(sys.stdin.isatty(), "Primeira configuração exige terminal interativo.")
    answer = input(label + (f" [{default}]" if default else "") + ": ").strip()
    return answer or default


def validate(c):
    sg.need(c["mode"] in ("local", "online"), "Modo inválido.")
    sg.need(type(c["port"]) is int and 1024 <= c["port"] <= 65535, "Porta inválida.")
    sg.need(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,50}", c["project"]), "Projeto inválido.")
    sg.need(re.fullmatch(r"/[A-Za-z0-9_./-]+", c["glpi_dir"]) and ".." not in pathlib.PurePosixPath(c["glpi_dir"]).parts and c["glpi_dir"] != "/", "Diretório GLPI inválido.")
    sg.need(re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", c["web_user"]), "Usuário PHP inválido.")
    u = sg.parsed_url(c["origin"])
    if c["mode"] == "online":
        sg.need(c["proxy"] in ("nginx", "apache2"), "Proxy inválido.")
        host = u.hostname
        sg.need(host and len(host) <= 253 and all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", x) for x in host.split(".")) and "." in host, "Informe domínio DNS válido em minúsculas.")
        try: ipaddress.ip_address(host)
        except ValueError: pass
        else: raise sg.SetupError("Online exige domínio DNS, não IP.")
        sg.need(c["origin"] == "https://" + host and c["ip"] == "127.0.0.1", "Online exige HTTPS na porta443 e loopback interno.")
        for key in ("certificate", "key"):
            sg.need(re.fullmatch(r"/[A-Za-z0-9_./-]+", c[key]) and ".." not in pathlib.PurePosixPath(c[key]).parts, "Caminho TLS inválido.")
        if c["email"]: sg.need(re.fullmatch(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", c["email"]), "E-mail ACME inválido.")
        if "acme_webroot" in c:
            sg.need(re.fullmatch(r"/[A-Za-z0-9_./-]+", c["acme_webroot"]) and ".." not in pathlib.PurePosixPath(c["acme_webroot"]).parts and c["acme_webroot"] != "/", "Webroot ACME inválido.")
    else:
        sg.need(sg.private_ipv4(c["ip"]) and c["origin"] == f"http://{c['ip']}:{c['port']}", "Origem privada inválida.")
    sg.need(isinstance(c["links"], list) and all(isinstance(x, str) and re.fullmatch(r"[1-9][0-9]*:[a-f0-9-]{36}", x) for x in c["links"]), "Vínculo inválido.")
    sg.need(not c["admin_id"] or re.fullmatch(r"[a-f0-9-]{36}", c["admin_id"]), "Responsável inválido.")


def state_path(root):
    directory = root / ".local-setup"
    sg.need(not directory.is_symlink(), ".local-setup não pode ser link.")
    path = directory / STATE
    sg.need(not path.is_symlink(), "Estado não pode ser link.")
    return path


def save_state(root, c):
    validate(c)
    sg.atomic_write(state_path(root), json.dumps(c, ensure_ascii=False, indent=2) + "\n")


def load_state(root):
    p = state_path(root)
    if not p.exists(): return None
    c = json.loads(p.read_text(encoding="utf-8"))
    validate(c)
    return c


def prepare_env(root, c, ips):
    validate(c)
    target = root / ".env"
    sg.need(not target.is_symlink(), ".env não pode ser link.")
    old = target.read_text(encoding="utf-8") if target.exists() else ""
    current = sg.parse_env(old)
    sg.need(not current or current.get("COMPOSE_PROJECT_NAME") == c["project"], "Preserve o COMPOSE_PROJECT_NAME existente; projeto ausente exige revisão explícita.")
    changes = dict(GRAAL_SETUP_MODE="production" if c["mode"] == "online" else "homologacao",
                   NODE_ENV="production" if c["mode"] == "online" else "development",
                   DASHBOARD_IP=c["ip"], DASHBOARD_PORT=str(c["port"]), PUBLIC_ORIGIN=c["origin"],
                   COMPOSE_PROJECT_NAME=c["project"], GLPI_CONNECTION="local",
                   GLPI_API_BASE_URL=(f"http://127.0.0.1:{c['port']}" if c["mode"] == "online" else c["origin"]) + "/api/integration/v1",
                   GLPI_DIR=c["glpi_dir"], GLPI_WEB_USER=c["web_user"])
    lines, seen = [], set()
    for line in old.splitlines():
        match = re.match(r"^\s*([A-Z][A-Z0-9_]*)=", line)
        if match and match[1] in changes:
            key = match[1]
            seen.add(key)
            lines.append(line if current[key] == changes[key] else f"{key}='{changes[key]}'")
        else: lines.append(line)
    text = "\n".join(lines).rstrip() + ("\n" if lines else "")
    text += "".join(f"{k}='{v}'\n" for k, v in changes.items() if k not in seen)
    # Validate with the existing configurator in an isolated directory BEFORE writing.
    with tempfile.TemporaryDirectory(prefix="graal-env-check-") as tmp:
        stage = pathlib.Path(tmp)
        if current: sg.atomic_write(stage / ".env", text)
        args = sg.arguments(["dashboard", "--mode", c["mode"], "--glpi-local", "--project", c["project"], "--port", str(c["port"]), "--public-origin", c["origin"], "--glpi-dir", c["glpi_dir"], "--web-user", c["web_user"]] + (["--ip", c["ip"]] if c["mode"] == "local" else []))
        env = sg.configure_env(stage, args, ips)
        validated = (stage / ".env").read_text(encoding="utf-8")
    if validated != old:
        state_path(root)
        if old: sg.atomic_write(root / ".local-setup" / ("assistant-env-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".bak"), old)
        sg.atomic_write(target, validated)
    return env


def service_active(name):
    try: return sg.run_command(["systemctl", "is-active", name]).stdout.strip() == "active"
    except sg.SetupError: return False


def detect_proxy():
    active = [s for s in ("nginx", "apache2") if service_active(s)]
    sg.need(len(active) == 1, "Proxy ausente/ambíguo: precisa haver apenas Nginx ou Apache ativo no host; topologia com containers/LB exige revisão.")
    return active[0]


def proxy_text(c, tls):
    validate(c)
    host = sg.parsed_url(c["origin"]).hostname
    port = c["port"]
    webroot = c.get("acme_webroot", "/var/lib/graal-acme")
    if c["proxy"] == "nginx":
        http = f"""server {{
    listen 80;
    server_name {host};
    location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
    location / {{ {'return 301 https://' + host + '$request_uri;' if tls else 'return 503;'} }}
}}
"""
        secure = f"""server {{
    listen 443 ssl;
    server_name {host};
    ssl_certificate {c['certificate']};
    ssl_certificate_key {c['key']};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 21m;
    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_set_header Host $host;
        proxy_set_header X-Graal-Client-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }}
}}
""" if tls else ""
    else:
        http = f"""<VirtualHost *:80>
    ServerName {host}
    Alias /.well-known/acme-challenge/ {webroot}/.well-known/acme-challenge/
    <Location />
        Require all denied
    </Location>
    <Location /.well-known/acme-challenge/>
        Require all granted
    </Location>
    <Directory {webroot}/.well-known/acme-challenge>
        Require all granted
        Options -Indexes
        AllowOverride None
    </Directory>
</VirtualHost>
"""
        # HTTP vhost serves only ACME files, never proxies login over plaintext.
        secure = f"""<VirtualHost *:443>
    ServerName {host}
    SSLEngine on
    SSLCertificateFile {c['certificate']}
    SSLCertificateKeyFile {c['key']}
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    ProxyRequests Off
    ProxyPreserveHost On
    LimitRequestBody 22020096
    RequestHeader set X-Graal-Client-IP "expr=%{{CONN_REMOTE_ADDR}}"
    RequestHeader set X-Forwarded-For "expr=%{{CONN_REMOTE_ADDR}}"
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:{port}/ timeout=120
    ProxyPassReverse / http://127.0.0.1:{port}/
</VirtualHost>
""" if tls else ""
    return MARKER + "\n" + http + secure


def proxy_paths(c, etc):
    base = etc / c["proxy"]
    return base / "sites-available/graal-dashboard.conf", base / "sites-enabled/graal-dashboard.conf"


def validate_proxy(c):
    sg.run_command(["nginx", "-t"] if c["proxy"] == "nginx" else ["apache2ctl", "configtest"])


def install_proxy_text(c, text, etc=pathlib.Path("/etc")):
    target, enabled = proxy_paths(c, etc)
    sg.need(target.parent.is_dir() and enabled.parent.is_dir(), "Layout sites-available/sites-enabled não encontrado.")
    sg.need(not target.is_symlink(), "Arquivo de proxy não pode ser link.")
    old = target.read_text(encoding="utf-8") if target.exists() else None
    sg.need(old is None or old.startswith(MARKER + "\n"), "Arquivo de proxy existente não pertence ao assistente; preservado.")
    was_enabled = enabled.is_symlink()
    sg.need(not enabled.exists() or was_enabled, "Ativação de proxy não gerenciada.")
    sg.need(not was_enabled or enabled.resolve() == target.resolve(), "Link do proxy aponta para outro arquivo.")
    if old == text and was_enabled:
        validate_proxy(c)
        return
    try:
        sg.atomic_write(target, text, 0o644)
        if not was_enabled: enabled.symlink_to(target)
        validate_proxy(c)
        sg.run_command(["systemctl", "reload", c["proxy"]])
    except (sg.SetupError, OSError):
        if not was_enabled and enabled.is_symlink(): enabled.unlink()
        if old is None: target.unlink(missing_ok=True)
        else: sg.atomic_write(target, old, 0o644)
        try:
            validate_proxy(c)
            sg.run_command(["systemctl", "reload", c["proxy"]])
        except sg.SetupError:
            raise sg.SetupError("Proxy restaurado em disco, mas validação/reload de recuperação falhou; confira o serviço antes de continuar.") from None
        raise


def check_domain_conflict(c, etc=pathlib.Path("/etc")):
    target, _ = proxy_paths(c, etc)
    for directory in (etc / c["proxy"] / "sites-enabled", etc / c["proxy"] / "conf.d"):
        if not directory.exists(): continue
        for p in directory.iterdir():
            if not p.is_file() or p.resolve() == target.resolve(): continue
            text = p.read_text(encoding="utf-8")
            check_domain_text(c, text)


def check_domain_text(c, text):
    host = sg.parsed_url(c["origin"]).hostname
    text = re.sub(r"(?m)#.*$", "", text)
    pattern = r"(?:^|[;{}])\s*server_name\s+([^;]+);" if c["proxy"] == "nginx" else r"(?im)^\s*(?:ServerName|ServerAlias)\s+([^\n]+)"
    for names in re.findall(pattern, text):
        sg.need(host not in [n.lower() for n in shlex.split(names)], "Domínio já pertence a outro virtualhost; não será modificado.")


def check_loaded_domains(c):
    # Include arbitrary Nginx includes, beyond the usual Ubuntu site directories.
    if c["proxy"] != "nginx": return
    output = sg.run_command(["nginx", "-T"]).stdout
    chunks = re.split(r"(?m)^# configuration file (.+):\s*$", output)
    target, _ = proxy_paths(c, pathlib.Path("/etc"))
    sg.need(len(chunks) > 1, "Não foi possível inspecionar os arquivos efetivamente carregados pelo Nginx.")
    for n in range(1, len(chunks), 2):
        if pathlib.Path(chunks[n]).resolve() != target.resolve(): check_domain_text(c, chunks[n+1])


def certificate_policy(c, exists, etc=pathlib.Path("/etc")):
    host = sg.parsed_url(c["origin"]).hostname
    prefix = "/etc/letsencrypt/live/"
    lineage = c["certificate"].startswith(prefix) or c["key"].startswith(prefix)
    if not lineage:
        sg.need(exists and not c["email"], "Certificado externo precisa existir e ter renovação externa.")
        return False, "/var/lib/graal-acme"
    sg.need(c["certificate"] == prefix + host + "/fullchain.pem" and c["key"] == prefix + host + "/privkey.pem", "Certificado Certbot compartilhado/outro lineage exige revisão; não será alterado.")
    if not exists:
        sg.need(c["email"], "Certificado ausente: informe e-mail ACME com --reconfigurar.")
        return True, "/var/lib/graal-acme"
    record = etc / "letsencrypt/renewal" / (host + ".conf")
    sg.need(record.is_file(), "Certificado existente sem configuração de renovação Certbot verificável.")
    text = record.read_text(encoding="utf-8")
    sg.need(re.search(r"(?m)^[ \t]*authenticator[ \t]*=[ \t]*webroot[ \t]*$", text), "Renovação existente não usa webroot; revisão necessária antes de trocar virtualhost. Nenhum certificado será reconfigurado por suposição.")
    section = re.search(r"(?ms)^[ \t]*\[\[webroot_map\]\][ \t]*\n(.*?)(?=^[ \t]*\[|\Z)", text)
    mapping = re.search(r"(?m)^[ \t]*" + re.escape(host) + r"\s*=\s*([^\n]+)", section[1]) if section else None
    fallback = re.search(r"(?m)^[ \t]*webroot_path\s*=\s*([^,\n]+),?\s*$", text)
    sg.need(mapping or fallback, "Webroot de renovação do domínio não encontrado.")
    webroot = (mapping or fallback)[1].strip()
    validate(dict(c, acme_webroot=webroot))
    return True, webroot



def proxy_transaction(root, c, etc=pathlib.Path("/etc")):
    target, enabled = proxy_paths(c, etc)
    sg.need(not target.is_symlink(), "Arquivo de proxy não pode ser link.")
    old = target.read_text(encoding="utf-8") if target.exists() else None
    sg.need(old is None or old.startswith(MARKER + "\n"), "Proxy não gerenciado; preservado.")
    was_enabled = enabled.is_symlink()
    sg.need(not enabled.exists() or was_enabled, "Ativação do proxy não gerenciada.")
    sg.need(not was_enabled or enabled.resolve() == target.resolve(), "Link do proxy aponta para outro arquivo.")
    if old is not None:
        sg.atomic_write(root / ".local-setup" / ("proxy-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".bak"), old)
    try:
        configure_proxy(c)
    except (sg.SetupError, OSError):
        if not was_enabled and enabled.is_symlink(): enabled.unlink()
        if old is None: target.unlink(missing_ok=True)
        else: sg.atomic_write(target, old, 0o644)
        try:
            validate_proxy(c)
            sg.run_command(["systemctl", "reload", c["proxy"]])
        except sg.SetupError:
            raise sg.SetupError("Configuração anterior restaurada em disco, mas reload de recuperação falhou; confira o serviço. Certificados emitidos e módulos habilitados não foram removidos.") from None
        raise


def configure_proxy(c):
    sg.need(service_active(c["proxy"]), "O proxy salvo não está ativo.")
    check_domain_conflict(c)
    check_loaded_domains(c)
    validate_proxy(c)
    if c["proxy"] == "apache2":
        sg.require_tools(["a2enmod"])
        sg.run_command(["a2enmod", "proxy", "proxy_http", "headers", "ssl"])
    host = sg.parsed_url(c["origin"]).hostname
    cert, key = pathlib.Path(c["certificate"]), pathlib.Path(c["key"])
    exists = cert.is_file() and key.is_file()
    managed, webroot_value = certificate_policy(c, exists)
    c = dict(c, acme_webroot=webroot_value)
    if managed:
        sg.require_tools(["certbot"])
        sg.need(any(service_active(t) for t in ("certbot.timer", "snap.certbot.renew.timer")), "Timer de renovação Certbot não está ativo; configure-o antes de prosseguir.")
    if not exists:
        sg.need(c["email"], "Certificado ausente. Reexecute com --reconfigurar para informar certificado ou e-mail ACME.")
        sg.require_tools(["certbot"])
        webroot = pathlib.Path("/var/lib/graal-acme")
        sg.need(not webroot.is_symlink(), "Webroot ACME não pode ser link.")
        webroot.mkdir(mode=0o755, exist_ok=True)
        os.chmod(webroot, 0o755)
        install_proxy_text(c, proxy_text(c, False))
        sg.run_command(["certbot", "certonly", "--webroot", "-w", str(webroot), "--cert-name", host, "-d", host, "--email", c["email"], "--agree-tos", "--non-interactive", "--keep-until-expiring"])
        sg.need(cert.is_file() and key.is_file(), "Certbot não entregou os arquivos esperados.")
    # Cert/key syntax, hostname and chain will also be checked by the real HTTPS probe.
    install_proxy_text(c, proxy_text(c, True))
    if managed:
        install_renewal_hook(c)
        # Never silently promise renewal if no distribution/snap timer is active.
        timers = ("certbot.timer", "snap.certbot.renew.timer")
        sg.need(any(service_active(t) for t in timers), "HTTPS configurado, mas timer de renovação Certbot não está ativo. Ative o timer da instalação antes de considerar concluído.")


def install_renewal_hook(c, etc=pathlib.Path("/etc")):
    hook = etc / "letsencrypt/renewal-hooks/deploy/graal-dashboard.sh"
    contents = f"#!/bin/sh\n{MARKER}\nset -eu\n{'nginx -t' if c['proxy']=='nginx' else 'apache2ctl configtest'}\nsystemctl reload {c['proxy']}\n"
    sg.need(not hook.is_symlink(), "Hook de renovação não pode ser link.")
    sg.need(not hook.exists() or MARKER in hook.read_text().splitlines()[:2], "Hook de renovação externo preservado.")
    if not hook.exists() or hook.read_text() != contents: sg.atomic_write(hook, contents, 0o755)


@contextlib.contextmanager
def assistant_lock(root):
    directory = state_path(root).parent
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / "assistant.lock"
    try: fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError: raise sg.SetupError("Assistente em execução; confira .local-setup/assistant.lock antes de remover.") from None
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally: path.unlink(missing_ok=True)


@contextlib.contextmanager
def host_lock(path=pathlib.Path("/run/lock/graal-setup.lock")):
    import fcntl
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError: raise sg.SetupError("Outro assistente está configurando este host, inclusive de outro checkout.") from None
        try: yield
        finally: fcntl.flock(fd, fcntl.LOCK_UN)
    finally: os.close(fd)


def check_docker():
    sg.run_command(["docker", "compose", "version"])
    context = os.environ.get("DOCKER_CONTEXT") or sg.run_command(["docker", "context", "show"]).stdout.strip()
    daemon = (os.environ.get("DOCKER_HOST") if not os.environ.get("DOCKER_CONTEXT") else None) or sg.run_command(["docker", "context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).stdout.strip()
    sg.need(daemon.startswith("unix://"), "Use somente Docker local via socket Unix; nenhum proxy/env foi alterado.")


def gather(root, previous):
    path = root / ".env"
    old = sg.parse_env(path.read_text(encoding="utf-8")) if path.exists() else {}
    c = dict(previous or {})
    mode = question("Acesso: local (rede privada/VPN) ou online (HTTPS)", c.get("mode", "online" if old.get("GRAAL_SETUP_MODE") == "production" else "local"))
    sg.need(mode in ("local", "online"), "Escolha local ou online.")
    c.update(mode=mode, port=int(question("Porta interna do dashboard", str(c.get("port", old.get("DASHBOARD_PORT", "8080"))))))
    c["project"] = question("Projeto Compose EXISTENTE (preservar banco/volumes)", old.get("COMPOSE_PROJECT_NAME", c.get("project", "graal-estoque")))
    c["glpi_dir"] = question("Diretório GLPI", old.get("GLPI_DIR", c.get("glpi_dir", "/var/www/glpi")))
    c["web_user"] = question("Usuário PHP do GLPI", old.get("GLPI_WEB_USER", c.get("web_user", "www-data")))
    if mode == "local":
        ips = sg.discover_ips()
        c["ip"] = question("IP privado do servidor", c.get("ip") if sg.private_ipv4(c.get("ip")) else old.get("DASHBOARD_IP") if sg.private_ipv4(old.get("DASHBOARD_IP")) else ips[0] if len(ips) == 1 else "")
        c.update(origin=f"http://{c['ip']}:{c['port']}", proxy="", certificate="", key="", email="")
    else:
        c["proxy"] = detect_proxy()
        c["origin"] = "https://" + question("Domínio exclusivo do dashboard, sem https://", sg.parsed_url(c.get("origin") or old.get("PUBLIC_ORIGIN") or "https://estoque.example.org").hostname if (c.get("origin") or old.get("PUBLIC_ORIGIN", "")).startswith("https://") else "")
        host = sg.parsed_url(c["origin"]).hostname
        c["ip"] = "127.0.0.1"
        c["certificate"] = question("Arquivo do certificado (padrão Let's Encrypt)", c.get("certificate") or f"/etc/letsencrypt/live/{host}/fullchain.pem")
        c["key"] = question("Arquivo da chave TLS", c.get("key") or f"/etc/letsencrypt/live/{host}/privkey.pem")
        c["email"] = c.get("email", "")
        if not pathlib.Path(c["certificate"]).is_file():
            sg.need(c["certificate"] == f"/etc/letsencrypt/live/{host}/fullchain.pem" and c["key"] == f"/etc/letsencrypt/live/{host}/privkey.pem", "Certificado personalizado ausente.")
            c["email"] = question("E-mail para emissão/renovação Let's Encrypt; domínio deve apontar aqui e porta80 estar liberada", c["email"])
            sg.need(c["email"], "E-mail necessário para emitir certificado.")
    c.setdefault("admin_id", "")
    c.setdefault("links", [])
    validate(c)
    print("Resumo:", c["origin"], "| projeto:", c["project"], "| GLPI:", c["glpi_dir"], "| proxy:", c["proxy"] or "nenhum")
    print("Serão feitos backup/revisão do .env, build/migrações versionadas, serviços e atualização do plugin. Não altera senhas ou vínculo por suposição.")
    sg.need(question("Aplicar e salvar estas escolhas? sim/não", "não") == "sim", "Cancelado; nenhuma configuração foi gravada.")
    return c


def choose_admin(rows):
    sg.need(rows, "Nenhum administrador apto; conclua o primeiro acesso.")
    for n, row in enumerate(rows, 1): print(f"{n}. {row['username']}")
    value = question("Número do administrador responsável")
    sg.need(value.isdigit() and 1 <= int(value) <= len(rows), "Escolha de administrador inválida.")
    return rows[int(value) - 1]["id"]


def finish_integration(root, env, c):
    out = sg.run_command(sg.compose_command(root, env, ["run", "--rm", "-T", "--no-deps", "api", "node", "scripts/provision-integration.cjs"]), input_text=json.dumps(dict(operation="list-admins")), cwd=root)
    result = json.loads(out.stdout)
    if result.get("requiresFirstAccess"):
        print("Conclua o primeiro login e troca de senha em", env["PUBLIC_ORIGIN"], "e execute o MESMO comando novamente. Integração ainda não provisionada.")
        return False
    rows = result["items"]
    if not c["admin_id"]: c["admin_id"] = choose_admin(rows)
    sg.need(any(x["id"] == c["admin_id"] for x in rows), "Responsável salvo não está apto. Use --reconfigurar; nenhuma credencial alterada.")
    if not c["links"]:
        print("O vínculo abaixo é para o administrador selecionado. Outros funcionários continuam com vínculos individuais explícitos.")
        glpi_id = question("ID numérico do MESMO usuário no GLPI (na URL da ficha do usuário)")
        sg.need(re.fullmatch(r"[1-9][0-9]*", glpi_id), "ID GLPI inválido.")
        c["links"] = [glpi_id + ":" + c["admin_id"]]
    save_state(root, c)
    args = sg.arguments(["dashboard", "--admin-id", c["admin_id"]] + [v for link in c["links"] for v in ("--link", link)])
    token = sg.provision(root, env, args)
    sg.configure_local(root, env, token)
    return True


def check_https(c):
    try:
        with urllib.request.urlopen(c["origin"] + "/api/health", timeout=15) as response:
            sg.need(response.status == 200 and response.geturl() == c["origin"] + "/api/health", "Health HTTPS não confirmou origem/status.")
            try: body = json.loads(response.read(4096))
            except (ValueError, UnicodeError): raise sg.SetupError("Health HTTPS retornou resposta inválida; não foi confirmado o dashboard.") from None
            sg.need(isinstance(body, dict) and body.get("status") == "ok", "Health HTTPS não confirmou o dashboard.")
    except (urllib.error.URLError, OSError):
        raise sg.SetupError("Serviços configurados, mas HTTPS/health não confirmado. Confira DNS, certificado e NSG; não repita movimentações.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reconfigurar", action="store_true", help="Rever escolhas e responsável, com backup do .env")
    args = parser.parse_args(argv)
    sg.need(sys.platform.startswith("linux") and os.geteuid() == 0, "Execute no Ubuntu com sudo bash scripts/assistente-graal.sh.")
    os.umask(0o077)
    sg.require_tools(["ip", "docker", "bash", "php"])
    check_docker()
    root = sg.ROOT
    with host_lock(), assistant_lock(root):
        run(root, args)


def run(root, args):
    # Dedicated lock also prevents two assistants from mutating a host proxy together.
    with sg.setup_lock(root):
        c = load_state(root)
        if not c or args.reconfigurar:
            c = gather(root, c)
            if args.reconfigurar: c.update(admin_id="", links=[])
        sg.need((pathlib.Path(c["glpi_dir"]) / "bin/console").is_file(), "GLPI não encontrado; reveja --reconfigurar.")
        if c["mode"] == "online":
            sg.need(detect_proxy() == c["proxy"], "Proxy ativo difere do salvo.")
            check_domain_conflict(c)
            check_loaded_domains(c)
            certificate_policy(c, pathlib.Path(c["certificate"]).is_file() and pathlib.Path(c["key"]).is_file())
        env = prepare_env(root, c, sg.discover_ips())
        save_state(root, c)
        if c["mode"] == "online": proxy_transaction(root, c)
    # Existing configurator owns its own lock and checks Docker context before mutations.
    sg.main(["dashboard", "--mode", c["mode"], "--glpi-local", "--skip-glpi"])
    with sg.setup_lock(root):
        if c["mode"] == "online": check_https(c)
        if env["INTEGRATION_ENABLED"] == "false":
            print("Integração explicitamente desabilitada; valor preservado. Nenhum plugin/credencial alterado.")
            return
        if not finish_integration(root, env, c): return
    print("Configuração concluída. Acesse", c["origin"], "; homologue busca/leitura e direitos do perfil GLPI antes de movimentar estoque.")


if __name__ == "__main__":
    try: main()
    except (sg.SetupError, ValueError, KeyError, TypeError, OSError, EOFError, KeyboardInterrupt) as exc:
        print("ERRO:", str(exc) if isinstance(exc, sg.SetupError) else "Configuração interrompida/inválida; nenhum segredo é exibido. Corrija e reexecute o mesmo comando.", file=sys.stderr)
        sys.exit(1)
