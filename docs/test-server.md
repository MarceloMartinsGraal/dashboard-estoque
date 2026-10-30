# Preparação do futuro servidor de testes

Estado: instruções revisadas, sem deploy, publicação, credenciais reais ou alteração de servidor. Nesta máquina não há Docker; os comandos abaixo precisam de ensaio futuro. PostgreSQL nativo temporário valida API/migrações, mas não valida imagem, Nginx, TLS ou restauração.

## Pilha privada em ambiente vazio

1. Ubuntu24.04 atualizado, Docker Engine/Compose v2 e acesso administrativo restrito. Usar checkout revisado e arquivo .env protegido, sem copiar dados operacionais. Ler [variáveis e verificação](development.md).
2. Para ensaio sem publicação, usar compose.dev.yaml em projeto exclusivo e banco/volume novos. O frontend fica ligado somente a 127.0.0.1:8080. Acessar por túnel SSH, abrir http://localhost:8080 na máquina administrativa e preservar exatamente essa origem; não abrir a porta8080 no firewall nem usar HTTP público.
3. Preencher os três segredos obrigatórios no arquivo local e dar chmod600. Não registrar segredos. Manter INTEGRATION_ENABLED=false; não aplicar compose.dev.integration.yaml nesta preparação.
4. Construir/subir com nome exclusivo: `docker compose -p NOME_EXCLUSIVO -f compose.dev.yaml up -d --build --wait`. O banco tem health check; migrate aplica as migrações e deve terminar com código0; somente depois inicia API, cujo health check libera web. Falta de segredo obrigatório impede a interpolação do Compose.
5. Confirmar logs/status antes de primeiro acesso: `docker compose -p NOME_EXCLUSIVO -f compose.dev.yaml ps -a`; `docker compose -p NOME_EXCLUSIVO -f compose.dev.yaml logs --tail=100 migrate api`. Concluir primeiro acesso/troca obrigatória se a API criou o administrador temporário nesse banco vazio, mantendo o mesmo projeto/arquivo.
6. Ensaiar login/consulta/uma operação sintética/estorno com autorização, saída concorrente pelos testes automatizados e integração desabilitada503. Reiniciar a pilha privada e conferir persistência do volume do projeto e checksums das migrações. Não apagar volume nem banco existente para repetir ensaio; usar outro projeto novo.

Cada comando Compose, inclusive bootstrap/logs/parada, deve repetir o mesmo `-p` e `-f`; omiti-los pode selecionar outra pilha. Sem acesso à API/banco pela internet. Interromper com down do projeto exclusivo, sem -v; isso preserva o volume para inspeção. Nenhuma rotina desta entrega apaga volumes.

## Configuração semelhante à implantação pública futura

O compose.yaml é a referência de runtime em produção: usuário node, filesystem da API somente leitura, segredos externos e rede interna para API/DB; Nginx é o único ponto público. Migrações são explícitas antes da API, não um side effect do health check. Imagens Node/PostgreSQL/Nginx têm versões fixadas; validar disponibilidade/digests e política de atualização no servidor, sem alterar versões nesta tarefa.

Domínio, DNS, certificados e configuração efetiva do proxy só serão tratados em janela autorizada. Seguir [operations.md](operations.md) para HTTPS inicial, health checks, renovação e backup/restore. compose.dev é apenas para ensaio privado em loopback; não transformar NODE_ENV=development em serviço público.

## Backup e restauração

O scripts/backup.sh permanece voltado ao compose.yaml, no projeto operacional padrão. Não presumir que ele usa um compose.dev ou um projeto -p diferente. Para futura homologação, executar dump/restore contra os serviços e projeto de teste explicitamente escolhidos, com arquivo protegido, checksum e pg_restore --exit-on-error, seguindo o procedimento isolado de operations.md. Nunca testar restore no volume habitual.

Somente considerar backup validado após restauração isolada, contagens, soma global/local, estornos e versão de migrações conferidos. Binários auxiliares nativos disponíveis nesta máquina não incluem pg_dump/pg_restore; nenhum ensaio de restauração foi realizado nesta revisão.

## Logs técnicos

Falhas HTTP geram uma linha JSON em stderr via console existente: timestamp, operation (família fixa), category, status, requestId UUID interno e databaseCode SQLSTATE quando disponível. Categorias distinguem validação, autenticação, autorização, conflito, não encontrado, limite, indisponibilidade e falha interna. Sucessos não geram logs de falha. O identificador é interno, não vem de header do cliente e não altera a API; não é incluído em resposta nem na auditoria.

Não são registrados URL/query/IDs de rota, corpo, cookies, Authorization, nomes de usuários, mensagens SQL ou stacks. A ausência desses dados é intencional. Os status/mensagens públicos existentes não mudaram. Falhas de startup/migrate usam operation e nomes de variáveis ausentes (no startup) e SQLSTATE, sem valores de configuração.

Consultar `docker compose logs --since=10m api` no projeto correto; agrupar por requestId para acompanhar a requisição técnica e por categoria/operação para identificar a área da falha. Diagnóstico técnico não substitui audit_log: para identificar uma operação confirmada, usar a trilha de auditoria e, na integração, o resultado pela chave de idempotência em ambiente autorizado. Não há log de acesso completo ou centralizador novo.

A rotação json-file já está configurada no compose.yaml (10m x3 por serviço). Definir retenção/acesso do servidor e monitorar 5xx, disco, backups e certificados. Não expor logs em endpoint público.

## Recomendações fora do escopo

- Discutir política para o arquivo de origem já versionado em tests; não apagado nesta revisão.
- Futuro health check de prontidão de schema: hoje verifica conectividade SELECT1, não comprova migrações. Alterar seu comportamento seria mudança funcional; não foi feito.
- paginação SQL das localizações da integração: hoje lista e pagina em memória. Alterar a consulta exige ensaio de equivalência e demanda medida; nesta manutenção apenas as buscas locais repetidas foram substituídas por Map.
- Revisar escolha de digests de imagens e retenção/recuperação no servidor, após ensaio real; nenhuma alegação de ganho percentual ou prontidão para produção.
- Plugin/interface GLPI, validação interna de acesso ao chamado, credenciais reais e homologação continuam separados.

A opção false acima é uma desativação explícita para esse ensaio isolado. O padrão geral agora é habilitado; veja [primeiro acesso](primeiro-acesso.md).
