# Contrato e verificações

## Endpoints reutilizados

Todos sob `/api/integration/v1`, Bearer apenas no servidor:

| Método e rota | Uso |
| --- | --- |
| GET /products?q=&page=&limit= | Busca paginada |
| GET /products/{id}/balances | Saldo global e por localização |
| GET /products/{id}/locations?purpose=&page=&limit= | Armários elegíveis, entrada/saída |
| POST /products | Cadastro sem saldo, autoria da sessão |
| POST /movements | Entrada/saída, chamado e autoria da sessão |
| GET /operations/{key} | Recuperação por chave idempotente |
| GET /tickets/{ticketId}/movements?page=&limit= | Histórico e vínculos de estorno |

POSTs usam `Idempotency-Key`. A intenção local mantém corpo imutável e aquisição atômica de envio. Consultar uma intenção em envio não inicia outro POST. Resultado confirmado é terminal. Nenhuma transação de banco GLPI permanece aberta durante HTTP; regras de saldo/concorrência ficam no dashboard/PostgreSQL existente.

O contrato foi confrontado com documentação e código NestJS existentes, sem alterar seus endpoints. Quantidades usam strings decimais do contrato e unidades inteiras na operação atual, sem cálculos em ponto flutuante.

Produtos novos criados pela integração usam base zero registrada atomicamente no cadastro, sem movimento/ledger. A primeira entrada é outro POST confirmado e idempotente. A data inicial é a do cadastro em America/Sao_Paulo; eventos anteriores são rejeitados. Produtos existentes/importados não são alterados. Não existe endpoint genérico de aprovação de abertura para o legado. Não existe endpoint de identificação da credencial: o administrador precisa conferir a instância da credencial. Respostas de movimentos e consultas de operação são conferidas contra instância/usuário/chamado esperados, mas um catálogo vazio não comprova antecipadamente a identidade da credencial.

## Executar localmente (raiz do repositório)

Requer PHP 8.2+ e Node.js somente como ferramentas de desenvolvimento; nenhuma dependência adicional é instalada.

```sh
php tests/glpi-quick-product.php
node --check glpi-plugin/estoquegraal/public/js/app.js
node scripts/test-glpi-search-proxy.cjs
node scripts/test-glpi-plugin-browser.cjs
python scripts/package-glpi-plugin.py
```

O teste HTTP atual requer PHP/cURL/mbstring no PATH; `PHP_BINARY` permite indicar o executável. Para PHP Windows portátil, `PHP_EXTENSION_DIR` indica a pasta ext e habilita curl no processo de teste. O servidor simulado escuta somente loopback e usa dados sintéticos. Nunca aponte estes testes para servidor real.

## Evidência histórica da entrega inicial

- PHP 8.3.36 portátil oficial, SHA-256 verificado: 11 grupos passaram (configuração, HTTP construído, erros/segredos, autoria/contexto, intenção imutável, timeout/recuperação, clique concorrente, cadastro separado, permissões/entidade e escape HTML/versão).
- Node: 2 testes passaram (quantidades pt-BR e descarte de respostas antigas).
- Cliente cURL real contra servidor sintético loopback: busca paginada, entrada, saída, cadastro, abertura pendente, 400/401/403/409/503, redirect não seguido, timeout após gravação e recuperação; cinco POSTs previstos, nenhum redirecionamento seguido.
- Prévia isolada em Edge com View PHP e JS/CSS reais: conteúdo HTML remoto permanece texto, retomadas fora de ordem descartadas, retomada bloqueada durante escrita, duplo clique produz um envio e viewport 390px sem transbordamento. Endpoint GLPI simulado; não prova integração com GLPI.
- Revisão independente estática de cliente, direitos, hooks, persistência e contrato. Corrigida troca de intenção por respostas antigas durante retomada/preparo/envio.
- Verificação sintática de todos os PHP e dos JavaScript realizada na entrega.

Esses testes não iniciam GLPI/MySQL. Não provam funcionamento completo no GLPI. Não foram executados instalação/desinstalação no banco GLPI, CSRF pelo kernel em execução, criptografia pela chave GLPI real, navegador integrado ao GLPI, TLS entre servidores ou migração/backup. Testes de direitos usam substitutos sintéticos de Session/Ticket/Plugin.

## Roteiro obrigatório de homologação futura

