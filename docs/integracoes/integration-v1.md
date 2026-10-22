# Dashboard preparado para integração — contrato v1

Esta entrega prepara somente o Dashboard Graal. Não instala plugin, não valida permissões internas de GLPI, não contata GLPI (inclusive 11.0.5), não configura webhook e não contém credenciais reais. Compatibilidade com uma versão de GLPI será verificada na etapa futura do plugin.

## Arquitetura e limites

Base: `/api/integration/v1`. Controller separado para estabilizar o contrato de serviço e evitar autenticar por sessão. Usa o mesmo `StockService.move` do dashboard e o mesmo `ProductService.save` extraído do controller atual. A transação externa inclui lançamento, ledger, auditoria e resultado idempotente. Consulta de histórico reaproveita `queryHistory`, restrita à instância/chamado. Busca aprimorada fica limitada ao contrato de integração; busca e fluxos pessoais anteriores mantêm seus parâmetros/comportamento.

Sem estoque paralelo, edição de saldo, importação, aprovação de abertura, ajuste ou estorno pela API de integração v1. Estorno continua pelo fluxo autenticado do dashboard e aparece vinculado na consulta por chamado. Cadastro não gera estoque, abertura ou produto automaticamente a partir de uma busca vazia. O legado fica fora do ledger; a estratégia atual de abertura permanece inalterada.

## Ativação e autenticação

`INTEGRATION_ENABLED=false` é o padrão, inclusive se a variável não existir. Somente o texto exato `true` habilita. A migração 005 cria tabelas vazias; clientes novos são inativos por padrão. Nenhum segredo é lido de `.env` para esta autenticação: o banco guarda apenas SHA-256 de segredo aleatório de 256 bits, identificação do cliente, instância, permissões e validade obrigatória. SHA-256 é usado para segredo de alta entropia; senhas pessoais continuam Argon2.

Formato: `Authorization: Bearer <uuid-do-cliente>.<segredo-hex-64>`. Os placeholders não são credenciais. Transporte HTTPS é obrigatório na futura publicação; HTTP é usado exclusivamente nos testes em loopback. Nenhum token/cookie deve ir em query string ou logs. Não há CORS/browser plugin nesta etapa: o futuro servidor do plugin fará a chamada. Cookies pessoais não autenticam integração e essas rotas não criam/leem sessões; apenas nelas o CSRF por cookie não se aplica. Nas rotas pessoais, sessão e CSRF permanecem obrigatórios e Bearer não os substitui.

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

Quantidade é **string decimal com ponto**, sem milhar, vírgula ou exponencial. `2.000` significa duas unidades. Banco usa bigint de milésimos, sem float. Regra vigente: somente `unidade` e quantidades inteiras positivas; `1.5` e `metro` são rejeitados. Máximo 9000000000000 unidades. Retorno canônico sempre com três casas. Não somar legado ao saldo; produto sem abertura não pode ser movimentado. Uma saída valida todos os fechamentos posteriores por localização.

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

O simulador sobe sua própria API em porta aleatória de loopback, cria fixtures e uma credencial efêmera e a revoga ao terminar. Demonstra cadastro explícito, busca, abertura zero de fixture, entrada de 2, replay da mesma entrada, saída de 1 e consulta de resultado/histórico. A saída esperada inclui `simulatedOnly: true`, `balance: "1.000"` e `history: 2`; IDs variam. Não imprime segredo, não depende de GLPI e não chama rede externa. As fixtures permanecem no banco descartável.

Para a futura implantação Docker, a opção precisa ser passada explicitamente ao processo da API (por exemplo `INTEGRATION_ENABLED=true` em override revisado); não é ativada automaticamente pelo .env do host. Manter desabilitada nesta etapa. Sem alteração de Nginx ou publicação nesta entrega.

Contrato legível por máquina: [OpenAPI 3.1](integration-v1.openapi.json), OpenAPI 3.1 estático. O projeto não usa Swagger em runtime; nenhuma biblioteca/interface Swagger foi instalada. Documentação descreve apenas endpoints do dashboard.
