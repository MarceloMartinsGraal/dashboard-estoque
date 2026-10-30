# Configuração automática: dashboard por IP e GLPI por SSH

Base: commit 9f2a374c95baffa6287c4ae7deca1fb2ed6bfb6f.
Esta entrega prepara scripts para Ubuntu Server 24.04. Nenhum servidor foi acessado para instalar ou configurar os serviços. O modo novo é **homologação HTTP em IPv4 privado**. Produção continua usando compose.yaml, domínio e HTTPS.

## O que executar

Na raiz do repositório atualizado, no servidor do dashboard:

~~~sh
bash scripts/configurar-dashboard.sh \
  --glpi-host 192.168.1.106 \
  --glpi-user SEU_USUARIO_SSH \
  --instance glpi-homologacao
~~~

Substitua SEU_USUARIO_SSH pelo usuário autorizado. O IP acima é o servidor GLPI informado pelo responsável; o dashboard detecta o IP da sua própria máquina. Nenhum dos dois endereços é fixado no código.

Se houver várias interfaces privadas, acrescente --ip IP_DO_DASHBOARD. A porta padrão é 8080; pode ser definida com --port na primeira execução. O endereço final será http://IP_DO_DASHBOARD:8080.

O script:
1. Detecta o IP e prepara .env com três segredos independentes.
2. Valida o Compose, constrói as imagens e inicia banco, migrações, API e Nginx.
3. API cria o primeiro administrador temporário somente se não existir funcionário. O script para antes de provisionar se esse responsável ainda precisar concluir o primeiro acesso; após trocar a senha, reexecutar com o mesmo .env.
4. Pede o UUID do responsável para auditar o provisionamento da integração.
5. Gera uma credencial com validade de 30 dias, ou reutiliza a válida anteriormente guardada.
6. Empacota o plugin, transfere arquivos por SSH e executa configurar-glpi.sh no servidor GLPI.
7. Faz somente uma consulta de leitura à API a partir do GLPI antes de salvar a configuração.

As senhas do banco e SESSION_SECRET nunca são transferidas ao GLPI. Apenas URL da API, instância, token e parâmetros de comunicação são enviados por stdin do SSH. O token é salvo no GLPI pela criptografia oficial. Não abra o script com shell tracing, nem publique dumps do ambiente ou saída interpolada do Compose.

## Pré-requisitos

No dashboard: Bash, Python 3.10+, iproute2 (comando ip), Docker Engine local com Compose v2, OpenSSH client e acesso ao daemon. O script não instala pacotes, não altera firewall e não troca contexto Docker. Daemons remotos por TCP/SSH são recusados.

No GLPI: instalação funcional **11.0.5**, PHP 8.2+ com as extensões exigidas pelo GLPI/plugin, Python 3.10+, Bash, tar e sudo. O caminho padrão é /var/www/glpi e o usuário PHP padrão é www-data. Instalações com diretórios externos, containers ou usuários diferentes precisam de revisão e parâmetros apropriados; não há descoberta automática de containers GLPI.

O GLPI precisa alcançar o IP/porta do dashboard. Um IP detectado não comprova acesso pela rede. Restrinja esse ambiente à rede privada confiável: a conexão HTTP posterior entre GLPI e dashboard não é cifrada pelo SSH de configuração.

Antes do primeiro uso, conecte manualmente por SSH, confira a impressão digital com o administrador e registre a chave correta em known_hosts. O script exige StrictHostKeyChecking=yes e não aceita automaticamente a chave do host.

Prefira chave SSH ou agente já configurado. --ssh-key CAMINHO_DA_CHAVE é opcional. Não guardar senha SSH no .env. O usuário remoto precisa de autorização para instalação e configuração; a execução remota usa sudo -n (ou root). Providencie o acesso apropriado com o administrador. O script não altera sudoers nem pede senha sudo pela entrada reservada ao payload.

## Conferir antes de iniciar

