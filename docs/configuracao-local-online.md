# Dashboard e GLPI no mesmo Ubuntu/Oracle

Este guia é para os dois sistemas no **mesmo servidor Ubuntu**, não desenvolvimento VS Code/Windows. O configurador continua Python auxiliar; a API continua Node.js/TypeScript. Código preparado localmente, sem acessar ou atualizar Oracle/GLPI.

## Modos e endereços

| Configuração | Local/rede privada | Online no servidor compartilhado |
|---|---|---|
| Argumento | --mode local | --mode online |
| PUBLIC_ORIGIN do navegador | http://IP_PRIVADO:8080 | https://DOMINIO_DASHBOARD |
| Compose escolhido | compose.homologacao.yaml | compose.same-host.yaml |
| Publicação do dashboard | IP privado:8080 | somente127.0.0.1:8080 |
| NODE_ENV | development | production; cookie Secure |
| GLPI_API_BASE_URL padrão com --glpi-local | origem privada + /api/integration/v1 | http://127.0.0.1:8080/api/integration/v1 |

PUBLIC_ORIGIN é a origem canônica que você usa no navegador: esquema/host/porta exatos, sem caminho ou barra final. Ela determina a validação CSRF. GLPI_API_BASE_URL é o endereço usado pelo processo PHP do GLPI e pode ser diferente. A diferença **não** amplia origens permitidas e não desativa CSRF.

No online, o dashboard não disputa80/443 do GLPI: o proxy HTTPS existente recebe um domínio/virtualhost separado e encaminha ao dashboard em127.0.0.1:8080. Este script não configura DNS, certificados, Apache/Nginx do host ou firewall/NSG da Oracle automaticamente. Não existe confirmação de acesso público apenas porque os containers iniciaram.

## Local/rede privada

Na raiz do checkout atualizado **no Ubuntu**, usando o IP privado realmente atribuído à VNIC Oracle:

```bash
sudo bash scripts/configurar-dashboard.sh   --mode local --glpi-local --ip IP_PRIVADO_ORACLE --skip-glpi
```

Concluir login/troca inicial quando aplicável. Depois, para configurar o plugin e vínculo:

```bash
sudo bash scripts/configurar-dashboard.sh   --mode local --glpi-local --ip IP_PRIVADO_ORACLE   --admin-id UUID_DO_RESPONSAVEL   --link ID_USUARIO_GLPI:UUID_FUNCIONARIO_DASHBOARD
```

`--glpi-local` evita perguntas, chaves, SSH e SCP para o próprio servidor. O script usa configurar-glpi.sh localmente, sudo -n se necessário, usuário PHP e GLPI_DIR existentes; mantém backup, instalação CLI e criptografia oficial do GLPI. O token vai por stdin, nunca em argumento ou URL. O caminho padrão é /var/www/glpi; ajustar --glpi-dir e --web-user quando necessários, sem supor outro layout.

HTTP privado exige ambiente controlado. Em Oracle, um IP público pode ser NAT para a VNIC privada: publicar em IP privado sozinho não substitui NSG/firewall/VPN. Não abrir8080 publicamente para contornar HTTPS. O endereço público NAT não precisa estar atribuído ao Linux; --ip usa apenas IP privado real no modo local.

## Online com HTTPS no mesmo servidor

Exemplo **de preparação de instalação nova**, com domínio real já reservado para o dashboard:

```bash
sudo bash scripts/configurar-dashboard.sh   --mode online --glpi-local   --public-origin https://DOMINIO_DASHBOARD --configure-only
```

Antes de iniciar/usar login, preparar um virtualhost HTTPS no proxy que já atende o servidor. Não substituir a configuração/virtualhost do GLPI. Usar certificado válido para o domínio e encaminhar a raiz do domínio do dashboard para http://127.0.0.1:8080. Frontend/API atuais precisam de domínio raiz próprio; não usar /dashboard como subcaminho.

**Contrato obrigatório do proxy do host:** ele deve sobrescrever X-Graal-Client-IP com o IP real da conexão, sem confiar no valor fornecido pelo visitante. O listener do dashboard é acessível só por loopback. O Nginx interno usa esse valor para limite de login e o encaminha ao backend, evitando agrupar usuários no IP do gateway Docker. Sem cabeçalho válido, o login online responde503; não remover o limite como solução.

