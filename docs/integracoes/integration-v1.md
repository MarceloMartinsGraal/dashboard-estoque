# Dashboard preparado para integração — contrato v1

Contrato do backend usado pelo plugin Estoque Graal (atual 0.1.8, alvo GLPI 11.0.5). O plugin verifica acesso ao chamado; a API não contata o GLPI nem valida suas permissões internas. Homologação completa no GLPI permanece pendente. Ver [diagnóstico, arquitetura e atualização da API](api-reconstrucao.md).

## Arquitetura e limites

Base: `/api/integration/v1`. Controller separado para estabilizar o contrato de serviço e evitar autenticar por sessão. Usa o mesmo `StockService.move` do dashboard e o mesmo `ProductService.save` extraído do controller atual. A transação externa inclui lançamento, ledger, auditoria e resultado idempotente. Consulta de histórico reaproveita `queryHistory`, restrita à instância/chamado. Busca aprimorada fica limitada ao contrato de integração; busca e fluxos pessoais anteriores mantêm seus parâmetros/comportamento.

Sem estoque paralelo, edição de saldo, importação, aprovação de abertura, ajuste ou estorno pela API de integração v1. Estorno continua pelo fluxo autenticado do dashboard e aparece vinculado na consulta por chamado. Cadastro não gera estoque nem produto automaticamente a partir de uma busca vazia. Novos cadastros explícitos pela integração recebem base operacional zero na data do cadastro (America/Sao_Paulo), sem movimento/ledger; primeira entrada continua separada e confirmada. O legado fica fora do ledger; a estratégia atual de abertura permanece inalterada.

## Ativação e autenticação

Atualização30/10: variável ausente ou texto exato `true` habilita. `false` desabilita explicitamente; qualquer outro valor (inclusive vazio) falha na inicialização com erro de configuração. A migração 005 cria tabelas vazias; clientes novos são inativos por padrão. Nenhum segredo é lido de `.env` para esta autenticação: o banco guarda apenas SHA-256 de segredo aleatório de 256 bits, identificação do cliente, instância, permissões e validade obrigatória. SHA-256 é usado para segredo de alta entropia; senhas pessoais continuam Argon2.

Formato: `Authorization: Bearer <uuid-do-cliente>.<segredo-hex-64>`. Os placeholders não são credenciais. Transporte HTTPS é obrigatório na produção. HTTP é permitido em loopback e na homologação privada explicitamente configurada pelo [procedimento existente](../configuracao-automatica.md). Nenhum token/cookie deve ir em query string ou logs. Não há CORS/browser plugin nesta etapa: o servidor PHP do plugin faz a chamada. Cookies pessoais não autenticam integração e essas rotas não criam/leem sessões; apenas nelas o CSRF por cookie não se aplica. Nas rotas pessoais, sessão e CSRF permanecem obrigatórios e Bearer não os substitui.

Escopos: `read` para GET/HEAD; `products:write` para POST products; `movements:write` para POST movements. A permissão é definida na rota, não por dados do corpo. Cliente revogado (`active=false`), expirado ou segredo divergente recebe 401. Revogação/permissões/validade são reconferidas na transação de escrita, após esperar a chave, com lock compartilhado até commit. Pedidos já linearizados podem terminar antes de a revogação obter o lock; não há cancelamento retroativo.

O catálogo de produtos e o estoque são únicos e compartilhados entre instâncias autorizadas. O isolamento por instância aplica-se às referências de chamados e aos resultados idempotentes, não cria catálogos separados.

Cada cliente pertence a uma `instance_id` textual imutável por procedimento administrativo (ex.: `glpi-exemplo`). A instância vem exclusivamente da credencial, nunca do payload. Várias credenciais da mesma instância compartilham chaves/resultados; isso permite rotação. Clientes de uma mesma instância com `read` podem consultar o histórico/resultados dessa instância. Para isolamento adicional, crie outra instância. Não há validação de acesso por chamado dentro do GLPI nesta entrega.

## Vínculo explícito e administração futura

