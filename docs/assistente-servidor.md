# Assistente único — Dashboard e GLPI no mesmo Ubuntu

Na raiz do repositório atualizado no Ubuntu Server 24.04:

```bash
sudo bash scripts/assistente-graal.sh
```

Use o mesmo comando para retomar após o primeiro acesso e para reaplicar/atualizar a instalação com as escolhas salvas. Ele executa build e migrações versionadas existentes; não é apenas um comando de status. Não executa git pull, commit, push, download de código ou instalação de dependências. Os arquivos desta atualização precisam estar no servidor antes de executar.

## Primeira execução

1. Escolha `local` (HTTP pela rede privada/VPN) ou `online` (domínio exclusivo com HTTPS).
2. Confirme a porta, o **mesmo COMPOSE_PROJECT_NAME da instalação**, diretório GLPI e usuário PHP. O IP privado é sugerido apenas quando não há ambiguidade. Não use o IP público NAT da Oracle como IP atribuído ao Linux.
3. No online, informe domínio DNS exclusivo do dashboard. O assistente detecta Apache ou Nginx ativo no host. Usa certificado/chave existentes ou pede uma vez e-mail ACME para emissão Let's Encrypt com Certbot webroot já instalado. A emissão aceita os termos ACME após a confirmação do resumo.
4. Confira o resumo e responda `sim`. O assistente salva escolhas, faz backup do .env, valida a nova configuração e inicia a pilha adequada. Não gera novas senhas em .env existente. INTEGRATION_ENABLED=false continua desabilitado.
5. Se houver primeiro acesso pendente, conclua a troca obrigatória de senha no navegador e execute **o mesmo comando**. O assistente não contorna esse bloqueio e ainda não cria a credencial da integração.
6. Selecione o administrador pelo número mostrado e informe o ID numérico da ficha do **mesmo usuário** no GLPI. Não precisa copiar UUID ou consultar SQL. O vínculo é explícito; outros funcionários exigem vínculos próprios. Essas escolhas ficam salvas para as execuções seguintes.
7. O instalador existente provisiona/reutiliza a credencial privada, instala/atualiza o plugin e limpa o cache GLPI. Confira os direitos do plugin nos perfis aprovados; não concede permissões globalmente nem faz movimentos para testar.

## Pré-requisitos e limites

Ubuntu com Docker/Compose local via socket Unix, Python3, Bash, PHP CLI compatível com GLPI11.0.5, sudo e iproute2 disponíveis. GLPI deve estar no filesystem do host, com banco já instalado; não GLPI dentro de container. Não instala GLPI, Docker ou dependências automaticamente.

Online exige DNS do domínio apontando ao servidor e portas80/443 permitidas no NSG/firewall, além de certificado válido. Não altera Oracle/DNS/firewall automaticamente. Para emitir via HTTP-01, porta80 precisa estar alcançável externamente; um e-mail e o nome do domínio não substituem isso. Certbot e um timer de renovação (certbot.timer ou snap.certbot.renew.timer) devem estar disponíveis quando a emissão é gerenciada por ele. O assistente não instala dependências. Ele pode emitir certificados e habilitar módulos Apache necessários; não remove certificados, contas ACME ou módulos como recuperação de uma falha.

A automação do proxy exige layout Ubuntu `sites-available/sites-enabled`, com **apenas um** Apache ou Nginx ativo. Não assume CDN, load balancer, proxy em container, configurações fora do layout padrão, certificados DNS-01 ou frontend em subdiretório. Topologias distintas exigem revisão; não execute para tentar substituir o proxy existente. O domínio do dashboard deve ser diferente do GLPI.

No online, Docker publica somente127.0.0.1:PORTA. O virtualhost exclusivo encaminha para esse listener com Host e X-Graal-Client-IP sobrescritos pelo proxy, mantendo HTTPS/cookie Secure e CSRF. O IP do cliente é o da conexão com o host; proxies intermediários precisam de revisão explícita. No privado, não abra8080 publicamente; o NAT Oracle pode expor uma porta vinculada ao IP privado se as regras permitirem.

## Estado, backup e recuperação