1. Instalar GLPI 11.0.5 local isolado de fonte oficial; testar instalação/ativação/desativação/desinstalação e reinstalação, conferindo somente tabelas próprias.
2. Configurar dashboard também isolado com dados sintéticos, credencial própria e vínculo de funcionário. Conferir armazenamento cifrado, campo de senha vazio, rotação e restauração de chave/backup.
3. Testar perfis sem direitos, leitura, movimentação e cadastro, troca de perfil; negar chamado inacessível e outra entidade inclusive forjando IDs no AJAX. Testar sessão expirada e CSRF ausente/inválido.
4. Testar busca com acentos, páginas, estados vazio/carregando/erro, teclado e celular; retornar HTML malicioso como descrição e comprovar renderização textual. Alternar rapidamente seleção e retomada de intenções, com respostas atrasadas.
5. Testar entrada/saída, saldo insuficiente, funcionário inativo/sem vínculo, produto inativo, quantidade/data inválidas, observação obrigatória, armários e localização não informada.
6. Cadastrar sem saldo, conferir base zero e entrar separadamente pelo plugin. Conferir que legado pendente permanece bloqueado. Falhar a entrada e conferir que o cadastro não se repete.
7. Testar duplo clique e duas sessões concorrentes; simular perda de resposta após gravação, reiniciar PHP e recuperar pela mesma chave. Conferir um único movimento e autoria/chamado corretos.
8. Confirmar histórico/estornos, ausência de alteração ao abrir/fechar chamado, validação TLS e falhas de rede. Remover plugin e confirmar que histórico do dashboard permanece intacto.

Somente após esse roteiro aprovar instalação operacional. Nenhum acesso ao GLPI existente foi necessário para desenvolver esta entrega.

### Regressão da base zero (0.1.1)

61 testes do backend passaram em PostgreSQL descartável local, incluindo importação/abertura do legado, concorrência e estorno existentes. Novo teste confirma base zero sem movimentos, replay de cadastro sem duplicação, primeira entrada concorrente com mesma chave produz um único movimento, segunda abertura bloqueada e legado pendente inalterado. Typecheck e lint passaram. Nenhuma migração ou atualização de produtos existentes é realizada.

### Organização dos artefatos

Documentação centralizada em `docs/integracoes/glpi/`, mantendo código em `glpi-plugin/estoquegraal/`. Guias externos foram comparados byte a byte com os existentes e preservados; não foi extraído código de ZIP. Versão atual encontrada: 0.1.1, sem pacote posterior na entrega externa.

Empacotamento: `python scripts/package-glpi-plugin.py`, a partir de qualquer diretório. Lê a versão do setup.php e grava ZIP/checksum em `dist/`, já ignorada por regra existente. O ZIP inclui a pasta raiz `estoquegraal/` e cópias dos guias centralizados, ajustando os links do README para o contexto do pacote.

Nesta organização foram conferidos links locais, integridade/estrutura/conteúdo e repetibilidade do ZIP, regra de exclusão Git, preservação do código operacional e ausência de indicadores de segredos/dados pessoais nos artefatos destinados ao versionamento. Isso é uma inspeção limitada dos arquivos organizados, não auditoria de segurança completa. As evidências funcionais anteriores acima são históricas: a suíte funcional não foi reexecutada nesta tarefa, pois nenhuma funcionalidade mudou. Backend compatível e homologação GLPI continuam necessários.

### Correção de assets 0.1.2 (23/10/2026)

Investigação por endereço:

| Arquivo | Origem da URL anterior | Defeito confirmado localmente / correção |
| --- | --- | --- |
| core.js | hook add_javascript, caminho js/core.js | ZIP0.1.1 tinha js/core.js; roteador procura public/js/core.js; movido sem mudar URL |
| app.js | mesmo hook, caminho js/app.js | Mesma incompatibilidade física, public/js/app.js; carregado após core |
| plugin.css | hook add_css, caminho css/plugin.css | Arquivo em css/ não era público no roteador11; movido para public/css/ |
| logo.svg | View a partir de Plugin::getWebDir | Além de arquivo fora de public, dependia de helper depreciado que pode emitir marketplace; agora Html::getPrefixedUrl com rota canônica plugins e arquivo public/pics/ |

O ZIP0.1.1 foi inspecionado: os quatro arquivos existiam, com pasta raiz correta estoquegraal/, porém sem public/. Não houve evidência de arquivo ausente do ZIP. Não foram fornecidas URLs do ambiente instalado e não foi acessado servidor; logo, particularidades de proxy/rewrite, cache ou instalação incompleta nesse ambiente não foram comprovadas.

