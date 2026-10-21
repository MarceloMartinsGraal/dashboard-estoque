# Operação no Ubuntu Server 24.04

Estes são procedimentos para o responsável executar futuramente. Nenhum foi executado no servidor nesta tarefa. Não use `runserver`, Vite ou `NODE_ENV=development` como servidor público.

## Preparação

1. Instalar Docker Engine e plugin Compose v2 conforme a documentação oficial do Ubuntu/Docker; manter o host atualizado.
2. Definir domínio real e DNS. Substituir **todas** as ocorrências de `estoque.exemplo.com` nos arquivos Nginx. Não publicar com o domínio ilustrativo.
3. Restringir firewall a SSH administrativo e 80/443. PostgreSQL e API não têm portas publicadas em `compose.yaml`.
4. Criar `.env` de produção com permissão `chmod 600 .env`, três segredos aleatórios independentes, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://DOMINIO_REAL`. A origem deve corresponder exatamente ao domínio usado pelo navegador, sem barra final. Não habilitar CORS.
5. `DB_APP_PASSWORD` é hexadecimal aleatório. `graal_app` não é superusuário; o script de inicialização concede criação no schema. O usuário administrador PostgreSQL tem segredo separado. O init script só roda em volume vazio; mudar `.env` não muda senhas de um volume já criado.
6. Fazer backup e verificar estado do Git e das migrações antes de qualquer atualização. Nunca executar `docker compose down -v` em produção.

## HTTPS inicial e renovação