Para apenas gerar/validar o .env sem Docker ou SSH:

~~~sh
bash scripts/configurar-dashboard.sh --configure-only \
  --ip IP_DO_DASHBOARD \
  --glpi-host IP_DO_GLPI \
  --glpi-user SEU_USUARIO_SSH \
  --instance glpi-homologacao
~~~

Depois, na mesma pasta, basta:

~~~sh
bash scripts/configurar-dashboard.sh
~~~

--skip-glpi inicia somente o dashboard. Reexecute sem essa opção quando quiser configurar o GLPI.

Para a primeira execução, --project NOME define a pilha e o volume exclusivos. O padrão é graal-homologacao. O script não muda automaticamente projeto, endereço ou porta depois de configurados, pois isso poderia selecionar outro banco ou quebrar acesso.

O Compose de homologação publica só o Nginx na interface privada escolhida. PostgreSQL e API ficam na rede interna. É usado NODE_ENV=development para permitir HTTP e cookie sem Secure; isso é exclusivo deste teste privado, nunca uma configuração de produção.

## .env existente

O script preserva comentários, valores desconhecidos e segredos. Não usa source ou eval para ler o arquivo.

Se o .env não foi criado por este instalador, ele para antes de alterar. --adopt-env permite adotar explicitamente um arquivo completo de homologação, com NODE_ENV development/test, IP/projeto explícitos e segredos já preenchidos. PUBLIC_ORIGIN precisa corresponder ao IP/porta; INTEGRATION_ENABLED aceita true/false; false preservado não provisiona GLPI. Confira o projeto e os volumes existentes antes de adotar: não use essa opção para migrar silenciosamente uma instalação.

Senhas vazias em .env existente não são geradas automaticamente, pois um volume já pode depender de outros valores. Mudar .env não altera senha de PostgreSQL inicializado.

Backups locais do .env ficam em .local-setup/, e o token em .local-setup/integration-token. São ignorados pelo Git e os arquivos têm permissão 600. A credencial não é colocada diretamente no .env: ele contém apenas INTEGRATION_TOKEN_FILE.

Reexecuções reutilizam o token; credencial inválida, expirada ou revogada exige rotação explícita. Se o arquivo do token foi perdido mas há cliente no banco, o script não cria outro silenciosamente. Guarde backup protegido. --valid-days aceita de 1 a 365 dias somente na criação.

## Funcionários e perfis

O script não associa pessoas pelo nome e não concede direitos a todos os perfis.

Para vincular um usuário GLPI, forneça seu ID real e o UUID do funcionário ativo correspondente:

~~~sh
bash scripts/configurar-dashboard.sh \
  --admin-id UUID_DO_RESPONSAVEL \
  --link ID_USUARIO_GLPI:UUID_FUNCIONARIO_DASHBOARD
~~~

Repita --link para outras pessoas. IDs incorretos devem ser corrigidos pelo procedimento administrativo, não por remapeamento automático. O responsável precisa estar ativo e ter manages_accounts. Os vínculos e a criação do cliente são auditados.

Conceda no GLPI os direitos do plugin apenas aos perfis aprovados, usando sua tela de administração. Busca pode funcionar antes de haver vínculo; escrita exige funcionário vinculado e ativo.

## Segundo script no GLPI

Normalmente o primeiro script transfere e executa o segundo automaticamente. Para uso manual, mantenha configurar-glpi.sh e setup_graal.py na mesma pasta e forneça o JSON de configuração por stdin protegido. Não colocar token na linha de comando.

O instalador confere:
- Versão GLPI, pacote e checksum.
- Ausência de cópia conflitante em marketplace.
- Caminhos e usuário PHP.
- Backup fora da instalação pública.
- Estado do plugin, desativando somente se estiver ativo.
- Instalação/atualização por CLI, sem desinstalar.
- Leitura da API e persistência cifrada da configuração.