`external_employee_links(instance_id,external_user_id,employee_id,active)` resolve o usuário externo para um funcionário ativo. IDs externos são texto, sensíveis a caixa, preservam zeros e não são associados por nome. São recusados espaços nas pontas e caracteres de controle. Não há conta técnica como autor. POST products e POST movements exigem o vínculo ativo. A auditoria inclui cliente/instância/usuário/chamado; o lançamento registra o funcionário efetivo.

Não foi criada tela nem endpoint administrativo. Procedimento futuro, executado por administrador autorizado com acesso local protegido ao banco:

1. Confirmar a instância e os IDs externos por fonte administrativa confiável e conferir o UUID do funcionário. O servidor do futuro plugin deve validar a sessão do usuário e acesso ao chamado **antes** de solicitar a operação. O dashboard confia nessa declaração apenas após autenticar e autorizar o cliente; não afirma ter consultado o GLPI.
2. Gerar segredo aleatório de 32 bytes em ferramenta segura/gestor de segredos. Calcular SHA-256 sobre a representação hexadecimal ASCII (64 caracteres minúsculos), não sobre bytes decodificados. Não usar senha humana. Não enviar segredo ao chat, terminal gravado ou Git. Esse procedimento não foi executado para contas reais.
3. Inserir cliente inicialmente inativo com instância, nome administrativo, hash, escopos mínimos e `expires_at`. Conferir e aprovar antes de ativá-lo. Instalar o token completo somente no armazenamento secreto do futuro servidor do plugin.
4. Inserir vínculo explícito; auditar a decisão administrativa com funcionário administrador e IDs (sem hash/token). Para alterar vínculo, auditar antes/depois, sem reescrever autoria antiga. Desativar vínculo com `active=false` bloqueia novas escritas/replays. Consultas de resultados exigem escopo read; não dependem de vínculo ativo, para permitir conciliação.
5. Rotacionar criando outro cliente na mesma instância, validar no ambiente apropriado e revogar o anterior. Não alterar instance_id de um cliente existente. Não trocar funcionário/instância para contornar histórico ou idempotência. Revogar imediatamente em suspeita de exposição.

SQL ilustrativo com variáveis do psql preenchidas de forma protegida **no futuro** (não executar com placeholders; esta entrega não os executa):

```sql
BEGIN;
INSERT INTO integration_clients(instance_id,name,token_hash,scopes,expires_at)
VALUES (:'instancia', :'nome_administrativo', :'sha256_hex',
        ARRAY['read','movements:write'], :'validade'::timestamptz)
RETURNING id; -- inativo até revisão; nunca retorna segredo
INSERT INTO external_employee_links(instance_id,external_user_id,employee_id)
VALUES (:'instancia', :'usuario_externo', :'funcionario_uuid'::uuid);
-- Registrar decisão em audit_log com actor_id do administrador e sem segredos.
COMMIT;
-- Depois de conferir e aprovar:
-- UPDATE integration_clients SET active=true WHERE id=:'cliente_uuid'::uuid;
-- Revogação: UPDATE integration_clients SET active=false WHERE id=:'cliente_uuid'::uuid;
```

Não apagar operações idempotentes para reutilizar chaves. Elas são imutáveis e devem acompanhar o período de retenção do histórico. O ledger e o resultado comprometidos não podem ser alterados silenciosamente.

## Endpoints

| Método | Caminho relativo à base | Escopo | Resultado |
|---|---|---|---|
| GET | `/products?q=memoria&page=1&limit=50` | read | Produtos, inclusive inativos/sem saldo; busca parcial por descrição, código legado ou UUID, sem caixa/acentos portugueses |
| GET | `/products/{id}/balances` | read | Total e distribuição operacional com UUID/código/nome/ativo dos armários |
| GET | `/locations?page=1&limit=50` | read | Armários ativos para entrada, sem exigir histórico do produto |
| GET | `/products/{id}/locations?purpose=entrada` ou `saida` | read | Ativos; saída somente com saldo positivo, entrada todos com saldo atual ou zero |
| POST | `/products` | products:write | Cadastro explícito sem saldo, resposta `{id}` |
| POST | `/movements` | movements:write | Entrada/saída e referência externa, funcionário efetivo |
| GET | `/operations/{key}` | read | Operação, resultado original e instante, no escopo da instância |
| GET | `/tickets/{ticketId}/movements` | read | Histórico operacional vinculado, incluindo estornos; `flow` opcional |