Fontes oficiais tag11.0.5: RequestRouterTrait::getTargetFile expõe assets de public/ e mantém exceção para scripts legados PHP em ajax/front; Html registra JS do hook em /plugins/{plugin}/{file} e aplica root_doc; Plugin::getWebDir está depreciado. Hooks relativos mantidos; não adicionar public ou prefixo GLPI ao registro dos hooks.

Teste PHP de regressão falhou antes da correção por core.js fora de public. Após a correção, passou com hooks e renderização real da classe de aba usando substitutos do core, em raiz/subdiretório e independentemente de caminho marketplace. No navegador Edge isolado: os quatro assets servidos HTTP200, logo decodificada, estilo aplicado, aba inserida depois dos scripts via MutationObserver e aba reaberta sem recarregar scripts, busca por input/debounce e botão disparando requisições e exibindo resultado sintético. Executado com prefixos vazio e /glpi. Endpoint GLPI é simulado; nenhum backend/GLPI existente foi chamado. Isso verifica o fluxo JS local, não comprova a busca no ambiente instalado.

Testes disponíveis: `php glpi-plugin/estoquegraal/tests/assets.php`, testes PHP existentes (11 grupos), Node (2 testes), cliente cURL loopback, sintaxe PHP/JS, navegador isolado raiz/subdiretório. Não reexecutada suíte PostgreSQL pois backend, autenticação, permissões, contratos e regras de estoque não foram alterados. O empacotador agora recusa gerar ZIP se faltar um dos quatro assets públicos.

Homologação pendente: servidor web GLPI11.0.5 real, cache/OPcache/proxy e rota efetiva, sessão/CSRF e comunicação com dashboard. Siga atualização no guia e confirme requisições no Network. Não declarar busca instalada resolvida apenas pelo ZIP.

### Seleção e duplicatas 0.1.4 — 23/10/2026

Causa reproduzida localmente para seleção: o handler dinâmico já existia e enviava UUID correto a balances; porém painel era mostrado após a lista sem foco/rolagem, e saldo zero começava em saída, cuja lista elegível vazia é correta. O teste anterior falhou esperando armário de entrada. Corrigidos foco/rolagem, sugestão entrada para zero e mensagens locais/loading/erro; não alteradas API de saldo/elegibilidade. Sem URLs/Console do GLPI instalado não foi provado que essa é a única causa no pacote instalado; comparar versão0.1.4 e homologar.

Verificado em banco PostgreSQL temporário loopback:64 testes passaram (incluem2 testes de comparação e regressão de catálogo inteiro/25 candidatos, inativos/zero, página2, divergências técnicas, confirmação auditada, lista obsoleta, concorrência, identificador único existente e replay). Teste de comparação observado falhar antes da implementação. Falha de consulta não vira lista vazia. Nenhuma migração nova.

Navegador Edge isolado com View/JS reais do plugin e endpoint simulado: seleção de resultado dinâmico com saldo zero e armário de entrada, saldo positivo/distribuição e saída, ausência de armários, erro visível/aria-busy encerrado, consulta de candidatos durante digitação, bloqueio sem confirmação, intenção com justificativa e falha de consulta sem preparo. Também testado o componente TypeScript real de revisão do dashboard, compilado em memória pelo TypeScript existente: debounce, confirmação, usar existente e falha preservando formulário. Não é homologação do dashboard publicado nem do GLPI. Testes de assets, PHP (12 grupos), Node, cliente cURL loopback, lint/build e sintaxe executados nesta entrega.

Revisão independente estática apontou ausência de opening_date no candidato, erro não tratado ao abrir existente e limite de corpo incompatível com muitas referências. Corrigidos: estado retornado, erro visível sem fechar e limite específico para prepare com máximo10000 UUIDs e justificativa validada. Sem auditoria de segurança completa. Limitação do teste: sem kernel/DB GLPI real, sem acesso ao servidor; auth/CSRF/rotas reais e ergonomia final dependem da homologação descrita no guia.