O ZIP inclui tools/configure-cli.php. Essa ferramenta recusa HTTP/web e usa o bootstrap oficial de Kernel do GLPI, não depende de inc/includes.php para inicializar a aplicação. Não concede permissões de perfil e não modifica o núcleo.

Configurações antigas e arquivos são preservados em /var/backups/estoque-graal/DATA-HORA/. A configuração pode incluir credencial cifrada: mantenha acesso restrito. O backup depende da chave criptográfica já existente do GLPI; não a substitua.

Não há reinício geral de Apache/PHP. Se o servidor mantiver OPcache sem verificação de timestamps, o administrador deverá recarregar apenas o serviço correto após a atualização.

## Falhas e recuperação

Falha SSH não apaga a pilha local. Corrija acesso/rede e reexecute com o mesmo .env. Não apagar volumes, trocar projeto ou regenerar senhas para tentar resolver.

Se a configuração remota falhar, o plugin é desativado quando possível e o backup é preservado. O script não tenta desfazer schema automaticamente.

Para recuperar, o administrador deve:
1. Conferir o backup e o erro, sem desinstalar o plugin.
2. Se necessário, restaurar a configuração com tools/configure-cli.php restore, executado como usuário PHP, usando config.json por stdin. O arquivo guarda valores cifrados; o helper decifra com a chave local e usa Config para cifrar novamente uma única vez.
3. Para voltar arquivos anteriores, usar backup/plugin e o procedimento de atualização, manter o plugin desativado até verificar versão/estado e só então ativá-lo.
4. Não remover tabelas de intenções ou resultados de idempotência.

O lock .setup-graal.lock evita duas execuções locais simultâneas. Se uma execução for encerrada à força, confirme que o PID registrado não está mais executando antes de remover somente o lock.

Não use docker compose down -v. Para status e logs, use sempre o mesmo arquivo e projeto:

~~~sh
docker compose --env-file .env -p graal-homologacao -f compose.homologacao.yaml ps -a
docker compose --env-file .env -p graal-homologacao -f compose.homologacao.yaml logs --tail=100 migrate api web
~~~

Se escolheu outro projeto, substitua o nome em todos os comandos.

## Produção futura

Não reutilizar o Compose HTTP como publicação. Configure domínio/certificados e compose.yaml conforme operations.md. No GLPI, altere a URL para HTTPS, selecione produção e desligue private_http. Planeje explicitamente a transição dos dados/volumes; projeto Compose diferente pode criar outro banco. A integração em produção também precisa encaminhar INTEGRATION_ENABLED à API por configuração revisada.

## Verificação local e limites

~~~sh
python3 -B -m unittest discover -s tests -p test_setup_graal.py
node --test tests/setup-provision.test.cjs
php tests/glpi-private-http.php
php tests/glpi-setup-config.php
python3 scripts/package-glpi-plugin.py
~~~

Testes de orquestração substituem Docker e SSH por executores simulados. Testes do provisionamento usam cliente SQL simulado. Não equivalem a ensaio Docker/GLPI/PostgreSQL real. A conferência de instalação real, persistência cifrada, rede, permissões sudo, certificados e movimentações precisa ser feita depois em homologação autorizada.

## Referências oficiais usadas

- [CLI e bootstrap do GLPI 11.0.5](https://github.com/glpi-project/glpi/blob/11.0.5/bin/console).
- [Instalação de plugins pelo GLPI](https://github.com/glpi-project/glpi/blob/11.0.5/src/Glpi/Console/Plugin/InstallCommand.php).
- [Precedência de variáveis do Docker Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

Nenhum commit, push, deploy ou configuração de servidor foi executado nesta entrega.

Atualização30/10: [primeiro acesso e integração por padrão](primeiro-acesso.md). O setup preserva false explícito e encerra sem GLPI/credenciais quando desabilitado; valor inválido impede gravação. Administrador pendente não aparece como apto na CLI e não pode autorizar integração.