Listas: `items,total,page,limit`. `page` inteiro 1..100000, padrão 1; `limit` inteiro 1..100, padrão 50. Ordenação estável por descrição/UUID (produtos), código/UUID (armários) e data/UUID decrescente (histórico). Busca `q` até 200 caracteres, sem expansão de curingas. Consulta de resultados nunca executa operação. Em caso de timeout ainda pendente, 404 pode significar que o commit não ocorreu/ainda não ficou visível; repetir o **mesmo** pedido/chave é seguro.

## Payloads e quantidades

POST exige `Idempotency-Key`: 1..120 caracteres ASCII alfanuméricos ou `._:-`. Chave escopada por instância e compartilhada entre tipos de operação: reutilizar chave de cadastro para movimento é conflito. Mesma chave/conteúdo normalizado retorna exatamente o resultado original (inclusive 201); outra chave representa outra operação intencional. Ordem das propriedades não importa. Quantidade é normalizada para representação canônica; `1` e `1.000` são equivalentes. IDs externos, data, produto, motivo, localização e observação fazem parte do conteúdo. Campos desconhecidos são rejeitados.

Quantidade é **string decimal com ponto**, sem milhar, vírgula ou exponencial. `2.000` significa duas unidades. Banco usa bigint de milésimos, sem float. Regra vigente: somente `unidade` e quantidades inteiras positivas; `1.5` e `metro` são rejeitados. Máximo 9000000000000 unidades. Retorno canônico sempre com três casas. Não somar legado ao saldo; produto existente sem abertura não pode ser movimentado. Novos produtos criados pela integração recebem base zero, sem quantidade; não é necessária contagem manual para a primeira entrada. Uma saída valida todos os fechamentos posteriores por localização.

Movimento: `productId` UUID, `kind` entrada|saida, `quantity` string, `locationId` UUID, `eventDate` YYYY-MM-DD válida/não futura/não anterior à abertura, `reason` chamado|uso_interno|rma|outro|correcao_estoque|recebimento, `ticketId` texto 1..100, `externalUserId` texto 1..200, `observation` opcional até 2000. Observação obrigatória para outro/correcao_estoque; vira justificativa no mesmo serviço vigente. Chamado é obrigatório em toda escrita de movimento nesta API. Instância não é URL e é inferida da credencial. `NAO_INFORMADA` continua o UUID `00000000-0000-0000-0000-000000000001`; nunca inferir armário de legado.

Produto: `description` texto 1..2000, `active` boolean, `externalUserId` obrigatório; `unit` apenas unidade (padrão), `categoryId`/`subcategoryId` UUID ou null opcionais. Subcategoria exige categoria e referência compatível. Não aceita id, locationId, saldo, financeiro ou abertura.

## Exemplos fictícios

Autenticação em todos os exemplos: `Authorization: Bearer <UUID_DO_CLIENTE>.<SEGREDO_LOCAL_NAO_PREENCHIDO>` (valor inválido propositalmente).

Busca: `GET /api/integration/v1/products?q=mem%C3%B3ria&page=1&limit=20`.

Entrada, header `Idempotency-Key: glpi-000042-entry-exemplo`:

```json
{"productId":"11111111-1111-4111-8111-111111111111","kind":"entrada","quantity":"2","locationId":"00000000-0000-0000-0000-000000000001","eventDate":"2026-01-03","reason":"chamado","ticketId":"000042","externalUserId":"0007","observation":"Recebimento para chamado fictício"}
```

Saída: mesmo formato com `kind=saida`, quantidade `1`, localização com disponibilidade e **outra** chave, por exemplo `glpi-000042-exit-exemplo`. Não enviar automaticamente ao falhar a busca.

