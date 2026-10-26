# Estoque Graal

Sistema de estoque único, com localização por armários e contas individuais. Sem módulo financeiro. Backend Node.js/TypeScript/NestJS; PostgreSQL; frontend TypeScript/HTML/CSS com Vite.

## Estado atual

Implementação inicial: autenticação, catálogo, abertura por contagem física, entradas/saídas/ajustes, realocação, estorno, histórico operacional/legado e prévia/confirmação idempotente da importação. O histórico legado fica fora do livro de saldos. Pela decisão atual, a confirmação pode criar uma abertura única pelo saldo líquido em localização não informada; negativos abrem zerados com pendência. Não há dupla contagem.

Sem commit, push, deploy, certificado real ou importação em produção realizados pelo agente. Arquivos reais da auditoria permanecem fora do repositório. Não há conta ou senha operacional padrão.

## Requisitos e versões fixadas

- Node.js **24.22.0**, linha LTS; npm incluído no Node.
- NestJS **12.2.0**, TypeScript **5.9.3**, Express **5.3.0**, Vite **8.3.5**.
- PostgreSQL **18.4**; Nginx **1.30.6** estável.
- Ubuntu Server **24.04**, Docker Engine e Docker Compose v2 para implantação futura.
- Dependências diretas sem `^`/`~`; árvore exata em `package-lock.json`. Imagens fixadas por versão; antes da publicação valide também os digests e as atualizações de segurança.