A correção prévia0.1.3 de `global $DB` no endpoint foi preservada; sua regressão em escopo de função também passou. Testes de comparação e fluxo novo não usam GLPI real. A versão instalada anterior deve ser conferida; este diagnóstico não atribui automaticamente todos os sintomas instalados à mesma causa. A corrida de respostas de candidatos foi testada no navegador, retornando uma consulta lenta após a nova; somente a nova permaneceu visível.

### Confirmação e erros por seção — 0.1.5

Causas confirmadas no código anterior: finish aguardava leituras em sequência, deixando histórico/intents propagarem erro até o catch da escrita. Seleção/search podiam capturar erro e ainda escrever no aviso global; um sucesso posterior em outra seção ou um histórico já confirmado não demonstrava resolução desse erro. read intents não tinha geração contra respostas fora de ordem. requestId retornado em erro pelo PHP era perdido pelo JavaScript. Sem acesso ao servidor e sem requestId antigo, não foi identificada a exceção exata do HTTP500 observado pelo usuário.

Correção local: resultado done é mantido; atualização paralela de leituras com Promise.allSettled, cada função registra sua falha local e encerra aria-busy. Erros não viram resultados vazios fictícios. Botões retry executam somente leituras. Versão por ação impede resposta antiga de substituir sucesso/erro novo. Busca, saldo, armários, histórico, intenções e retomada têm feedback separado. Diagnóstico mostra ação/status/requestId e log PHP guarda fase/tipo/local relativo/linha, sem mensagem bruta/segredos; status de erro permanece500 quando há exceção interna.

Verificado em navegador Edge isolado, com View/JS reais e endpoint sintético: movimento concluído seguido de falha500 em balances, locations, history, search e intents separadamente; as outras consultas continuam, Concluído é preservado, contador de execute aumenta uma única vez e retries não o alteram. Mesma consulta bem-sucedida limpa erro antigo; sucesso de outra seção não limpa erro válido. Leitura lenta com falha após sucesso novo e sucesso antigo após falha nova não sobrescrevem o estado mais recente. aria-busy retorna false. Verificados também retry de saldo inicialmente indisponível e dois cliques em Carregar mais armários sem pular página, após achados da revisão independente.

Teste PHP tests/endpoint.php e --failure: endpoint carregado em escopo de função, exceção sintética em intents mantém status500, ação e requestId correlacionados; uma sentinela de segredo na mensagem bruta não aparece no JSON/log. Regressões existentes do plugin:12 grupos PHP, assets, cliente cURL loopback e2 testes Node. Sintaxe PHP/JS e ZIP conferidos. Suíte de PostgreSQL não foi repetida nesta tarefa: nenhum backend/regra de estoque/idempotência foi alterado. Testes locais não são homologação no GLPI real.

Origem do (-3): backend/src/history.ts inclui ledger.delta por movimento e formatQuantity o devolve em locations[].delta. A UI antiga acrescentava esse valor entre parênteses após código/nome. Agora mostra variação: -3. O teste usa code15/name memoria/delta -3.000 e confere a identificação; não conclui saldo atual negativo.

Pendente: fornecer ação/status/requestId do erro instalado e linha de log sanitizada correlacionada; homologar kernel/CSRF/rede/proxy reais sem repetir movimentações. Não acessados servidores e nenhum movimento real criado.

### Ação intents — 0.1.6

Rastreio: JS intents() faz POST no endpoint PHP com action intents, sem identidade humana fornecida pelo navegador; Gate::context resolve sessão/chamado/entidade; configuração fornece instância; GlpiIntentStore::recent usa esses quatro filtros e projeta somente key/state/operation; endpoint serializa a lista; JS mostra resultado ou erro local. Sem escrita/movimentação externa nesse fluxo.

Evidência antes da correção: tests/intents.php executado com DBmysql.php/DBmysqlIterator.php oficiais tag11.0.5 gerou ``ORDER BY `DESC` LIMIT 20`` e falhou na asserção de ordenação; depois da correção gerou ``ORDER BY `id` DESC LIMIT 20`` e passou. Construtor oficial executado sem conexão; funções Safe/DBConnection mínimas substituídas só para esse teste de geração. Não foi executada consulta em MySQL/MariaDB ou GLPI real.

Testes adicionados: lista vazia, registros e todos os quatro estados, limite/ordem, isolamento por usuário/chamado/entidade/instância, exclusão de done e falhas por exceção/retorno false. Endpoint real carregado em escopo de função com contexto sintético: sucesso vazio, registro serializado, outro usuário, outro chamado, falha500, retorno não iterável500 e JSON inválido500, todos com requestId/log sanitizado. JavaScript real em navegador com endpoint sintético: mensagem exata Nenhuma operação pendente, registro desconhecido, falha que não se transforma em vazio e recuperação sem novo movimento. Regressões de timeout/idempotência existentes preservadas e executadas.