Consultar após timeout: `GET /api/integration/v1/operations/glpi-000042-exit-exemplo`. Resultado `{idempotencyKey,instanceId,operation,result,created_at}`. O resultado da movimentação contém `id,productId,kind,quantity,eventDate,recordedAt,actorId,locationId,reason,observation,externalReference`. A referência inclui instanceId/ticketId/externalUserId e conserva zeros.

Histórico: `GET /api/integration/v1/tickets/000042/movements?limit=20&page=1`. Sem flow retorna todas as direções vinculadas; flow entrada/saida filtra direção, incluindo a inversão de estorno. O parâmetro de consulta `ticketId` aceita até 200 caracteres; no cadastro de movimento o limite é 100, conforme o campo de chamado operacional. Chamado sem registros vinculados retorna uma lista vazia, não 404. Campo `externalReference` acompanha original e estorno; `reversal_of`/`reversed_by`, autor efetivo e deltas de localização são preservados. Não filtra pelo texto livre do chamado de movimentos pessoais: exige vínculo externo estruturado.

## Erros

Envelope Nest existente: `{statusCode,message}`; mensagens portuguesas, sem stack/credenciais. Falha de CSRF pessoal continua com seu envelope anterior. As respostas devem ser tratadas por status e não comparação de texto.

| Status | Exemplos |
|---|---|
| 400 | Campos/quantidade/data inválidos, chave ausente/inválida, motivo que exige observação, purpose saída sem produto |
| 401 | Bearer ausente/inválido/revogado/expirado; alteração de hash ou perda de permissão detectada na transação após espera |
| 403 | Escopo insuficiente; usuário sem vínculo ativo ou funcionário inativo |
| 404 | Produto inexistente no catálogo compartilhado ou operação inexistente na instância autenticada. Chamado sem movimentos vinculados retorna 200 com lista vazia |
| 409 | Saldo insuficiente, produto inativo/abertura pendente, chave usada com conteúdo diferente ou referência cadastral conflitante |
| 503 | Integração desabilitada |
| 500 | Falha interna genérica; consultar resultado antes de decidir nova operação |

Nenhuma falha de validação/saldo deixa baixa parcial ou chave reservada. Concorrência da mesma chave é serializada por advisory lock transacional e protegida por PRIMARY KEY `(instance_id,idempotency_key)`. Chaves distintas disputam o lock do produto usado pelo dashboard; uma saída perdedora reverte operação/ledger/auditoria. Não há promessa de validação de acesso ao GLPI.

## Testar somente localmente

Aplicar 005 em produção **não foi autorizado nem executado**. Para desenvolvimento existente, revisar o destino antes de executar `npm run build` e `npm run migrate`; migrações devem ser aplicadas somente em banco local/de testes nesta etapa. Não recriar volumes. Sem 005 e com integração desabilitada as novas rotas retornam 503; habilitar exige primeiro a migração.

### Teste rápido em PowerShell

Pré-requisitos: Node e dependências do projeto instalados; PostgreSQL local em execução; banco **descartável vazio**, com nome terminado em `_test`. A URL deve usar `localhost`, `127.0.0.1` ou `[::1]`. Crie um banco vazio para cada execução da suíte: algumas fixtures usam identificadores fixos e não são projetadas para repetir a suíte sobre o banco já preenchido.

Na raiz do repositório:

```powershell
$env:TEST_DATABASE_URL = Read-Host 'URL do PostgreSQL local descartável (banco terminado em _test)'
npm test
# Depois de a suíte passar:
node scripts/simulate-integration.cjs
```

Informe a URL apenas no terminal local; não a envie ao chat nem a registre no Git. `npm test` compila o backend e executa a suíte completa, incluindo `tests/integration.test.cjs`. Para executar somente os testes da integração em outro banco descartável vazio:

```powershell
npm run build:backend
node --test tests/integration.test.cjs
```

Os testes e o simulador aplicam as migrações automaticamente **nesse banco de testes**; não é necessário iniciar `npm start`, usar `.env`, habilitar a integração da aplicação operacional ou cadastrar credenciais manualmente. Não use sua base operacional.