- `.local-setup/assistant.json`: escolhas/IDs, sem senhas ou token. Ignorado pelo Git e pelo contexto Docker, assim como os backups e a credencial existente.
- `.local-setup/assistant-env-*.bak`: .env anterior protegido. `.local-setup/proxy-*.bak`: cópia do virtualhost gerenciado anterior, quando existe.
- O nome do projeto, segredos, instância, arquivo de token e dados do banco são preservados. .env existente sem COMPOSE_PROJECT_NAME é recusado: identifique primeiro qual projeto possui os volumes; o assistente não adivinha.
- `/etc/nginx/sites-available/graal-dashboard.conf` ou `/etc/apache2/sites-available/graal-dashboard.conf`: somente virtualhost gerenciado. Não sobrescreve arquivo externo nem domínio declarado em outro site padrão. Valida sintaxe antes do reload. Falha restaura o virtualhost anterior e tenta recarregar; falha na recuperação fica visível.
- Falha de Certbot/proxy não desfaz o .env salvo. Estado fica disponível para corrigir o pré-requisito e reexecutar. Certificados eventualmente emitidos e módulos Apache habilitados permanecem; não são apagados.
- Instalação do plugin reutiliza os backups em `/var/backups/estoque-graal/` e a recuperação descrita em [operação GLPI](integracoes/glpi/operacao.md). Não desinstale nem apague tabelas de intenções.
- Não remove volumes, recria usuários existentes ou renova/rotaciona credenciais expiradas por conta própria. Se a credencial existente expirar, siga a rotação autorizada documentada na integração.
- Um lock global em `/run/lock/graal-setup.lock` impede assistentes simultâneos até entre cópias do repositório; esse arquivo permanente não deve ser apagado. O kernel libera o lock ao encerrar o processo. Há também lock privado por checkout. Se o processo for interrompido abruptamente, confira que não está em execução antes de remover `.local-setup/assistant.lock` ou `.setup-graal.lock`.

Para rever as escolhas (inclusive transição entre privado e online):

```bash
sudo bash scripts/assistente-graal.sh --reconfigurar
```

Isso pede novo resumo/confirmação e nova escolha do responsável/vínculo; não permite trocar silenciosamente o projeto existente. A mudança de modo pode exigir novo login. A transição para privado não desinstala o virtualhost HTTPS gerenciado anterior; revise sua desativação se esse endereço não for mais usado.

## Certificados

Emissão automática usa `certbot certonly --webroot`, preservando os virtualhosts do GLPI. O virtualhost temporário serve o desafio, sem encaminhar login em HTTP. Depois de emitir, o assistente instala o virtualhost TLS. Ao adotar certificado Certbot existente, a automação exige lineage exclusivo com nome igual ao domínio e autenticador webroot verificável; preserva o webroot registrado para esse domínio. Certificados compartilhados ou renovação por outro autenticador são recusados antes de modificar o .env/proxy, exigindo revisão da topologia. Não reconfigura nem força renovação de certificado existente por suposição. Um hook próprio valida o proxy e executa reload após renovação, sem substituir hooks externos, mesmo se não foi necessário solicitar e-mail para um certificado já existente. Timer inativo é erro visível; a configuração não é declarada concluída nesse caso. Certificados personalizados e sua renovação permanecem responsabilidade do mecanismo que os fornece.