Fontes consultadas em 21/10/2026: [Node LTS](https://nodejs.org/en/about/previous-releases), [NestJS](https://docs.nestjs.com/), [PostgreSQL](https://www.postgresql.org/support/versioning/), [Vite](https://vite.dev/guide/), [Nginx estável](https://nginx.org/en/download.html). Versões dos pacotes conferidas no registro oficial npm.

## Testar localmente só com Docker

`compose.dev.yaml` sobe banco, migração, API e frontend (Nginx em HTTP) sem precisar de Node no host. Não é configuração de produção: usa `NODE_ENV=development`, sem HTTPS, e publica apenas `127.0.0.1:8080`.

Com `.env` preenchido (seção abaixo; o compose usa só `SESSION_SECRET`, `POSTGRES_PASSWORD` e `DB_APP_PASSWORD`):

```powershell
docker compose -f compose.dev.yaml up -d --build --wait
docker compose -f compose.dev.yaml run --rm --no-deps api node dist/backend/bootstrap.js
```

O segundo comando cria o primeiro responsável (interativo; só funciona com o banco sem funcionários). Abra exatamente `http://localhost:8080`; `127.0.0.1` falha na verificação CSRF de origem. Após mudar código, repita o primeiro comando. Para parar: `docker compose -f compose.dev.yaml down`; acrescentar `-v` apaga o banco local de teste.

Os scripts `.sh` e as configurações Nginx precisam de quebras de linha LF; `.gitattributes` garante isso no checkout. Com CRLF, o `init-db.sh` falha e o banco fica sem o usuário `graal_app`. Nesse caso, recrie o volume local.

## Executar localmente

Na raiz do repositório:

```powershell
Copy-Item .env.example .env
```

Preencha `.env` localmente. Gere separadamente `SESSION_SECRET`, `POSTGRES_PASSWORD` e `DB_APP_PASSWORD` com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Não envie os valores ao chat, não registre em log e não inclua `.env` no Git. Use o valor de `DB_APP_PASSWORD` também na URL `DATABASE_URL`; gere em hexadecimal para evitar problemas de codificação na URL.

Mantenha `NODE_ENV=development`, `PUBLIC_ORIGIN=http://localhost:5173`. Use exatamente esse endereço no navegador, pois a verificação CSRF confere a origem. O PostgreSQL local é publicado somente em `127.0.0.1`.

```powershell
docker compose -f compose.local.yaml up -d --wait
npm ci
npm run build
npm run migrate
npm run bootstrap
npm run dev:api
```

Em outro terminal:

```powershell
npm run dev:web
```

Abra `http://localhost:5173`. Após mudar código backend, execute `npm run build:backend`; o processo `dev:api` reinicia ao detectar o compilado atualizado.

`bootstrap` pede login, nome e senha sem eco no terminal; só funciona quando ainda não há funcionários. O primeiro responsável administra contas pela tela Funcionários. Funcionários ativos possuem operação completa. Responsáveis também administram contas; o último responsável ativo não pode ser removido dessa função. Alterações de conta revogam sessões. Senhas devem ter 12–128 caracteres; nenhuma é gerada como padrão.

Sem Docker, use PostgreSQL 18.4 local, crie um banco exclusivo e um usuário sem superusuário com permissão de criar tabelas no schema e ajuste `DATABASE_URL`. Não use o banco de produção para desenvolvimento ou testes.

## Verificações

```powershell
npm run typecheck
npm run build
```

Testes sintéticos de integração, em PostgreSQL temporário separado:

```powershell
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f compose.test.yaml down
```

O compose de testes não publica portas, usa dados temporários e credenciais exclusivamente sintéticas; não é configuração de produção. Use um projeto de testes exclusivo e limpo em cada execução. Alternativa: defina `TEST_DATABASE_URL` apontando para um banco novo e descartável cujo nome termine em `_test`; execute `npm test`. A suíte cria apenas dados sintéticos, não limpa nem substitui uma base existente. Reutilizar a mesma base de teste não é suportado; crie outra base para cada execução.

**Registro histórico da etapa inicial (não valida o checkout atual):** `npm run typecheck` e `npm run build` aprovados; 42 testes automatizados passaram em PostgreSQL real 18.4 isolado. No Edge headless, login, consulta, saída pelo formulário com conferência do saldo no banco, histórico, viewport móvel de 390 px e logout passaram sem erros JavaScript. A revisão independente direcionada teve os achados importantes corrigidos com testes. Docker/Compose, Nginx/HTTPS e restauração no Ubuntu ainda não foram executados, pois Docker não está disponível nesta máquina.

Os testes verificam precisão, abertura pendente, saldo no armário, disputa concorrente, realocação, estorno, retroatividade, autenticação, CSRF, sessão, inativação, campos extras e idempotência. Consulte `tests/` para os cenários completos.

Neste Windows foi usado PostgreSQL real **18.4** temporário em `work/`, com binários de teste obtidos por `embedded-postgres@18.4.0-beta.17`. O wrapper é apenas um auxiliar externo de testes, não é dependência da aplicação nem da implantação. O encerramento foi feito com `pg_ctl`. O caminho reproduzível oficial do projeto é `compose.test.yaml` ou `TEST_DATABASE_URL`.

## Regras importantes

- Valores da API de quantidade são texto decimal com ponto. Internamente, inteiros `bigint` representam milésimos: 1 unidade = 1000. Todos os produtos usam unidades inteiras; o metro foi descontinuado (migração `004_unidade_unica.sql` converte produtos em metro sem frações e falha se houver fração).
- Saldos são derivados do livro de lançamentos por localização; não há campo de saldo editável. A soma das localizações é o global.
- Toda operação bloqueia o produto com `SELECT ... FOR UPDATE` e grava os lançamentos numa única transação. Saídas concorrentes do mesmo produto são serializadas. Validações de fechamento por dia impedem retroatividade que torne qualquer localização negativa.
- Data do evento é `DATE`; instante de registro é `timestamptz`. Legado sem horário não recebe um horário inventado.
- Uma única abertura aprovada por produto estabelece o corte. É possível contar zero explicitamente; isso não cria uma movimentação artificial de quantidade zero. Depois da abertura, divergências exigem ajustes justificados. Abertura e estorno não são estornáveis novamente.
- Estorno tem vínculo único com o original, autoria e justificativa. Faz lançamentos inversos; se faltar saldo, é bloqueado. A correção completa é estorno mais novo lançamento.
- Produtos e funcionários podem ser inativados sem apagar histórico. Armário com saldo não pode ser inativado. “Não informada” é uma localização explícita e preservada.
- Não há estoque mínimo nem metros na interface. O campo Armário em Editar produto move todo o saldo do produto para o armário escolhido, por realocações rastreáveis (motivo “outro”, justificativa automática).
- O backend exige motivo, chamado textual quando necessário e justificativa para ajustes, correção de estoque ou outro motivo.
- A trilha registra alterações de cadastros, aberturas, movimentos, estornos e lotes. Registros de movimento, livro, legado e auditoria são imutáveis no banco pelas rotas usuais; acesso administrativo direto ao banco continua sendo responsabilidade da infraestrutura.

## Revisar a importação

1. Preserve `graal_estoque.original.json` em armazenamento protegido, com cópia e checksum. Não o inclua no Git nem o disponibilize pelo Nginx.
2. Na tela Importação, escolha o original ou a cópia organizada para **validar e gerar prévia**. Essa etapa grava só o lote saneado de revisão e a auditoria, sem cadastrar produtos nem movimentos.
3. Confira contagens, saldos históricos por produto/unidade, evidências zeradas e pendências. A cópia organizada altera somente ordem; não é homologação.
4. A confirmação exige ciência explícita das pendências. Preserva o histórico legado e cria uma única abertura pelo líquido entradas − saídas em localização não informada, com corte na última data legada. Saldo negativo abre zero e mantém pendência; não incorpora financeiro nem soma o histórico novamente ao ledger.
5. Mesmo checksum retorna o lote existente. Outro checksum com os mesmos IDs e conteúdo não duplica registros. O mesmo ID com conteúdo divergente bloqueia toda a confirmação, em vez de sobrescrever.
6. Ao confirmar a importação, cada produto legado abre com o saldo líquido do histórico (entradas − saídas) em “Localização não informada”, com data de corte igual à última data do legado. Saldos negativos abrem zerados e permanecem nas pendências. O histórico não entra no livro, então não há dupla contagem. Para lotes já confirmados, use **Abrir saldos pendentes pelo histórico já importado** na tela Importação.

JSON inválido, chaves repetidas, IDs repetidos, referências órfãs, unidades inválidas e datas inválidas são rejeitados. Apenas campos explicitamente mapeados são persistidos. `valor_unitario` e outros dados financeiros ficam exclusivamente no arquivo de origem protegido. As 25 quantidades zero permanecem como evidência no histórico legado, sem eventos operacionais. Motivos ausentes recebem `legado_nao_informado`. Chamados são texto; zeros são preservados.

Datas originais e notas de conversão disponíveis em `revisar.itens` são associadas por produto/origem. Todos os registros legados permanecem pendentes de validação; `data_estimada=false` não comprova uma data. Não são inferidos horários ou autores. Ausência de metadados originais permanece ausência explícita.

## Auditoria conferida

Origem lida fora do repositório: `Documents/ChatGPT/DASHBOARD GRAAL EMPRESA/auditoria_estoque_2026-10-21`. Foram consultados relatório, resumo, pendências, log e JSON organizado. SHA-256 do original: `1d23e55886992fdd96e7765d6d6040bda457d493a324ab3aa3d30c2cf3397b01`.

Referências conferidas: 608 produtos; 27 categorias; 3.058 movimentos (1.233 entradas e 1.825 saídas); 25 zerados; 1.296 sem motivo; 47 datas ajustadas, 32 estimadas e 3 suspeitas. Três saldos finais de −1 (341, 387, 567), 30 produtos com fechamento negativo, seis descrições a validar (44, 101, 254, 415, 640, 645). Candidatos, sem fusão/exclusão: produtos 44/101 e 215/518; movimentos 959/961 e 2625/2626.

## Antes de publicar

Leia `docs/operations.md`. Defina domínio/DNS, responsáveis por contas/backups, política de acesso e contagem física. Prepare HTTPS, valide a restauração, execute os testes no Ubuntu e revise os certificados/segredos e os arquivos de implantação. A existência dos arquivos Docker não significa que o servidor foi configurado ou que a publicação foi validada.


## Registro histórico: melhorias de histórico, armários e marca

- Histórico em abas Entradas, Saídas, Realocações e Aberturas. Ajustes pertencem à direção correspondente; um estorno é mostrado pela direção inversa do lançamento original. Realocações e seus estornos não são entradas/saídas globais.
- Filtros combináveis no PostgreSQL: produto por descrição/código legado/ID interno, categoria, subcategoria, armário, período da **data do evento**, motivo, funcionário, chamado e origem. Busca do produto ignora caixa e acentos portugueses sem alterar os textos gravados. A resposta `/api/history` agora contém `items`, `total`, `page` e `limit`; quantidades permanecem texto decimal canônico.
- Aba, filtros e página ficam na URL. Atualizar, compartilhar e usar Voltar/Avançar preservam a consulta. Alterar filtros reinicia a página; Limpar filtros mantém apenas a aba. Produtos e detalhes dos movimentos permitem abrir o histórico já filtrado, preservando a origem quando a consulta começa no legado.
- Ordenação por data do evento decrescente e UUID como desempate técnico estável. O identificador não comprova ordem cronológica intradiária no legado.
- A página Armários tem busca, ativo/inativo, paginação e saldos em unidades. “Produtos e saldos” consulta os itens de cada localização. Cadastro e edição continuam auditados; armário com saldo não pode ser inativado.
- A movimentação atualiza catálogo e saldos ao abrir, sem escolher localização automaticamente. Entrada oferece todos os armários ativos, inclusive sem histórico do produto; saída e origem de realocação oferecem somente armários ativos com saldo. Destino da realocação exclui a origem. É possível cadastrar armário no próprio formulário e atualizar as opções sem recarregar a aplicação. A associação produto/localização continua derivada dos lançamentos transacionais, sem criar uma estrutura de saldo paralela.
- Causas reproduzidas: catálogo em memória desatualizado nos formulários e conflito entre a validação RFC do Zod e o UUID sentinela já usado para “Não informada”. O UUID foi preservado; a validação agora aceita a representação hexadecimal canônica aceita pelo PostgreSQL. As referências continuam sendo conferidas no banco. Não foi encontrada paginação no catálogo que ocultasse armários: testadas 125 opções.
- Quantidades usam um formatador de apresentação pt-BR: `2.000` na API significa `2` na tela, `2000.000` significa `2.000`, `2.125` significa `2,125`; ausentes permanecem `—`. Nenhum dado persistido ou valor de API foi reformatado ou arredondado.
- Manual visual preservado como referência em `docs/brand-manual.md`, sem substituir o `AGENTS.md` operacional. SVGs oficiais de `Downloads/SVG.zip` foram copiados byte a byte para `frontend/public/brand`. Fontes Manrope e Space Grotesk estão em `frontend/public/fonts` com licenças OFL. Login, cabeçalho, símbolo móvel e favicon usam assets permanentes. Paleta dourado/grafite/neutros centralizada no CSS; sem novo sistema de temas.

Verificações desta melhoria: 42 testes sintéticos aprovados no PostgreSQL 18.4 isolado, `npm run typecheck` e `npm run build`. Edge headless verificou cadastro inline, opções recém-criadas e além de cem, entrada em localização sem associação, saída por saldo, realocação e estorno na direção correta, filtros combinados/paginação no legado, recarga da URL, histórico pelo produto, logos/fontes locais, layout de 390 px, Tab com foco visível, Escape nos detalhes e logout. Contrastadas as combinações principais de texto com proporção mínima 4,5:1; isso não substitui uma auditoria integral de acessibilidade. Capturas foram registradas com dados sintéticos. Não houve carga de dados reais, migração, commit, push ou deploy nesta melhoria.

Para carregar as alterações localmente, execute `npm run build` e reinicie a API se ela não estiver sendo executada com `npm run dev:api`. O frontend de desenvolvimento continua em `npm run dev:web`.

## Registro histórico: correção de visibilidade de saldos e importação

O filtro padrão da API, da tela e do acesso pelo produto passou de Operacional para Todas as origens. O legado já era persistido, mas ficava oculto sem selecionar sua origem. Agora entradas/saídas importadas aparecem nas abas correspondentes com a identificação **Legado importado**. Filtros explícitos continuam válidos: uma URL antiga com `regime=operacional` permanece operacional; use **Limpar filtros** ou selecione Todas as origens. Quantidades zero recebem identificação de evidência segregada na tabela e nos detalhes.

A prévia apresenta produtos processados, entradas/saídas identificadas, novos previstos, existentes e conflitos com IDs/motivos. A confirmação grava o relatório efetivo no JSONB do lote, na mesma transação dos registros. Reconfirmar o lote retorna zero novos e os existentes; a tela mantém o resultado histórico da confirmação original. Refazer a prévia atualiza a situação atual sem apagar esse resultado. Lotes antigos sem resultado detalhado mostram essa limitação; refazer a prévia permite conferir os existentes. Conflitos de ID bloqueiam a transação integralmente.

O total de movimentos persistidos inclui evidências zero: o arquivo original foi relido pelo parser, sem carga no banco, confirmando 608 produtos e 3.058 registros = 1.233 entradas + 1.825 saídas. São 3.033 quantidades positivas e 25 evidências zero (21 entradas/4 saídas). Nada disso abre saldo operacional. Os registros zerados são preservados, identificados e relacionados no relatório; não são descartados.

No ambiente sintético, **não foi reproduzida falha no cálculo/persistência do conteúdo dos armários**. Serviço, endpoint e navegador confirmaram entrada2 → entrada3 → saída1 → transferência2: A2/B2/global4, com uma linha por produto. Foi corrigida a continuidade da interface: lançamento iniciado em Produtos e saldos agora reabre o conteúdo atualizado após salvar; há também Atualizar saldos e explicação sobre saldo positivo/contagem física. Cadastro de localização não atribui estoque. Produtos legados sem abertura aprovada não aparecem como saldo disponível. Não houve redistribuição, associação fictícia, abertura automática nem ajuste de registros antigos. A causa de eventual divergência nos dados do usuário permanece dependente de uma reprodução nessa base; estes testes não comprovam o estado dela.

Verificação: 45 testes aprovados em PostgreSQL 18.4 isolado, tipos e build aprovados. Edge headless reproduziu a ocultação antes da correção e a visibilidade após ela; confirmou a sequência por armário, agregação sem duplicatas, atualização do conteúdo após lançamento, importação JSON pelo formulário, entradas/saídas nas abas e saldo operacional zero para o legado. Reimportação e metadados foram verificados nos testes de integração. Revisão independente sem achados relevantes. Dados reais somente lidos pelo parser; sem carga, commit, push ou deploy.

### Atualizar a execução local existente

Não há nova migração. Não recrie banco, volume, `.env` nem contas.

- **Node + Vite:** na raiz, execute `npm run build`. Se a API está em `npm run dev:api`, ela reinicia ao atualizar o compilado. Se está em `npm start`, encerre esse processo com Ctrl+C e execute `npm start` novamente. Mantenha/inicie `npm run dev:web` em outro terminal e recarregue `http://localhost:5173` com Ctrl+F5.
- **Docker de desenvolvimento:** execute `docker compose -f compose.dev.yaml up -d --build --wait` e recarregue `http://localhost:8080`. Não use `down -v`.
- No Histórico, clique **Limpar filtros** se a URL antiga continha `regime=operacional`. Se o lote está apenas em Prévia, ainda é necessário revisar e confirmar a importação; não a confirme novamente para tentar criar saldo. Abertura continua exigindo contagem física aprovada.

## Dashboard preparado para integração futura

API versionada `/api/integration/v1`, desabilitada por padrão (`INTEGRATION_ENABLED=false`), exclusivamente para chamadas entre servidores autenticadas por Bearer revogável/expirável e com escopos. Sem cookie pessoal, conta técnica como autor, plugin GLPI, webhook ou chamadas externas nesta entrega.

Disponível: busca de produtos sem caixa/acentos e por identificação (inclusive sem saldo), saldo/distribuição, armários para entrada/saída, cadastro explícito sem estoque, entrada/saída vinculadas a instância/chamado/usuário externo, consulta do resultado idempotente e histórico por chamado com estornos. Vínculo explícito com funcionário ativo obrigatório nas escritas. Reutiliza os serviços operacionais e a regra vigente de unidades inteiras, sem somar legado novamente.

Migração nova: `backend/migrations/005_integration_v1.sql`, aditiva, sem dados/credenciais. Validada somente em PostgreSQL local isolado; revisar o destino antes de aplicar localmente. Não foi aplicada em produção. Lançamento, ledger, autoria, referência e resultado idempotente são gravados na mesma transação. Mesma chave/conteúdo retorna o original; conteúdo diferente conflita; chaves distintas podem representar operações intencionais iguais.

Contrato/procedimento: [guia da API e exemplos](docs/integracoes/integration-v1.md). OpenAPI estático: [contrato OpenAPI](docs/integracoes/integration-v1.openapi.json), sem instalar Swagger. Plano e decisões: [plano e decisões](docs/integracoes/integration-plan.md).

### Testar a API localmente

Com Node/dependências instalados e PostgreSQL local em execução, use um **banco descartável vazio**, cujo nome termine em `_test`. A URL precisa apontar para `localhost`, `127.0.0.1` ou `[::1]`. Na raiz, em PowerShell:

```powershell
$env:TEST_DATABASE_URL = Read-Host 'URL do PostgreSQL local descartável (banco terminado em _test)'
npm test
# Depois de a suíte passar:
node scripts/simulate-integration.cjs
```

`npm test` compila e roda a suíte, incluindo a integração. O simulador inicia sua própria API local, cria dados e credencial efêmera de teste e a revoga ao finalizar. Esperado: `simulatedOnly: true`, saldo `1.000` e histórico com `2` movimentos. Ambos aplicam migrações no banco indicado; as fixtures permanecem nele. Use outro banco vazio para repetir a suíte. Não é necessário iniciar a API operacional, alterar `.env` ou ativar credenciais reais. Não use a base operacional.

O [guia completo](docs/integracoes/integration-v1.md#teste-rápido-em-powershell) explica como executar somente os testes da integração. Para chamar a API no Docker de desenvolvimento, suba com `docker compose -f compose.dev.yaml -f compose.dev.integration.yaml up -d --build --wait` e siga o [passo a passo da credencial local](docs/integracoes/integration-v1.md#credencial-local-de-teste-no-docker-de-desenvolvimento).

`compose.test.yaml` executa as suítes na rede do banco de testes (`127.0.0.1`), pois a suíte de integração recusa bancos fora do loopback. Plugin, permissões do chamado, provisionamento real e homologação ficam para a etapa no GLPI.

Verificação desta preparação: **57 testes aprovados** em PostgreSQL 18.4 temporário loopback, typecheck e build aprovados, contrato JSON e referências conferidos, demonstração HTTP local concluída com saldo 1 após entrada 2/saída 1 e replay sem duplicação. Revisão independente estática sem achados relevantes. Migração 005 executada somente em bancos temporários de testes; nenhum acesso ao GLPI ou credencial real.

## Manutenção e preparação do servidor de testes

Referências vigentes: [desenvolvimento/variáveis/comandos](docs/development.md), [ensaio privado do servidor e logs](docs/test-server.md), [operação/HTTPS/backup/restore](docs/operations.md) e [contrato da integração](docs/integracoes/integration-v1.md). Planos antigos têm indicação de registro histórico. Integração real com GLPI não foi homologada.

No banco descartável vazio indicado por TEST_DATABASE_URL, `npm run verify` executa lint (tipos e código sem uso), build e a suíte já compilada. `npm run typecheck`, `npm run lint`, `npm run build` e `npm test` permanecem disponíveis individualmente. Não há ESLint instalado: lint usa o TypeScript existente. O Compose de testes roda o mesmo lint e testes compilados; não há workflow externo ou execução remota configurada.

A manutenção preserva contratos, UI e regras: paginação centralizada com limites iguais, dependência não utilizada removida, montagem das distribuições com Map e logs JSON sanitizados para falhas HTTP/CLI. Nenhuma migração ou atualização de dependências. Ver [diagnóstico/plano](docs/maintenance-plan.md) e [evidências da revisão](docs/maintenance-validation.md).

**Validação desta manutenção (22/10/2026):** linha de base57 testes; após alterações60 testes aprovados, tipos/lint/build aprovados, ensaio nativo com banco vazio/cinco migrações idempotentes/health200/integração503. Revisão independente sem achados relevantes. Docker, Nginx/HTTPS e restauração continuam pendentes de ensaio no ambiente apropriado; não houve publicação ou alteração no servidor.

## Plugin Estoque Graal para GLPI

Código-fonte: [glpi-plugin/estoquegraal/](glpi-plugin/estoquegraal/). Documentação: [guia de instalação e configuração](docs/integracoes/glpi/operacao.md), [verificações e homologação](docs/integracoes/glpi/verificacao.md) e [índice](docs/integracoes/glpi/README.md).

Na raiz do repositório, execute `python scripts/package-glpi-plugin.py`. O ZIP e seu SHA-256 são gerados em `dist/` (ignorada pelo Git), com a pasta raiz `estoquegraal/`. A versão é lida do código atual; não extraia pacotes antigos sobre o código-fonte.

O plugin exige backend compatível do dashboard (base zero para novos cadastros da integração). Desenvolvido para posterior instalação e homologação no GLPI 11.0.5; funcionamento completo no GLPI ainda precisa ser homologado.

Plugin0.1.4: seleção de produtos com feedback visível e revisão de possíveis duplicatas no cadastro, compartilhada com o dashboard. Requer atualizar backend e frontend do dashboard junto do plugin; sem migração. Consulte [atualização e arquivos alterados](docs/integracoes/glpi/operacao.md#atualização-014--seleção-e-possíveis-duplicatas) e [contrato aditivo de candidatos](docs/integracoes/integration-v1.md#revisão-de-possíveis-duplicatas-plugin-014).

Plugin0.1.5: confirmação independente das leituras, erros locais por seção e diagnóstico sanitizado por requestId. Atualização somente do plugin, mantendo backend compatível anterior; consulte [guia de atualização e diagnóstico](docs/integracoes/glpi/operacao.md).

Plugin0.1.6: corrige ordenação da consulta intents no construtor SQL do GLPI11.0.5; lista vazia é sucesso, falhas reais permanecem visíveis. Atualização somente do plugin, sem migração; ver [procedimento e limitações](docs/integracoes/glpi/operacao.md).

Plugin0.1.7: busca inicial automática de ativos com saldo operacional positivo e opção Incluir produtos sem saldo; cadastro com Descrição/Categoria/Subcategoria/Situação igual ao Novo produto do dashboard. Exige atualização do backend, sem migração. Consulte [atualização e verificações](docs/integracoes/glpi/operacao.md).