O simulador sobe sua própria API em porta aleatória de loopback, cria fixtures e uma credencial efêmera e a revoga ao terminar. Demonstra cadastro explícito, busca, base zero do cadastro, entrada de 2, replay da mesma entrada, saída de 1 e consulta de resultado/histórico. A saída esperada inclui `simulatedOnly: true`, `balance: "1.000"` e `history: 2`; IDs variam. Não imprime segredo, não depende de GLPI e não chama rede externa. As fixtures permanecem no banco descartável.

Os Compose de produção/dev/homologação encaminham a variável ao processo com padrão true, preservando false explícito e valores inválidos. Habilitar continua exigindo credenciais/escopos/vínculos; não configura o plugin nem publica serviços automaticamente. Veja [primeiro acesso/configuração](../primeiro-acesso.md).

### Credencial local de teste no Docker de desenvolvimento

Passo a passo para chamar a API pelo `compose.dev.yaml` (`http://localhost:8080`), como faria o futuro servidor do plugin. Somente para o banco **local** de desenvolvimento: nunca execute contra produção. Cliente, vínculo e auditoria ficam gravados no banco local (a auditoria é imutável); escritas pela API criam registros reais nesse banco. Procedimento validado em pilha descartável em 22/10/2026.

Use um único terminal PowerShell, na raiz do repositório, do início ao fim: o segredo fica só em variáveis da sessão e não é exibido.

**1. Subir a pilha com a integração habilitada.** O Compose já habilita por padrão; o override legado continua compatível e respeita false explícito. A migração005 cria o contrato e007 protege o primeiro acesso; o serviço migrate aplica as pendentes. Não use `down -v`.

```powershell
docker compose -f compose.dev.yaml -f compose.dev.integration.yaml up -d --build --wait
```

Sem o override, as rotas `/api/integration/v1` retornam 503.

**2. Preparar o acesso ao banco local.** A função envia SQL pela entrada padrão ao `psql` do contêiner `db`, com o usuário dono definido no `.env`. `$OutputEncoding` preserva acentos no envio.

```powershell
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Sql([string]$s) { $s | docker compose -f compose.dev.yaml exec -T db sh -c 'psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' }
Sql "SELECT id, username, name, manages_accounts FROM employees WHERE active ORDER BY username;"
```

**3. Definir instância, usuário externo e funcionários.** Copie os UUIDs da lista anterior. `$funcionario` é quem constará como autor das operações vindas do usuário externo; `$admin` é o responsável (`manages_accounts = t`) que registra a decisão na auditoria. O usuário externo é texto exato, com zeros preservados.

```powershell
$instancia = 'glpi-local-teste'
$usuarioExterno = '0007'
$funcionario = 'UUID-DO-FUNCIONARIO'
$admin = 'UUID-DO-RESPONSAVEL'
```

**4. Gerar o segredo e o hash.** 32 bytes aleatórios em hexadecimal minúsculo; o hash é SHA-256 do texto hexadecimal ASCII. Não imprima `$segredo`.

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$segredo = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$hash = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($segredo)) | ForEach-Object { $_.ToString('x2') })
```

**5. Cadastrar cliente inativo, vínculo e auditoria** numa única transação. Escopos completos e validade de 7 dias; reduza conforme o teste. Retorna somente o UUID do cliente.

```powershell
$clienteId = Sql @"
\set instancia '$instancia'
\set usuario '$usuarioExterno'
\set funcionario '$funcionario'
\set admin '$admin'
\set hash '$hash'
BEGIN;
WITH c AS (
  INSERT INTO integration_clients(instance_id,name,token_hash,scopes,expires_at)
  VALUES (:'instancia', 'GLPI local de teste', :'hash',
          ARRAY['read','products:write','movements:write'], now() + interval '7 days')
  RETURNING id),
l AS (
  INSERT INTO external_employee_links(instance_id,external_user_id,employee_id)
  VALUES (:'instancia', :'usuario', :'funcionario'::uuid)),