Referências oficiais consultadas para o gerador: [Nginx proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header), [Apache RequestHeader](https://httpd.apache.org/docs/2.4/mod/mod_headers.html#requestheader), [Certbot webroot e renovação](https://eff-certbot.readthedocs.io/en/stable/using.html).

## Verificação local e homologação

Passaram 56 testes Python: 25 do assistente e 31 de regressão do configurador existente. Exercitam arquivos temporários, preservação de projeto/segredos, execução recorrente sem novas perguntas, backups, retorno a configurações anteriores, falha de certificado, renovação existente, conflitos de domínio e bloqueio de primeiro acesso, com comandos de host simulados. A chamada flock do lock global é simulada neste Windows. No Windows, a primitiva de symlink é simulada pela falta do privilégio; não equivale à validação do filesystem Linux. Nenhum servidor Oracle/GLPI foi acessado nesta implementação.

Ainda é necessário homologar no Ubuntu: Docker Compose, nginx -t/apache2ctl configtest reais, emissão ACME, timer/hook, permissões PHP, HTTPS de ponta a ponta, reinício e integração GLPI. O assistente verifica health HTTPS com validação TLS e JSON status=ok no domínio esperado; isso não prova autorização/vínculo nem permite declarar operações de estoque homologadas.

O plugin continua 0.1.9 e o backend não mudou nesta tarefa. Não há nova migração ou necessidade de gerar outro ZIP por causa do assistente; o pacote é construído do fonte atual pelo instalador existente.

## Diagnóstico da instalação/configuração — atualização0.1.10

Se a credencial já foi criada/preservada e a instalação falha, atualize os arquivos do configurador e fonte do plugin antes de executar:

```bash
sudo bash scripts/assistente-graal.sh --diagnosticar
```

Usa o .env e o token protegidos existentes. Não inicia/recria containers, emite credenciais, instala/ativa/desativa plugin, limpa cache ou grava configuração do GLPI. Empacota o fonte atual e usa código temporário com --root apontando ao GLPI real; a inicialização do Kernel pode produzir logs/cache normais de leitura. O diretório temporário é removido ao terminar. Não consulta apenas o helper antigo instalado.

O resultado informa a etapa controlada (resources/kernel/security/read-config/payload-validation/api-read/persist/verify-persist/commit ou comandos de instalação) e status HTTP quando fornecido pelo cliente da API. Não imprime o stderr bruto, mensagens remotas, corpo, Authorization, token, senha ou backup. Exemplos: api-read/401 indica recusa de credencial; api-read/403 indica recusa de autorização; api-read/504 indica falha de transporte/timeout; não rotacione credenciais ou altere permissões só com base em mensagem genérica.

Depois de resolver a causa identificada, o comando normal retoma usando a credencial existente. Não repita a instalação como diagnóstico. Backend permanece inalterado, plugin/helper agora0.1.10, sem nova migração. Uma ativação manual bem-sucedida não prova sucesso das etapas de backup/aplicação/verificação/cache; o instalador pode desativar o plugin ao falhar depois da ativação.

Verificação local da atualização: 60 testes Python e contrato PHP real/cURL com API sintética (probe sem persistência, resposta403 identificada e token ausente do diagnóstico). GLPI Kernel/Config/DB e comandos de host são fixtures; causa instalada e homologação Ubuntu continuam pendentes. Não foi acessado servidor.


Atualização0.1.11: validação identifica motivos controlados (instance-mismatch, invalid-url, invalid-token, invalid-fields etc.) sem exibir entrada ou exceção remota. Fixture passou a carregar a configuração pré-existente; teste reproduz rejeição de instância diferente, sem gravar ou apagar o estado anterior. Isso não comprova que esse seja o motivo no servidor. Diagnóstico do servidor ainda necessário antes de modificar identidade, credencial ou configuração. 61 testes Python e contrato PHP/cURL passaram localmente.


# Correção0.1.12 — instance-mismatch na configuração inicial

Causa comprovada: o helper CLI rejeitava incondicionalmente uma instância diferente, enquanto o formulário do plugin já permitia corrigi-la quando a tabela de intenções estivesse vazia. A regra agora é compartilhada entre formulário e CLI.

Com ZERO intenções, o instalador pode alinhar a configuração ao identificador do .env/cliente já provisionado, após leitura autenticada bem-sucedida da API. Preserva a credencial existente e o backup anterior. Probe não grava. Qualquer intenção, inclusive concluída ou rejeitada, bloqueia a troca com instance-in-use/409. Falha na consulta também bloqueia. Não apague registros nem force substituição se houver histórico: esse caso exige conciliação específica, não é configuração inicial vazia.

Atualize os arquivos do repositório no Ubuntu (o ZIP do plugin sozinho não atualiza o configurador) ou aplique o patch fornecido com git apply --check antes de git apply. Depois execute, na raiz do projeto:

```bash
sudo bash scripts/assistente-graal.sh
```

Não exige editar .env, copiar UUID/token, desinstalar plugin ou trocar senha. Usa o instalador existente com backup e cache:clear. Backend e migrações inalterados. Nenhuma alteração foi aplicada ao servidor nesta entrega.

Verificado localmente:61 testes Python; contrato CLI PHP real/cURL com GLPI simulado, alteração sem intenções, probe sem persistência, cinco estados protegidos, falha de consulta e da API sem gravação e repetição segura; formulário compartilha a mesma regra e foi testado. Homologação no Ubuntu/GLPI real continua pendente.

---

## instance-in-use: preservar o histórico GLPI

Use o [procedimento de reconciliação explícita](integracoes/glpi/reconciliacao-instancia.md) com `sudo bash scripts/assistente-graal.sh --reconciliar-instancia` após atualizar também a CLI do dashboard. Não trocar a instância do GLPI nem apagar suas intenções.