Exemplo de trecho para virtualhost Nginx HTTPS já existente e corretamente certificado:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Graal-Client-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 21m;
}
```

Se o proxy for Apache, usar virtualhost HTTPS dedicado com ProxyPreserveHost On, ProxyPass/ProxyPassReverse para127.0.0.1:8080 e **sobrescrever** X-Graal-Client-IP com o endereço remoto da conexão (mod_headers). Não apenas repassar um cabeçalho recebido. Se houver CDN/load balancer antes do proxy do host, identificar/proteger os proxies confiáveis antes de mudar a origem do IP; este guia não assume essa topologia.

O Nginx interno força X-Forwarded-Proto=https somente nesta pilha de loopback atrás de TLS, preservando cookies Secure do backend. Não publicar esse listener diretamente nem usar esta configuração com portas abertas em0.0.0.0. O modo standalone antigo com compose.yaml permanece disponível para servidor dedicado; não usá-lo no compartilhado se80/443 já são do GLPI.

Com proxy/DNS/certificado prontos, iniciar e concluir primeiro acesso se necessário:

```bash
sudo bash scripts/configurar-dashboard.sh --mode online --glpi-local --skip-glpi
```

Depois executar novamente sem --skip-glpi, com os UUIDs/vínculos necessários:

```bash
sudo bash scripts/configurar-dashboard.sh --mode online --glpi-local   --admin-id UUID_DO_RESPONSAVEL   --link ID_USUARIO_GLPI:UUID_FUNCIONARIO_DASHBOARD
```

O navegador usa HTTPS. O PHP no mesmo host pode usar HTTP127.0.0.1 interno com local_http explícito; essa opção já existia em Settings e agora é persistida pelo helper CLI0.1.9. Não permite HTTP público, não desativa verificação TLS para URLs HTTPS e não altera a autenticação Bearer/vínculo/escopos.

## Sobrescrever a URL da integração

Se precisar de outro endereço realmente alcançável pelo PHP:

```bash
sudo bash scripts/configurar-dashboard.sh --glpi-local   --api-url https://ENDERECO_VALIDO_DA_API/api/integration/v1
```

HTTPS é permitido em ambos modos. HTTP em IP privado é apenas homologação explícita; HTTP loopback é apenas GLPI local no mesmo servidor. Em modo SSH, loopback é recusado porque apontaria ao outro servidor. O default legado continua SSH se GLPI_CONNECTION não existe e --glpi-local não foi informado. Instalações com GLPI em container exigem endereço e filesystem do contexto PHP real: localhost do container não é o host; o instalador local atual presume GLPI/PHP no host e não entra automaticamente em containers GLPI.

## .env existente e transição

Não trocar projeto, banco, volumes pgdata/invoices, instância ou segredos para mudar acesso. Argumentos conflitantes com valores existentes param com mensagem e preservam o arquivo. Para converter uma instalação local existente para online, fazer backup, revisar explicitamente GRAAL_SETUP_MODE=production, NODE_ENV=production, PUBLIC_ORIGIN HTTPS, DASHBOARD_IP=127.0.0.1, GLPI_CONNECTION=local e GLPI_API_BASE_URL de loopback; manter COMPOSE_PROJECT_NAME, senhas, instância e INTEGRATION_TOKEN_FILE. Conferir proxy e porta disponível antes de recriar serviços com o mesmo projeto. O script não faz essa transição silenciosamente.

.env não gerenciado exige --adopt-env com projeto e origem/IP explícitos e segredos já preenchidos. Isso não regenera senhas existentes. INTEGRATION_ENABLED=false é preservado e impede provisionamento/GLPI; inválido é recusado. Concluir troca inicial antes de emitir credencial, conforme fluxo existente. Mudança de modo muda política/nome do cookie; entrar novamente no endereço canônico após transição.

Para status/logs, usar o arquivo selecionado pelo modo e o mesmo projeto; online usa compose.same-host.yaml. Não imprimir docker compose config interpolado, .env ou token no chat.

## Plugin/pacote e verificações

Plugin0.1.9 contém helper CLI com local_http opcional e confirmação dos flags persistidos. Atualização pelo configurador conserva backup e executa cache:clear oficial; não desinstalar nem remover tabelas de intenções. Não há migração nova de dashboard ou regra de estoque nesta alteração.

Gerar pacote: `python scripts/package-glpi-plugin.py`. ZIP/checksum em dist/estoquegraal-0.1.9.zip, ignorados pelo Git. O fonte segue glpi-plugin/estoquegraal e guias canônicos docs/integracoes/glpi.

Testes e limitações em [configuracao-local-online-verificacao.md](configuracao-local-online-verificacao.md). Nenhum script foi executado contra Oracle/GLPI real; proxy HTTPS, portas, permissões, PHP e conectividade efetiva precisam de homologação autorizada.
