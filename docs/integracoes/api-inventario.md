# Inventário HTTP e consumidores — 27/10/2026

Base conferida: commit 3f9f41b; todos os caminhos abaixo incluem o prefixo `/api`. Nenhum endpoint removido/renomeado. O contrato detalhado da integração é único: [OpenAPI](integration-v1.openapi.json). Neste inventário, **P** = `{items,total,page,limit}`, page padrão1 (1..100000), limit padrão50 (1..100). **S** = sessão individual ativa; escritas exigem Origin e CSRF. **I** = Bearer revogável, integração explicitamente habilitada. Erros do filtro mantêm statusCode/message e campos aditivos code/requestId; X-Request-Id disponível no HTTP. Não registrar headers/corpos/URLs com segredos.

## Integração: plugin PHP e simulador local

| Método/caminho | Consumidor | Autenticação | Entrada | Sucesso | Erros esperados |
|---|---|---|---|---|---|
| GET /integration/v1/products | ação search, simulador | I/read | q máx200; page/limit; availability all(default)/positive; status todos(default)/ativo/inativo/abertura_pendente | 200 P; id,description,unit,active,legacyId,quantity,openingDate,locations |400/401/403/503/500|
| GET /integration/v1/product-options | product_options | I/read | sem parâmetros |200 categories/subcategories com IDs, name,active e category_id |401/403/503/500|
| GET /integration/v1/product-matches | matches | I/read | description 1..2000; page/limit |200 P + candidateIds completos; candidatos incluindo inativos/zero |400/401/403/503/500|
| GET /integration/v1/products/:id/balances | balances | I/read | UUID |200 productId,unit,active,openingDate,total,locations |400/401/403/404/503/500|
| GET /integration/v1/locations | cliente API/diagnóstico | I/read | page/limit; purpose entrada |200 P de armários ativos (sem quantity na consulta global) |400/401/403/503/500|
| GET /integration/v1/products/:id/locations | locations | I/read | UUID; page/limit; purpose entrada(default)/saida |200 P; quantity por armário; entrada inclui ativo sem associação |400/401/403/404/503/500|
| POST /integration/v1/products | execute produto, simulador | I/products:write + vínculo funcionário | Idempotency-Key; description,categoryId?,subcategoryId?,active,unit?=unidade,externalUserId; duplicateConfirmation? |201 {id}; base zero sem quantidade |400/401/403/409/503/500|
| POST /integration/v1/movements | execute movimento, simulador | I/movements:write + vínculo funcionário | Idempotency-Key; productId,kind entrada/saida,quantity string,eventDate,locationId,reason,ticketId,externalUserId,observation? |201 MovementResult e externalReference |400/401/403/404/409/503/500|
| GET /integration/v1/operations/:key | recover | I/read | chave ASCII1..120 |200 idempotencyKey,instanceId,operation,result,created_at |400/401/403/404/503/500|
| GET /integration/v1/tickets/:ticketId/movements | history | I/read | ID textual1..200; flow?; page/limit |200 P; somente operacional dessa instância/chamado, inclui estornos vinculados |400/401/403/503/500|

O plugin envia automaticamente status=ativo e availability=positive; a opção de ampliar usa all. O default da API permanece all/todos por compatibilidade com clientes antigos. Cadastro rápido real: Descrição, Categoria, Subcategoria, Situação; unidade implícita. A busca de duplicatas independe da disponibilidade. Código GLPI não consulta PostgreSQL diretamente.

## Dashboard: frontend/src/api.ts e main.ts