a AS (
  INSERT INTO audit_log(actor_id,action,entity,entity_id,details)
  SELECT :'admin'::uuid, 'integration_client_create', 'integration_client', c.id::text,
         jsonb_build_object('instanceId', :'instancia', 'externalUserId', :'usuario',
                            'employeeId', :'funcionario', 'scopes', 'read,products:write,movements:write',
                            'ambiente', 'local-teste')
  FROM c)
SELECT id FROM c;
COMMIT;
"@
$clienteId
```

Se o vínculo `(instância, usuário externo)` já existir, a transação inteira é desfeita; escolha outro usuário externo ou reutilize o vínculo existente, removendo o `l AS (...)`.

**6. Conferir e ativar.** Enquanto inativo, qualquer chamada retorna 401. Revise o cliente e então ative, registrando a ativação.

```powershell
Sql "SELECT id, instance_id, scopes, active, expires_at FROM integration_clients WHERE id = '$clienteId';"
Sql @"
\set cliente '$clienteId'
\set admin '$admin'
BEGIN;
UPDATE integration_clients SET active = true WHERE id = :'cliente'::uuid;
INSERT INTO audit_log(actor_id,action,entity,entity_id,details)
VALUES (:'admin'::uuid, 'integration_client_activate', 'integration_client', :'cliente', '{"ambiente":"local-teste"}');
COMMIT;
"@
```

**7. Chamar a API.** O token é `<uuid-do-cliente>.<segredo>`. Leituras não alteram dados:

```powershell
$base = 'http://localhost:8080/api/integration/v1'
$h = @{ Authorization = "Bearer $clienteId.$segredo" }
Invoke-RestMethod "$base/locations?limit=20" -Headers $h
Invoke-RestMethod "$base/products?q=mem%C3%B3ria&limit=20" -Headers $h
Invoke-RestMethod "$base/tickets/000042/movements" -Headers $h
```

Escritas exigem `Idempotency-Key`; repetir a mesma chave e o mesmo corpo devolve o resultado original sem duplicar. Exemplo de cadastro sem estoque, que gera um produto real no banco local:

```powershell
$json = @{ description = 'Produto de teste da integração'; active = $true; externalUserId = $usuarioExterno } | ConvertTo-Json
$prod = Invoke-RestMethod "$base/products" -Method Post -Headers ($h + @{ 'Idempotency-Key' = 'local-produto-001' }) -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
Invoke-RestMethod "$base/products/$($prod.id)/balances" -Headers $h
Invoke-RestMethod "$base/operations/local-produto-001" -Headers $h
```

Entradas e saídas (`POST /movements`, corpo na seção [Exemplos fictícios](#exemplos-fictícios)) só funcionam em produto com abertura aprovada e alteram o saldo local de forma permanente; correções são feitas por estorno no dashboard.

**8. Revogar e limpar a sessão** ao terminar. Cliente revogado recebe 401 imediatamente; o registro não é apagado.

```powershell
Sql @"
\set cliente '$clienteId'
\set admin '$admin'
BEGIN;
UPDATE integration_clients SET active = false WHERE id = :'cliente'::uuid;
INSERT INTO audit_log(actor_id,action,entity,entity_id,details)
VALUES (:'admin'::uuid, 'integration_client_revoke', 'integration_client', :'cliente', '{"ambiente":"local-teste"}');
COMMIT;
"@
Remove-Variable segredo, hash, h, bytes
```

O token deixa de existir ao fechar o terminal. Para testar de novo, repita a partir do passo 4 criando outro cliente na mesma instância (o vínculo do passo 5 já existe: remova o `l AS (...)`). Credenciais de homologação ou produção seguem o procedimento administrativo da seção [Vínculo explícito e administração futura](#vínculo-explícito-e-administração-futura), com segredo guardado no gestor de segredos do servidor do plugin.

Contrato legível por máquina: [OpenAPI 3.1](integration-v1.openapi.json), OpenAPI 3.1 estático. O projeto não usa Swagger em runtime; nenhuma biblioteca/interface Swagger foi instalada. Documentação descreve apenas endpoints do dashboard.

### Base zero para produtos novos da integração

A partir da correção entregue com o plugin 0.1.1, POST /products registra `opening_date` na data local do cadastro (America/Sao_Paulo), na mesma transação e com auditoria `inicializar_base_zero`. Não cria movimento ou lançamento no ledger e a resposta permanece `{id}`. Consulte balances para obter `openingDate`; primeira entrada usa POST /movements separado, com nova chave e confirmação. Quantidade não é aceita no cadastro. O replay do cadastro devolve o mesmo produto sem reinicialização. Nenhuma regra é inferida por ausência de histórico: só o novo INSERT deste endpoint recebe base zero. Produtos existentes, edições e importações permanecem inalterados. Abertura posterior é bloqueada, evitando somar contagem à entrada. Não há migração nem backfill.

### Revisão de possíveis duplicatas (plugin 0.1.4)

Endpoints aditivos: `GET /api/product-matches` (sessão dashboard) e `GET /api/integration/v1/product-matches` (credencial, escopo read). Ambos aceitam description (1..2000), page e limit (padrão50/máximo100). Retornam items/total/page/limit e candidateIds de **todos** os candidatos, independentemente da página. Incluem inativos e saldo zero, descrição original, UUID, unidade, saldo, categoria/subcategoria, ID legado e estado de abertura; marca/modelo/part number não possuem campos próprios neste projeto, só podem constar no texto.

Comparação central: caixa/acentos, tokens sem ordem, espaços e números com unidade (8GB/8 GB). Termos de ligação e RAM opcional são ignorados. Candidato se os tokens forem iguais ou compartilharem ao menos2 tokens e50% do menor conjunto. exact significa tokens iguais, não equivalência técnica. technicalDifferences sinaliza divergências numéricas e termos reconhecidos como DDR, notebook/desktop, novo/usado, kit/avulsa, DIMM, SATA/NVMe. É heurística de alerta, não catálogo técnico nem prova de que produtos são iguais; falsos positivos/negativos são possíveis. Textos originais não mudam.

POST /products preserva seus campos e resposta `{id}`. Campo opcional `duplicateConfirmation: {candidateIds: UUID[], justification: string5..500}` permite confirmar produto distinto. Havendo candidatos sem confirmação correspondente, retorna409 com mensagem de revisão (o envelope HTTP permanece statusCode/message) e exige revisão; candidato surgido entre consulta e gravação invalida a lista antiga. Sem candidatos, os clientes existentes continuam cadastrando normalmente. Alteração comportamental intencional: clientes que tentam cadastrar possível duplicata recebem409 e precisam revisar; não há fusão, reativação ou unicidade global de descrição.

O serviço ProductService atende dashboard e integração, reconsulta no mesmo contexto transacional e serializa criações normais por advisory lock PostgreSQL. Auditoria confirmar_produto_distinto guarda IDs revisados e justificativa de negócio: não incluir dados pessoais ou segredos. Edições/importações preservam políticas existentes; não há limpeza automática de legado. IDs internos não são fornecidos em criação e source/legacy_id não são campos graváveis pela integração; a constraint única existente (source,legacy_id) permanece, inclusive em concorrência. Não existe campo público de part number para bloquear por ele. Idempotência da integração continua distinguindo replay da mesma chave de nova tentativa: replay retorna o cadastro anterior, nova chave passa novamente pela revisão.

O detector percorre todo o catálogo na aplicação e pagina depois de comparar, sem índice/extensão nova; adequado ao catálogo atual, com custo proporcional ao tamanho. Catálogos muito maiores exigem avaliação de desempenho. Falha na consulta bloqueia o cadastro; nunca é interpretada como ausência de correspondências.

### Busca disponível e cadastro rápido — plugin0.1.7

GET /products aceita parâmetros **opcionais** availability=all|positive (padrão all) e status=todos|ativo|inativo|abertura_pendente (padrão todos). positive exige ativo e SUM(ledger.delta)>0 antes de COUNT/LIMIT/OFFSET; não usa histórico legado. Ordenação permanece description/id. Parâmetros omitidos preservam a busca anterior; o dashboard não passa availability e continua com seu comportamento. Cada item retorna também locations: distribuição operacional positiva com id/code/name/active/quantity, ordenada por code/id, para mostrar armários no cartão sem uma consulta extra por produto.

O plugin aplica automaticamente status=ativo e availability=positive em toda pesquisa inicial/manual/paginada. Incluir produtos sem saldo, inicialmente desmarcada, muda somente availability para all (mantém ativos). Quando não há resultados, oferece pesquisar também sem saldo antes do cadastro. product-matches permanece independente e consulta todo o catálogo, inclusive inativos/zerados.

GET /product-options, escopo read, retorna categories e subcategories (id/name/active, mais category_id para subcategorias), ordenadas por name/id. Usa o catálogo real sem gravar dados, inclusive classificações inativas como o formulário existente do dashboard. Não há campos novos no produto: POST /products já aceita description, categoryId, subcategoryId e active, com unit implícito unidade. Categoria/subcategoria vazias viram null. Subcategoria exige categoria e a FK composta existente garante o par compatível. Sem endpoints administrativos adicionais, migração ou alteração de escopos.


## Revisão compatível 1.0.1 do contrato — 27/10/2026

Endpoints e respostas de sucesso v1 preservados. A organização interna está em `backend/src/integration/`; `integration.ts` mantém os exports existentes. Leituras compostas de busca, saldos e armários usam transação PostgreSQL REPEATABLE READ READ ONLY: contagem, página e distribuição são do mesmo snapshot. Recarregar é uma nova leitura, que pode mostrar movimentos posteriores.

Erros do filtro HTTP mantêm `statusCode` e `message` e acrescentam `code` e `requestId`. Header `X-Request-Id` também acompanha sucessos, CSRF e health. O log sanitizado do backend contém o mesmo requestId dos erros; procure-o no log do serviço API. O requestId do endpoint PHP identifica outra requisição e não deve ser confundido com este.

Exemplo fictício: `{"statusCode":409,"message":"Possíveis duplicatas encontradas...","code":"PRODUCT_CANDIDATES","candidateIds":["11111111-1111-4111-8111-111111111111"],"requestId":"22222222-2222-4222-8222-222222222222"}`. Nunca envie credenciais ao solicitar diagnóstico. O filtro permite somente metadados conhecidos; SQL, stack e mensagens brutas do banco não saem na resposta.

Códigos: INVALID_INPUT(400), UNAUTHENTICATED(401), FORBIDDEN(403), NOT_FOUND(404), CONFLICT ou PRODUCT_CANDIDATES(409), PAYLOAD_TOO_LARGE(413), RATE_LIMITED(429 quando aplicável), SERVICE_UNAVAILABLE(503, integração desabilitada), DEPENDENCY_UNAVAILABLE(503, conexão/dependência reconhecida) e INTERNAL_ERROR(500). Não há limitador novo da integração: o 429 existente pertence ao login pessoal. O middleware CSRF mantém sua resposta específica com `message`; health mantém `status`. Os cabeçalhos de correlação estão presentes em ambos.

GET operations retorna 404 enquanto a transação ainda não confirmou e também para uma chave inexistente na instância. Isso não comprova rejeição de uma escrita cujo resultado se perdeu. Aguarde e consulte novamente; mantenha a mesma intenção/chave e o fluxo atual de recuperação. POST simultâneo com mesma chave espera o lock, revalida autorização e retorna o resultado original após commit. Sem reservas parciais persistidas, sem nova chave automática. Uma falha na consulta continua sendo falha, nunca lista vazia.

Atualizar apenas o backend é suficiente para esta revisão; plugin 0.1.8 aceita os campos aditivos e mantém seu tratamento de erros. Nenhuma migração nova. Procedimento de atualização/recuperação e limites de testes: [api-reconstrucao.md](api-reconstrucao.md).

Administrador ou funcionário com must_change_password=true não pode provisionar credencial/vínculo nem operar pela integração. Contas existentes recebem false na migração007, sem alteração de senha.