Comandos locais:

```sh
php glpi-plugin/estoquegraal/tests/intents.php
php glpi-plugin/estoquegraal/tests/endpoint.php
php glpi-plugin/estoquegraal/tests/endpoint.php --existing
php glpi-plugin/estoquegraal/tests/endpoint.php --existing --other-user
php glpi-plugin/estoquegraal/tests/endpoint.php --existing --other-ticket
php glpi-plugin/estoquegraal/tests/endpoint.php --failure
php glpi-plugin/estoquegraal/tests/endpoint.php --false
php glpi-plugin/estoquegraal/tests/endpoint.php --invalid-json
```

Opcionalmente tests/intents.php recebe dois caminhos de cópias locais oficiais de src/DBmysql.php e src/DBmysqlIterator.php tag11.0.5 para executar o construtor original. Essas fontes de pesquisa ficam fora do pacote e não inicializam instalação GLPI.

Revisão independente estática não encontrou defeitos adicionais no ajuste; confirmou preservação dos filtros/schema/idempotência. O HTTP500 do requestId informado permanece sem correlação com logs instalados, indisponíveis ao usuário neste momento. Não foi presumida necessidade de migração nem executado comando em servidor/banco real. Homologação GLPI e conferência dos metadados instalados continuam pendentes.

### Busca disponível e quatro campos — 0.1.7 (26/10/2026)

Requisitos/UI confrontados com frontend/src/main.ts productFields({}), control() e productSchema. Teste de navegador executa a própria função do dashboard, transpilada pelo TypeScript já instalado, e compara nomes/ordem/required/valores padrão com os controles do plugin. Confirmados description/categoryId/subcategoryId/active, sem quantidade e sem campos financeiros/identidade. Teste PHP novo prepara os quatro campos e valida UUID, boolean, subcategoria com categoria, comprimento Unicode e defaults.

66 testes backend passaram em PostgreSQL descartável loopback. Regressões novas:33 produtos (zerados antes dos positivos na ordem), filtro/count antes da paginação, página1 e2 com limit1, exclusão de inativo, inclusão de zerados, busca antiga dashboard preservada e product-matches amplo; saldo positivo somente no legado não entra em disponibilidade. GET product-options usa classificações reais. Cadastro com quatro campos grava os valores, continua sem movimentos/quantidade e com base zero; entrada separada e replay resultam em único movimento. Testes de saldo/concorrência/importação/estorno/autorização existentes permanecem aprovados. Os dois testes novos foram observados falhar antes da implementação (400 por filtro desconhecido e404 de options).

Navegador local com View/JS reais e API sintética: busca inicial automática com opção zerados desmarcada, filtro explícito nas pesquisas e vazio oferecendo ampliar; quatro campos comparados ao dashboard; categorias/subcategorias na intenção; justificativa oculta até confirmação e candidatos preservados. Regressões anteriores de seleção/timeout/atualizações por seção também passaram. Testes sintéticos de UI não comprovam GLPI instalado.

Proxy PHP real com cURL contra API loopback sintética: search sem opção envia status ativo/availability positive; opção true envia all; product_options retorna catálogo; matches não recebe filtro de disponibilidade e retorna candidato inativo/zerado. Nenhum servidor ou estoque real foi usado. Novos comandos:

```sh
php tests/glpi-quick-product.php
node scripts/test-glpi-search-proxy.cjs
node scripts/test-glpi-plugin-browser.cjs
```

O segundo comando requer PHP/cURL/mbstring no PATH; PHP_BINARY/PHP_EXTENSION_DIR permitem indicar runtime portátil. Regressões PHP antigas internas ao plugin não estavam presentes no checkout atual (patch anterior); não foram restauradas nem declaradas executadas. Mantida a estrutura/correções do patch atual e adicionados testes na pasta tests/ do repositório. Lint/build e sintaxe verificados nesta entrega. Revisão independente confirmou filtro antes da paginação e contratos opcionais; recomendação de carga inicial automática aplicada e testada. Homologação real no GLPI e atualização do backend continuam pendentes de execução pelo administrador.
