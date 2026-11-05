import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"scripts"))
import setup_graal as sg
import assistente_graal as ag

class AssistantTests(unittest.TestCase):
    def setUp(self):
        tty=patch.object(sys.stdin,"isatty",return_value=True);tty.start();self.addCleanup(tty.stop)
        # Windows host lacks symlink privilege; simulate only the symlink primitive.
        # Files, backup/restore and proxy-validation commands remain exercised.
        if sys.platform == "win32":
            links={}; original_resolve=pathlib.Path.resolve
            def link(path,target,**kw):
                if path.exists():raise FileExistsError(str(path))
                links[str(path)]=pathlib.Path(target);path.write_text("fixture symlink")
            def is_link(path):return str(path) in links and path.exists()
            def resolve(path,*a,**kw):return original_resolve(links[str(path)] if is_link(path) else path,*a,**kw)
            for name,value in [("symlink_to",link),("is_symlink",is_link),("resolve",resolve)]:
                p=patch.object(pathlib.Path,name,value);p.start();self.addCleanup(p.stop)

    def config(self):
        return dict(mode="online",origin="https://estoque.example.org",ip="127.0.0.1",port=8080,project="graal-existente",glpi_dir="/var/www/glpi",web_user="www-data",proxy="nginx",certificate="/etc/letsencrypt/live/estoque.example.org/fullchain.pem",key="/etc/letsencrypt/live/estoque.example.org/privkey.pem",email="",admin_id="",links=[])
    def test_transition_preserves_credentials_and_project_with_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            old=sg.configure_env(root,sg.arguments(["dashboard","--glpi-local","--ip","10.0.0.2","--project","graal-existente"]),["10.0.0.2"])
            before=(root/".env").read_bytes()
            env=ag.prepare_env(root,self.config(),["10.0.0.2"])
            for k in ["POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET","COMPOSE_PROJECT_NAME","GLPI_INSTANCE_ID"]: self.assertEqual(env[k],old[k])
            self.assertEqual(env["PUBLIC_ORIGIN"],"https://estoque.example.org")
            backups=list((root/".local-setup").glob("assistant-env-*.bak"))
            self.assertEqual(len(backups),1); self.assertEqual(backups[0].read_bytes(),before)
            current=(root/".env").read_bytes();ag.prepare_env(root,self.config(),["10.0.0.2"])
            self.assertEqual(current,(root/".env").read_bytes())
    def test_invalid_config_never_changes_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/".env").write_text("CUSTOM=preserve\n")
            for changes in [dict(origin="https://bad;host"),dict(project="different"),dict(port=80)]:
                with self.assertRaises(sg.SetupError):ag.prepare_env(root,dict(self.config(),**changes),["10.0.0.2"])
                self.assertEqual((root/".env").read_text(),"CUSTOM=preserve\n")
    def test_explicit_false_is_not_enabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            sg.configure_env(root,sg.arguments(["dashboard","--glpi-local","--ip","10.0.0.2","--project","graal-existente"]),["10.0.0.2"])
            p=root/".env";p.write_text(p.read_text().replace("INTEGRATION_ENABLED='true'","INTEGRATION_ENABLED='false'"))
            self.assertEqual(ag.prepare_env(root,self.config(),["10.0.0.2"])["INTEGRATION_ENABLED"],"false")
    def test_templates_keep_identity_and_upload_limit(self):
        c=self.config()
        ng=ag.proxy_text(c,True); self.assertIn("proxy_set_header X-Graal-Client-IP $remote_addr;",ng)
        self.assertIn("127.0.0.1:8080",ng);self.assertIn("client_max_body_size 21m",ng)
        ap=ag.proxy_text(dict(c,proxy="apache2"),True)
        self.assertIn('RequestHeader set X-Graal-Client-IP "expr=%{CONN_REMOTE_ADDR}"',ap)
        self.assertIn("ProxyPreserveHost On",ap);self.assertIn("LimitRequestBody 22020096",ap)
        self.assertNotIn("ProxyPass / ",ag.proxy_text(c,False))
    def test_proxy_rollback_only_owned_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);base=etc/"nginx";(base/"sites-available").mkdir(parents=True);(base/"sites-enabled").mkdir()
            glpi=base/"sites-available/glpi";glpi.write_text("preserve GLPI")
            def fail(cmd,**kw):
                if cmd==["nginx","-t"]:raise sg.SetupError("bad config")
            with patch.object(ag.sg,"run_command",side_effect=fail):
                with self.assertRaises(sg.SetupError):ag.install_proxy_text(self.config(),ag.proxy_text(self.config(),True),etc)
            self.assertEqual(glpi.read_text(),"preserve GLPI")
            self.assertFalse((base/"sites-available/graal-dashboard.conf").exists())
            self.assertFalse((base/"sites-enabled/graal-dashboard.conf").is_symlink())
    def test_refuse_foreign_proxy_and_ambiguous_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=pathlib.Path(tmp)/"nginx/sites-available";base.mkdir(parents=True)
            p=base/"graal-dashboard.conf";p.write_text("foreign")
            with self.assertRaises(sg.SetupError):ag.install_proxy_text(self.config(),"new",pathlib.Path(tmp))
            self.assertEqual(p.read_text(),"foreign")
        with patch.object(ag,"service_active",return_value=True):
            with self.assertRaises(sg.SetupError):ag.detect_proxy()
    def test_saved_state_does_not_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=self.config();ag.save_state(root,c)
            with patch("builtins.input",side_effect=AssertionError("unexpected prompt")):
                self.assertEqual(ag.load_state(root),c)
    def test_admin_selection_uses_number_not_guessed_identity(self):
        rows=[dict(id="uuid-1",username="ana"),dict(id="uuid-2",username="bia")]
        with patch("builtins.input",return_value="2"): self.assertEqual(ag.choose_admin(rows),"uuid-2")
        with patch("builtins.input",return_value="0"):
            with self.assertRaises(sg.SetupError):ag.choose_admin(rows)

    def test_renewal_hook_is_repeatable_and_refuses_foreign(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=self.config()
            ag.install_renewal_hook(c,root)
            hook=root/"letsencrypt/renewal-hooks/deploy/graal-dashboard.sh"
            first=hook.read_bytes();self.assertTrue(first.startswith(b"#!/bin/sh\n"))
            ag.install_renewal_hook(c,root);self.assertEqual(first,hook.read_bytes())
            hook.write_text("#!/bin/sh\nforeign\n")
            with self.assertRaises(sg.SetupError):ag.install_renewal_hook(c,root)
    def test_https_rejects_html_or_redirect_to_another_origin(self):
        from unittest.mock import MagicMock
        c=self.config()
        response=MagicMock();response.__enter__.return_value=response
        response.status=200;response.geturl.return_value=c["origin"]+"/api/health"
        response.read.return_value=b"<html>GLPI login</html>"
        with patch.object(ag.urllib.request,"urlopen",return_value=response):
            with self.assertRaises(sg.SetupError):ag.check_https(c)
        response.read.return_value=b'{"status":"ok"}';response.geturl.return_value="https://another.example.org/api/health"
        with patch.object(ag.urllib.request,"urlopen",return_value=response):
            with self.assertRaises(sg.SetupError):ag.check_https(c)
    def test_first_access_does_not_provision_or_install(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=self.config();env={"COMPOSE_PROJECT_NAME":"graal-existente","PUBLIC_ORIGIN":c["origin"]}
            output=subprocess.CompletedProcess([],0,'{"items":[],"requiresFirstAccess":true}')
            with patch.object(ag.sg,"run_command",return_value=output),patch.object(ag.sg,"provision") as provision,patch.object(ag.sg,"configure_local") as install:
                self.assertFalse(ag.finish_integration(root,env,c));provision.assert_not_called();install.assert_not_called()
    def test_repeated_integration_uses_saved_identity_without_input(self):
        import subprocess
        uid="11111111-1111-4111-8111-111111111111"
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=dict(self.config(),admin_id=uid,links=["8:"+uid]);env={"COMPOSE_PROJECT_NAME":"graal-existente","PUBLIC_ORIGIN":c["origin"]}
            output=subprocess.CompletedProcess([],0,json.dumps(dict(items=[dict(id=uid,username="synthetic")])))
            with patch.object(ag.sg,"run_command",return_value=output),patch.object(ag.sg,"provision",return_value="synthetic-token") as provision,patch.object(ag.sg,"configure_local") as install,patch("builtins.input",side_effect=AssertionError("unexpected prompt")):
                self.assertTrue(ag.finish_integration(root,env,c));self.assertEqual(provision.call_args.args[2].link,["8:"+uid]);install.assert_called_once()
    def test_saved_proxy_failure_restores_previous_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);base=etc/"nginx";(base/"sites-available").mkdir(parents=True);(base/"sites-enabled").mkdir()
            target=base/"sites-available/graal-dashboard.conf";old=ag.MARKER+"\nold config\n";target.write_text(old)
            enabled=base/"sites-enabled/graal-dashboard.conf";enabled.symlink_to(target)
            calls=[]
            def fail_once(cmd,**kw):
                calls.append(cmd)
                if len(calls)==1:raise sg.SetupError("invalid")
            with patch.object(ag.sg,"run_command",side_effect=fail_once):
                with self.assertRaises(sg.SetupError):ag.install_proxy_text(self.config(),ag.proxy_text(self.config(),True),etc)
            self.assertEqual(target.read_text(),old);self.assertTrue(enabled.is_symlink())
    def test_domain_conflict_preserves_other_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);folder=etc/"nginx/sites-enabled";folder.mkdir(parents=True)
            (folder/"glpi").write_text("server {\n server_name estoque.example.org;\n}")
            with self.assertRaises(sg.SetupError):ag.check_domain_conflict(self.config(),etc)

    def test_remote_docker_rejected_before_any_host_change(self):
        import subprocess
        def fake(cmd,**kw):
            out="default" if cmd==["docker","context","show"] else "tcp://remote.example.org:2376"
            return subprocess.CompletedProcess(cmd,0,out)
        with patch.dict(ag.os.environ,{},clear=True),patch.object(ag.sg,"run_command",side_effect=fake):
            with self.assertRaises(sg.SetupError):ag.check_docker()
    def test_assistant_lock_excludes_entire_second_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            with ag.assistant_lock(root):
                with self.assertRaises(sg.SetupError):
                    with ag.assistant_lock(root):pass
            self.assertFalse((root/".local-setup/assistant.lock").exists())
    def test_certificate_failure_restores_whole_previous_proxy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);etc=root/"etc";base=etc/"nginx";(base/"sites-available").mkdir(parents=True);(base/"sites-enabled").mkdir()
            target=base/"sites-available/graal-dashboard.conf";old=ag.MARKER+"\nold TLS\n";target.write_text(old)
            (base/"sites-enabled/graal-dashboard.conf").symlink_to(target)
            def failed(c,**kw):
                ag.install_proxy_text(c,ag.proxy_text(c,False),etc)
                raise sg.SetupError("ACME failure")
            with patch.object(ag.sg,"run_command"),patch.object(ag,"configure_proxy",side_effect=failed):
                with self.assertRaises(sg.SetupError):ag.proxy_transaction(root,self.config(),etc)
            self.assertEqual(target.read_text(),old)
            self.assertTrue(list((root/".local-setup").glob("proxy-*.bak")))
    def test_ignore_private_build_context(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        self.assertIn(".local-setup",(root/".dockerignore").read_text())

    def test_one_line_nginx_domain_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);folder=etc/"nginx/sites-enabled";folder.mkdir(parents=True)
            (folder/"glpi").write_text('server { listen 80; server_name "estoque.example.org"; }')
            with self.assertRaises(sg.SetupError):ag.check_domain_conflict(self.config(),etc)
    def test_existing_certbot_webroot_is_preserved_independent_of_email(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);folder=etc/"letsencrypt/renewal";folder.mkdir(parents=True)
            (folder/"estoque.example.org.conf").write_text("[renewalparams]\nauthenticator = webroot\n[[webroot_map]]\nestoque.example.org = /var/www/existing-public\n")
            c=self.config();managed,webroot=ag.certificate_policy(c,True,etc)
            self.assertTrue(managed);self.assertEqual(webroot,"/var/www/existing-public")
            ap=ag.proxy_text(dict(c,proxy="apache2",acme_webroot=webroot),True)
            self.assertIn('Alias /.well-known/acme-challenge/ /var/www/existing-public/.well-known/acme-challenge/',ap)
            self.assertNotIn('DocumentRoot /var/www/existing-public',ap)
            self.assertIn('Require all denied',ap)
    def test_unsupported_existing_renewal_is_rejected_before_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            etc=pathlib.Path(tmp);folder=etc/"letsencrypt/renewal";folder.mkdir(parents=True)
            (folder/"estoque.example.org.conf").write_text("[renewalparams]\nauthenticator = standalone\n")
            with self.assertRaises(sg.SetupError):ag.certificate_policy(self.config(),True,etc)
    def test_host_lock_prevents_other_checkouts(self):
        from unittest.mock import MagicMock
        fake=MagicMock();fake.LOCK_EX=2;fake.LOCK_NB=4;fake.LOCK_UN=8
        with tempfile.TemporaryDirectory() as tmp:
            lock=pathlib.Path(tmp)/"host.lock"
            with patch.dict(sys.modules,{"fcntl":fake}):
                with ag.host_lock(lock):
                    fake.flock.assert_called_with(unittest.mock.ANY,6)
                    fake.flock.side_effect=BlockingIOError("locked")
                    with self.assertRaises(sg.SetupError):
                        with ag.host_lock(lock):pass
                    fake.flock.side_effect=None
            self.assertTrue(lock.exists())

    def test_loaded_nginx_include_conflict_is_detected(self):
        import subprocess
        output="# configuration file /etc/nginx/nginx.conf:\nhttp { include /opt/custom.conf; }\n# configuration file /opt/custom.conf:\nserver {server_name estoque.example.org;}\n"
        with patch.object(ag.sg,"run_command",return_value=subprocess.CompletedProcess([],0,output)):
            with self.assertRaises(sg.SetupError):ag.check_loaded_domains(self.config())
    def test_question_without_terminal_fails_instead_of_guessing(self):
        with patch.object(sys.stdin,"isatty",return_value=False):
            with self.assertRaises(sg.SetupError):ag.question("identity")
    def test_full_saved_private_run_is_repeatable_without_questions(self):
        import argparse
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=dict(self.config(),mode="local",origin="http://10.0.0.2:8080",ip="10.0.0.2")
            ag.save_state(root,c)
            with patch.object(pathlib.Path,"is_file",return_value=True),patch.object(ag.sg,"discover_ips",return_value=["10.0.0.2"]),patch.object(ag.sg,"main") as start,patch.object(ag,"finish_integration",return_value=True) as integrate,patch("builtins.input",side_effect=AssertionError("unexpected question")):
                ag.run(root,argparse.Namespace(reconfigurar=False));before=(root/".env").read_bytes()
                ag.run(root,argparse.Namespace(reconfigurar=False));self.assertEqual(before,(root/".env").read_bytes())
                self.assertEqual(start.call_count,2);self.assertEqual(integrate.call_count,2)

    def test_no_lets_encrypt_configures_private_http_even_with_saved_online_mode(self):
        import argparse
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            ag.save_state(root, self.config())
            with (
                patch.object(pathlib.Path, "is_file", return_value=True),
                patch.object(sg, "discover_ips", return_value=["10.0.0.2"]),
                patch.object(sg, "main") as start,
                patch.object(ag, "finish_integration", return_value=True),
                patch.object(ag, "detect_proxy", side_effect=AssertionError("proxy must be skipped")),
                patch("builtins.input", side_effect=["4444", "", "", "", "", "sim"]),
            ):
                ag.run(root, argparse.Namespace(reconfigurar=False, sem_lets_encrypt=True))

            self.assertEqual(ag.load_state(root)["origin"], "http://10.0.0.2:4444")
            env = sg.parse_env((root / ".env").read_text(encoding="utf-8"))
            self.assertEqual(env["GLPI_API_BASE_URL"], "http://10.0.0.2:4444/api/integration/v1")
            start.assert_called_once_with(["dashboard", "--mode", "local", "--glpi-local", "--skip-glpi"])

    def test_diagnose_does_not_start_docker_provision_or_rewrite_env(self):
        import argparse
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);c=self.config();ag.save_state(root,c)
            envfile=root/".env";envfile.write_text("INTEGRATION_TOKEN_FILE=.local-setup/integration-token\n")
            (root/".local-setup/integration-token").write_text("synthetic-token")
            before=envfile.read_bytes()
            with patch.object(ag.sg,"configure_local") as local,patch.object(ag.sg,"main") as start,patch.object(ag.sg,"provision") as provision,patch.object(ag,"prepare_env") as prepare:
                ag.run(root,argparse.Namespace(diagnosticar=True,reconfigurar=False))
                start.assert_not_called();provision.assert_not_called();prepare.assert_not_called()
                self.assertTrue(local.call_args.kwargs["diagnose"]);self.assertEqual(envfile.read_bytes(),before)

    def test_reconcile_preserves_plugin_identity_and_backs_up_private_files(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/".local-setup").mkdir()
            env={"GLPI_INSTANCE_ID":"new","INTEGRATION_TOKEN_FILE":".local-setup/integration-token","COMPOSE_PROJECT_NAME":"graal-existente","PUBLIC_ORIGIN":"http://10.0.0.2:8080","GLPI_CONNECTION":"local"}
            (root/".env").write_text("GLPI_INSTANCE_ID='new'\nCUSTOM=preserve\n")
            token=root/".local-setup/integration-token";token.write_text("11111111-1111-4111-8111-111111111111."+"a"*64+"\n")
            identity=dict(ok=True,instanceId="historical",token="22222222-2222-4222-8222-222222222222."+"b"*64,uncertain=False,pending=False,active=False)
            reply=subprocess.CompletedProcess([],0,json.dumps(dict(token="22222222-2222-4222-8222-222222222222."+"b"*64,instanceId="historical",mode="reused")))
            with patch.object(ag.sg,"configure_local",return_value=identity) as inspect,patch.object(ag.sg,"run_command",return_value=reply):
                result=ag.reconcile_local(root,env,dict(admin_id="admin",links=[]))
            self.assertEqual(result["GLPI_INSTANCE_ID"],"historical");self.assertEqual(token.read_text(),"22222222-2222-4222-8222-222222222222."+"b"*64+"\n")
            self.assertIn("CUSTOM=preserve",(root/".env").read_text());self.assertTrue(list((root/".local-setup").glob("reconcile-*/env.bak")))
            self.assertTrue(inspect.call_args.kwargs["inspect_connection"])

if __name__=="__main__":unittest.main()