| Método/caminho | Consumidor | Auth | Entrada | Sucesso | Erros esperados |
|---|---|---|---|---|---|
| GET /health | Compose, setup HTTP | pública | nenhuma |200 {status:ok}; 503 {status:unavailable} |503 específico|
| GET /auth/csrf | inicialização/login | sessão anônima | nenhuma |200 {csrf} |500|
| POST /auth/login | login | Origin+CSRF | username,password |201 employee,csrf; renova sessão |400/401/403/429/500|
| GET /auth/me | inicialização | S | nenhuma |200 funcionário |401/500|
| POST /auth/logout | menu | S+CSRF | {} |201 {ok:true}; encerra sessão |401/403/500|
| GET /employees | tela Funcionários | S+gestão contas | nenhuma |200 lista id,username,name,active,manages_accounts |401/403/500|
| POST /employees | cadastro/edição funcionário | S+gestão contas+CSRF | id?,username,name,active,managesAccounts,password? |201 {id}; revoga sessões editadas |400/401/403/404/409/500|
| GET /catalog | catálogos, formulários | S | nenhuma |200 categories,subcategories,units,locations |401/500|
| GET /products | busca/telas | S | P; q,categoryId?,locationId?,status |200 P; objeto atual com snake_case e quantity |400/401/500|
| GET /product-matches | revisão duplicatas | S | description,page,limit |200 P+candidateIds |400/401/500|
| POST /products | cadastro/edição | S+CSRF | id?,description,categoryId?,subcategoryId?,unit,active,locationId?,duplicateConfirmation? |201 {id}; sem quantidade por cadastro |400/401/403/404/409/500|
| GET /products/:id/balances | detalhes/movimentos | S | UUID |200 total,locations |400/401/500|
| POST /products/:id/opening | contagem física | S+CSRF | eventDate,counts(locationId,quantity),justification |201 id?,productId,status |400/401/403/404/409/500|
| POST /movements | entrada/saída/ajuste/realocação | S+CSRF | movementSchema; destinationId em realocação |201 linha atual do movimento (quantidade interna bigint textual) |400/401/403/404/409/500|
| POST /movements/:id/reverse | histórico | S+CSRF | UUID,eventDate,justification |201 linha estorno |400/401/403/404/409/500|
| GET /overview | resumo | S | nenhuma |200 products,pending,totals |401/500|
| GET /history | histórico | S | P; flow,regime,q,productId,categoryId,subcategoryId,locationId,dateFrom,dateTo,reason,employeeId,ticket |200 P histórico operacional/legado |400/401/500|
| GET /history/filters | filtros histórico | S | nenhuma |200 employees |401/500|
| GET /locations | armários | S | q,status,page,limit |200 P com totals por unidade |400/401/500|
| GET /locations/:id/products | conteúdo armário | S | UUID,page,limit |200 lista com quantidade positiva |400/401/500|
| POST /locations | cadastro armário | S+CSRF | id?,code,name,active |201 {id} |400/401/403/404/409/500|
| POST /categories | catálogo | S+CSRF | id?,name,active |201 {id} |400/401/403/404/409/500|
| POST /subcategories | catálogo | S+CSRF | id?,name,active,categoryId |201 {id} |400/401/403/404/409/500|
| POST /units | catálogo | S+CSRF | code=unidade,name |201 {code} |400/401/403/404/500|
| GET /audit | API operacional (sem tela dedicada) | S | nenhuma |200 últimos200 eventos com autoria |401/500|
| GET /imports | importação | S | nenhuma |200 lista lotes |401/500|
| POST /imports/preview | prévia | S+CSRF | content texto JSON/JSONC |201 {id,checksum,confirmed_at,preview} |400/401/403/409/500|
| POST /imports/:id/confirm | confirmar lote | S+CSRF | UUID; acknowledgePending=true |201 confirmação/resultado |400/401/403/404/409/500|
| POST /imports/open-legacy-balances | conciliação legado | S+CSRF | {} |201 resultado da abertura legada |400/401/403/409/500|

Este inventário descreve os formatos existentes; não os uniformiza silenciosamente. Em particular, movimentos nativos continuam com sua representação interna e a integração serializa quantity decimal. Falhas conhecidas de conexão podem acrescentar 503 DEPENDENCY_UNAVAILABLE aos endpoints do filtro. Proteção CSRF continua resposta específica {message} com403.

## Scripts e fronteiras fora do HTTP

- `scripts/simulate-integration.cjs`: usa os endpoints v1 por HTTP loopback contra PostgreSQL descartável.
- `scripts/setup_graal.py` e scripts Bash: sondam /api/health; orquestram Compose explícito e helper de provisionamento. Não precisam mudar com a separação de arquivos.
- `scripts/provision-integration.cjs`: CLI administrativa, acessa PostgreSQL por conexão privada/stdin; não é endpoint HTTP e não é executado pelo frontend/plugin. Mantém credenciais/vínculos/auditoria transacionais e não cria movimentos.
- `bootstrap` e `migrate`: CLIs locais/administrativas, não endpoints. Cinco migrações existentes e seus checksums preservados.
- Plugin `ajax/endpoint.php`: POST local GLPI com sessão, acesso ao chamado e CSRF. search/product_options/matches/balances/locations/history chamam API; prepare/execute/recover orquestram intenções; intent/intents consultam armazenamento GLPI. `GlpiIntentStore::recent` usa somente tabelas locais GLPI.
- Assets JS/CSS/SVG: servidos pelo GLPI; não são endpoints do dashboard. Falhas instaladas de cache, empacotamento, permissões de arquivos ou URLs precisam de evidência própria.