Referência: [HTTP-01 do Let's Encrypt](https://letsencrypt.org/docs/challenge-types/).

O Nginx de produção exige certificados já existentes. Para a primeira emissão:

1. Instalar Certbot no host seguindo a documentação oficial atual; habilitar seu timer de renovação.
2. Criar `/var/www/certbot` e preparar temporariamente um proxy **somente HTTP**, usando `infra/nginx.http-bootstrap.conf`. Montar essa configuração no serviço Nginx por um override local; usar `docker compose ... up -d --no-deps nginx` somente após construir a imagem. O backend não é exposto durante essa fase; a configuração retorna 503 para a aplicação.
3. Validar a configuração e o acesso externo ao diretório `/.well-known/acme-challenge/`. A porta 80 deve estar acessível para HTTP-01.
4. O responsável executa `sudo certbot certonly --webroot -w /var/www/certbot -d DOMINIO_REAL`. Não há execução ou emissão automática por este projeto.
5. Retirar o override HTTP, habilitar `infra/nginx.production.conf` e montar `/etc/letsencrypt` completo como somente leitura; o diretório inclui os links e os certificados renovados.
6. Verificar `docker compose exec nginx nginx -t` e recarregar com `docker compose exec nginx nginx -s reload` após toda renovação bem-sucedida. Configurar um deploy-hook do Certbot para esses comandos, com diretório de trabalho absoluto e permissões restritas.
7. Testar `certbot renew --dry-run` no servidor quando autorizado e monitorar vencimento. Não desligar a renovação nem expor chaves privadas.

## Construção, migração e primeiro acesso

Após preparar `.env` e o domínio, em janela autorizada:

```sh
docker compose build
docker compose up -d --wait db
docker compose run --rm --no-deps api node dist/backend/migrate.js
docker compose run --rm --no-deps api node dist/backend/bootstrap.js
docker compose up -d api nginx
```

Migrações **não** são executadas automaticamente ao iniciar API. A CLI usa um lock de migração e verifica checksum dos arquivos aplicados; nunca edite migrações já aplicadas. Nesta entrega só há criação inicial e chave de fontes; não há migração destrutiva.

O primeiro responsável tem conta individual. Somente responsáveis designados administram contas; funcionários têm permissões operacionais completas. Não compartilhar contas. Não publicar sem definir quem assume essa responsabilidade.

A aplicação roda como usuário `node`, com filesystem somente leitura, `/tmp` temporário, capabilities removidas e `no-new-privileges`. Banco e API ficam na rede interna. Nginx é o único ponto público. Health check retorna apenas estado, sem versão ou credenciais.

## Backup e retenção

- Execute `BACKUP_DIR=/CAMINHO_PROTEGIDO_FORA_DO_REPOSITORIO sh scripts/backup.sh` na raiz do projeto. O script usa `pg_dump -Fc`, permissão restrita, arquivo parcial e checksum; não imprime segredos.
- Agende backup diário em janela apropriada. Defina o objetivo de recuperação com a Graal; sem arquivamento de WAL, o limite de perda é o intervalo desde o último dump válido.
- Política inicial proposta para aprovação: 7 diários, 4 semanais e 12 mensais, com pelo menos uma cópia cifrada fora do servidor. O script não exclui backups automaticamente; a retenção deve ser aplicada pelo armazenamento/rotina aprovada.
- Verifique código de saída, tamanho e checksum. Um dump existir não prova que ele restaura.
- Guarde também configurações protegidas, certificados e responsáveis pela recuperação; não coloque esses segredos no Git.

## Teste de restauração isolado

Use uma máquina/ambiente de homologação, um container com nome exclusivo e **sem porta publicada**. Nunca use os serviços ou volumes de produção para testar:

```sh
export RESTORE_CHECK_PASSWORD="$(openssl rand -hex 32)"
docker run -d --name graal-restore-check \
  -e POSTGRES_USER=restore_check \
  -e POSTGRES_PASSWORD="$RESTORE_CHECK_PASSWORD" \
  -e POSTGRES_DB=graal_restore_test \
  --mount type=tmpfs,destination=/var/lib/postgresql \
  postgres:18.4-bookworm
# Aguarde pg_isready retornar sucesso antes de prosseguir:
docker exec graal-restore-check pg_isready -U restore_check -d graal_restore_test
# Confira o checksum do dump escolhido antes de restaurar.
docker exec -i graal-restore-check pg_restore --exit-on-error --no-owner --no-privileges \
  -U restore_check -d graal_restore_test < /CAMINHO_DO_BACKUP_VALIDADO.dump
docker exec graal-restore-check psql -U restore_check -d graal_restore_test \
  -c 'SELECT COUNT(*) FROM products; SELECT COUNT(*) FROM movements; SELECT COUNT(*) FROM legacy_movements;'
```

Confira também soma do livro por produto/localização, histórico de estornos, versão das migrações e último instante recuperado. Em homologação privada, aponte uma cópia da aplicação para essa restauração e teste login, leitura e uma operação sintética autorizada. Revogue sessões antigas antes de liberar uma recuperação real. Após validar, remova **somente o container isolado** `graal-restore-check`; não toque em volumes de produção. Registre data, responsável e resultado do ensaio.

## Atualização e falhas

1. Fazer e validar backup; registrar a imagem/commit anterior. Commit e publicação são feitos pelo usuário/responsável, nunca automaticamente pelo agente.
2. Executar testes, builds e configuração Nginx/Compose em homologação com o mesmo PostgreSQL 18.4.
3. Conferir se novas migrações são compatíveis com reversão da aplicação; não supor que rollback de imagem desfaz schema ou dados.
4. Em janela autorizada, interromper gravações se necessário, aplicar migrações explícitas, atualizar imagens e conferir health check e login.
5. Se apenas a aplicação falhar e o schema for compatível, voltar à imagem anterior. Se houver corrupção/incompatibilidade de dados, manter indisponível e restaurar o backup validado em uma nova base, verificando a recuperação antes de trocar a conexão.
6. Monitorar disco, saúde da API/banco, 5xx/429, backups, restauração e certificado. Nginx usa rotação de logs Docker; não registrar corpo de requisição, cookies, tokens ou senhas.

## Pendências humanas

Domínio/DNS e configuração do servidor; aprovação de retenção e restauração; responsável pelas contas; revisão das identidades, possíveis duplicatas, unidades e datas da auditoria; contagem física por produto/armário e data de corte. A importação legada é revisão histórica e não homologa essas pendências.
