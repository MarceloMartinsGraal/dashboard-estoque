"""Testes de configuraÃ§Ã£o; nenhum Docker/SSH/servidor real Ã© acessado."""
import importlib.util, pathlib, tempfile, unittest, json, io, zipfile
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("setup_graal", ROOT/"scripts/setup_graal.py")
sg = importlib.util.module_from_spec(spec)
if spec.loader: spec.loader.exec_module(sg)

class SetupTests(unittest.TestCase):
    def test_env_not_executed_and_quotes_preserved(self):
        env=sg.parse_env("A='texto com espaco'\nB=\"outro\"\nX=$(touch /tmp/nao-executar)\n")
        self.assertEqual(env["X"], "$(touch /tmp/nao-executar)")
        self.assertEqual(env["A"],"texto com espaco")
        with self.assertRaises(sg.SetupError): sg.parse_env("A=1\nA=2\n")
    def test_private_ipv4(self):
        for ip in ["10.0.0.2","172.16.0.2","192.168.1.50"]: self.assertTrue(sg.private_ipv4(ip))
        for ip in ["127.0.0.1","8.8.8.8","169.254.169.254","172.32.0.1","::1","010.0.0.1"]: self.assertFalse(sg.private_ipv4(ip))
    def test_ip_selection(self):
        self.assertEqual(sg.choose_ip(["172.17.0.2","192.168.1.5"],"192.168.1.5"),"192.168.1.5")
        with self.assertRaises(sg.SetupError): sg.choose_ip(["192.168.1.2","10.2.0.2"],None)
        with self.assertRaises(sg.SetupError): sg.choose_ip(["192.168.1.2"],"10.0.0.99")
    def test_new_env_and_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            args=sg.arguments(["dashboard","--configure-only","--ip","192.168.1.5"])
            env=sg.configure_env(root,args,["192.168.1.5"])
            self.assertEqual(env["PUBLIC_ORIGIN"],"http://192.168.1.5:8080")
            self.assertEqual(env["INTEGRATION_ENABLED"],"true")
            old=(root/".env").read_bytes()
            self.assertEqual(sg.configure_env(root,args,["192.168.1.5"]),env)
            self.assertEqual((root/".env").read_bytes(),old)
            for key in ["POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET"]: self.assertGreaterEqual(len(env[key]),64)
            self.assertEqual(len({env[k] for k in ["POSTGRES_PASSWORD","DB_APP_PASSWORD","SESSION_SECRET"]}),3)
    def test_existing_unknown_env_preserved_and_no_silent_rebind(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);args=sg.arguments(["dashboard","--configure-only","--ip","192.168.1.5"])
            sg.configure_env(root,args,["192.168.1.5"])
            with (root/".env").open("a") as f:f.write("# manter\nCUSTOM=value\n")
            sg.configure_env(root,args,["192.168.1.5"])
            self.assertIn("# manter\nCUSTOM=value",(root/".env").read_text())
            changed=sg.arguments(["dashboard","--configure-only","--ip","192.168.1.6"])
            with self.assertRaises(sg.SetupError):sg.configure_env(root,changed,["192.168.1.6"])
    def test_refuse_foreign_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/".env").write_text("POSTGRES_PASSWORD=nao_trocar\n")
            with self.assertRaises(sg.SetupError):sg.configure_env(root,sg.arguments(["dashboard","--configure-only"]),["192.168.1.5"])
            self.assertEqual((root/".env").read_text(),"POSTGRES_PASSWORD=nao_trocar\n")
    def test_payload_allowlist(self):
        env={"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"glpi-teste",
             "POSTGRES_PASSWORD":"NUNCA_ENVIAR","SESSION_SECRET":"NUNCA_ENVIAR"}
        payload=sg.make_payload(env,"1"*8+"-"+"1"*4+"-"+"1"*4+"-"+"1"*4+"-"+"1"*12+"."+"a"*64)
        self.assertNotIn("NUNCA_ENVIAR",json.dumps(payload))
        self.assertEqual(payload["base_url"],"http://192.168.1.5:8080/api/integration/v1")
        self.assertTrue(payload["private_http"])
    def test_ssh_command_no_secret_no_disabled_host_verification(self):
        env={"GLPI_SSH_HOST":"192.168.1.106","GLPI_SSH_USER":"admin","GLPI_SSH_PORT":"22","GLPI_DIR":"/var/www/glpi","GLPI_WEB_USER":"www-data"}
        cmd=sg.ssh_command(env)
        self.assertIn("StrictHostKeyChecking=yes",cmd)
        self.assertIn("admin@192.168.1.106",cmd)
        with self.assertRaises(sg.SetupError):sg.ssh_command(dict(env,GLPI_SSH_HOST="host;touch /tmp/x"))
    def test_compose_explicit_project_and_file(self):
        env={"COMPOSE_PROJECT_NAME":"graal-homologacao"}
        cmd=sg.compose_command(ROOT,env,["ps"])
        self.assertIn("compose.homologacao.yaml", " ".join(cmd))
        self.assertIn("--env-file",cmd);self.assertIn("-p",cmd)
    def test_validate_package_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/"bad.zip"
            with zipfile.ZipFile(path,"w") as z:z.writestr("../escape","bad")
            with self.assertRaises(sg.SetupError):sg.validate_package(path)
    def test_runtime_failure_does_not_print_secret(self):
        with patch.object(sg.subprocess,"run",side_effect=sg.subprocess.CalledProcessError(1,["mock"],stderr="token-secreto")):
            with self.assertRaises(sg.SetupError) as c:sg.run_command(["ssh","host"])
            self.assertNotIn("token-secreto",str(c.exception))
    def test_glpi_payload_validation(self):
        p=sg.make_payload({"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"teste"},"11111111-1111-4111-8111-111111111111."+"a"*64)
        sg.validate_payload(p)
        with self.assertRaises(sg.SetupError):sg.validate_payload(dict(p,base_url="http://8.8.8.8/api/integration/v1"))
        with self.assertRaises(sg.SetupError):sg.validate_payload(dict(p,unexpected="x"))

    def test_ssh_sends_only_allowlisted_payload_and_uses_second_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/"scripts").mkdir();(root/"dist").mkdir()
            for n in ("configurar-glpi.sh","setup_graal.py","package-glpi-plugin.py"):(root/"scripts"/n).write_text("fixture")
            plugin=root/"glpi-plugin/estoquegraal";plugin.mkdir(parents=True)
            (plugin/"setup.php").write_text("define('PLUGIN_ESTOQUEGRAAL_VERSION','0.1.8');")
            package=root/"dist/estoquegraal-0.1.8.zip"
            with zipfile.ZipFile(package,"w") as z:
                for n in ("setup.php","hook.php","tools/configure-cli.php","public/js/app.js","public/css/plugin.css","public/pics/logo.svg"):z.writestr("estoquegraal/"+n,"fixture")
            env={"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"teste","GLPI_SSH_HOST":"192.168.1.106","GLPI_SSH_USER":"admin","GLPI_SSH_PORT":"22","GLPI_DIR":"/var/www/glpi","GLPI_WEB_USER":"www-data","POSTGRES_PASSWORD":"NAO_ENVIAR"}
            token="11111111-1111-4111-8111-111111111111."+"a"*64;calls=[]
            def fake(cmd,**kw):
                calls.append((cmd,kw))
                if cmd[0]=="ssh" and "mktemp" in cmd[-1]:return sg.subprocess.CompletedProcess(cmd,0,"/tmp/estoque-graal.ABCD1234\n","")
                if cmd[0]=="ssh" and kw.get("input_text"):return sg.subprocess.CompletedProcess(cmd,0,'{"ok":true,"backup":"/var/backups/estoque-graal/test"}',"")
                return sg.subprocess.CompletedProcess(cmd,0,"","")
            with patch.object(sg,"require_tools"),patch.object(sg,"run_command",side_effect=fake):sg.configure_remote(root,env,token)
            remote=[(c,k) for c,k in calls if k.get("input_text")]
            self.assertEqual(len(remote),1)
            command,kwargs=remote[0]
            self.assertIn("configurar-glpi.sh",command[-1])
            self.assertNotIn(token," ".join(str(x) for c,k in calls for x in c))
            self.assertNotIn("NAO_ENVIAR",kwargs["input_text"])
            self.assertEqual(json.loads(kwargs["input_text"])["token"],token)
    def test_ssh_failure_cleans_stage_without_retrying_install(self):
        env={"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"teste","GLPI_SSH_HOST":"host","GLPI_SSH_USER":"admin","GLPI_DIR":"/var/www/glpi","GLPI_WEB_USER":"www-data"}
        calls=[]
        def fake(cmd,**kw):
            calls.append(cmd)
            if "mktemp" in cmd[-1]:return sg.subprocess.CompletedProcess(cmd,0,"/tmp/estoque-graal.ABCD\n","")
            if cmd[0]==sg.sys.executable:raise sg.SetupError("falha pacote")
            return sg.subprocess.CompletedProcess(cmd,0,"","")
        with patch.object(sg,"require_tools"),patch.object(sg,"run_command",side_effect=fake):
            with self.assertRaises(sg.SetupError):sg.configure_remote(ROOT,env,"unused")
        self.assertTrue(any("rm -rf -- /tmp/estoque-graal.ABCD" in c[-1] for c in calls))
    def test_configure_only_does_not_call_docker_or_ssh(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(sg.sys,"platform","linux"),patch.object(sg,"ROOT",pathlib.Path(tmp)),patch.object(sg,"require_tools"),patch.object(sg,"discover_ips",return_value=["192.168.1.5"]),patch.object(sg,"run_command") as run:
                sg.main(["dashboard","--configure-only"]);run.assert_not_called()
    def test_env_lock_refuses_parallel_setup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            with sg.setup_lock(root):
                with self.assertRaises(sg.SetupError):
                    with sg.setup_lock(root):pass
            self.assertFalse((root/".setup-graal.lock").exists())
    def test_private_payload_rejects_production_exception(self):
        payload=sg.make_payload({"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"teste"},"11111111-1111-4111-8111-111111111111."+"a"*64)
        with self.assertRaises(sg.SetupError):sg.validate_payload(dict(payload,deployment_mode="production"))

    def test_compose_env_overrides_conflicting_shell_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/".env").write_text("DASHBOARD_IP='192.168.1.5'\nDB_APP_PASSWORD='"+("a"*64)+"'\n")
            cmd=sg.compose_command(root,{"COMPOSE_PROJECT_NAME":"graal-homologacao"},["config","--quiet"])
            with patch.dict(sg.os.environ,{"DASHBOARD_IP":"0.0.0.0","DB_APP_PASSWORD":"errada"}),patch.object(sg.subprocess,"run",return_value=sg.subprocess.CompletedProcess(cmd,0,"","")) as run:
                sg.run_command(cmd)
            self.assertEqual(run.call_args.kwargs["env"]["DASHBOARD_IP"],"192.168.1.5")
            self.assertEqual(run.call_args.kwargs["env"]["DB_APP_PASSWORD"],"a"*64)
    def test_existing_inactive_plugin_can_be_configured(self):
        import types
        with tempfile.TemporaryDirectory() as tmp:
            base=pathlib.Path(tmp);root=base/"glpi";(root/"bin").mkdir(parents=True);(root/"vendor").mkdir()
            (root/"bin/console").write_text("fixture");(root/"vendor/autoload.php").write_text("fixture")
            old=root/"plugins/estoquegraal";old.mkdir(parents=True);(old/"old.txt").write_text("preservado")
            package=base/"plugin.zip"
            with zipfile.ZipFile(package,"w") as z:
                for name in ("setup.php","hook.php","tools/configure-cli.php","public/js/app.js","public/css/plugin.css","public/pics/logo.svg"):z.writestr("estoquegraal/"+name,"fixture")
            args=sg.arguments(["glpi","--glpi-dir",str(root),"--package",str(package),"--sha256",sg.hashlib.sha256(package.read_bytes()).hexdigest(),"--backup-dir",str(base/"backups")])
            payload=sg.make_payload({"PUBLIC_ORIGIN":"http://192.168.1.5:8080","GLPI_INSTANCE_ID":"teste"},"11111111-1111-4111-8111-111111111111."+"a"*64)
            calls=[]
            def fake(cmd,**kw):
                calls.append([str(x) for x in cmd])
                output="GLPI 11.0.5" if "--version" in cmd else ('{"active":false}' if "status" in cmd else '{}')
                return sg.subprocess.CompletedProcess(cmd,0,output,"")
            account=types.SimpleNamespace(pw_uid=1000,pw_gid=1000)
            with patch.object(sg.sys,"platform","linux"),patch.object(sg.os,"geteuid",return_value=0,create=True),patch.object(sg.os,"chown",create=True),patch.dict(sg.sys.modules,{"pwd":types.SimpleNamespace(getpwnam=lambda _:account)}),patch.object(sg,"require_tools"),patch.object(sg,"run_command",side_effect=fake):
                sg.install_glpi(args,payload)
            self.assertFalse(any("plugin:deactivate" in c for c in calls))
            self.assertTrue(any("plugin:install" in c for c in calls))
            self.assertTrue(any("apply" in c for c in calls))
            self.assertTrue(list((base/"backups").glob("*/plugin/old.txt")))

    def test_env_cannot_redirect_compose_to_remote_daemon(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/".env").write_text("DASHBOARD_IP=192.168.1.5\nDOCKER_HOST=tcp://servidor:2375\n")
            with patch.object(sg.subprocess,"run") as run:
                with self.assertRaises(sg.SetupError):sg.run_command(sg.compose_command(root,{"COMPOSE_PROJECT_NAME":"teste"},["ps"]))
                run.assert_not_called()

    def test_explicit_false_preserved_and_skips_glpi(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);args=sg.arguments(["dashboard","--configure-only","--ip","192.168.1.5"])
            sg.configure_env(root,args,["192.168.1.5"])
            file=root/".env";file.write_text(file.read_text().replace("INTEGRATION_ENABLED='true'","INTEGRATION_ENABLED='false'"))
            env=sg.configure_env(root,args,["192.168.1.5"]);self.assertEqual(env["INTEGRATION_ENABLED"],"false")
            self.assertIn("INTEGRATION_ENABLED='false'",file.read_text())
            with patch.object(sg.sys,"platform","linux"),patch.object(sg,"ROOT",root),patch.object(sg,"require_tools"),patch.object(sg,"discover_ips",return_value=["192.168.1.5"]),patch.object(sg,"run_command",return_value=SimpleNamespace(stdout="unix:///var/run/docker.sock")),patch.object(sg,"provision") as provision,patch.object(sg,"configure_remote") as remote:
                sg.main(["dashboard","--ip","192.168.1.5"])
                provision.assert_not_called();remote.assert_not_called()

    def test_invalid_integration_flag_preserves_existing_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);args=sg.arguments(["dashboard","--configure-only","--ip","192.168.1.5"])
            sg.configure_env(root,args,["192.168.1.5"]);file=root/".env"
            file.write_text(file.read_text().replace("INTEGRATION_ENABLED='true'","INTEGRATION_ENABLED='invalid'"));original=file.read_bytes()
            with self.assertRaisesRegex(sg.SetupError,"INTEGRATION_ENABLED"):sg.configure_env(root,args,["192.168.1.5"])
            self.assertEqual(file.read_bytes(),original)

    def test_pending_first_access_stops_provision_without_prompt(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(sg,"run_command",return_value=SimpleNamespace(stdout=json.dumps({"items":[],"requiresFirstAccess":True}))) as run,patch.object(sg,"ask") as ask:
                with self.assertRaisesRegex(sg.SetupError,"primeiro acesso"):sg.provision(pathlib.Path(tmp),{"COMPOSE_PROJECT_NAME":"teste"},sg.arguments(["dashboard"]))
                ask.assert_not_called();self.assertEqual(run.call_count,1)

if __name__=="__main__":unittest.main()
