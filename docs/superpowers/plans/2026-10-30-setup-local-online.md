# Configurador no servidor compartilhado Oracle

Basea117711, checkout limpo. Dashboard e GLPI no mesmo Ubuntu/Oracle; não é execução VS Code/Windows. Sem servidor, deploy, .env real, credencial real, commit ou branch nova.

- [x] Testes em vermelho para modo local/online, separação PUBLIC_ORIGIN e GLPI_API_BASE_URL, loopback somente GLPI local, execução local semSSH, preservação do modoSSH, arquivos/segredos/projeto/volumes e falhas.
- [x] Configurador: --mode local|online, --public-origin, --api-url, --glpi-local (GLPI_CONNECTION=local). Local mantém homologação HTTP privada; online exige origem HTTPS e usa Compose de servidor compartilhado, web publicado somente127.0.0.1:8080, para proxy HTTPS existente (não ocupar80/443 doGLPI). Não configurar DNS/certificado/firewall automaticamente.
- [x] Instalação local reutiliza configurar-glpi.sh/install_glpi com backup/CLI/chave oficial, sudo -n quando necessário e payload privado por stdin; nunca SSH para si mesmo. Modo SSH permanece explícito/padrão legado.
- [x] Helper CLI plugin aceita local_http opcional já suportado por Settings apenas em loopback; integração online via127.0.0.1 é transporte interno do mesmo host, público segue HTTPS. Não relaxar TLS/CSRF, não criar múltiplas origens permissivas.
- [x] Documentar transição revisada sem trocar projeto/volumes; novos argumentos não sobrescrevem .env existente silenciosamente. Testes Python, PHP real com fixtures, tipos/lint/build adequados, revisão e pacote versionado0.1.9 se helper alterado.

Backend permanece Node/TypeScript; Python é somente configurador existente. Nenhuma regra/autenticação/contrato de estoque muda. PUBLIC_ORIGIN é uma origem canônica de navegador; endereços da API não ampliam origensCSRF. GLPI em container exige endereço e filesystem que o processoPHP realmente alcance; não presumir localhost de umcontainer igual ao host.
