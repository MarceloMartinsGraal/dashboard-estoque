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
php glpi-plugin/estoquegraal/tests/run.php
node --test glpi-plugin/estoquegraal/tests/ui.test.cjs
node --check glpi-plugin/estoquegraal/public/js/app.js
node scripts/test-glpi-plugin.cjs
# Opcional: Edge local; EDGE_BINARY permite indicar o navegador
node scripts/test-glpi-plugin-browser.cjs
python scripts/package-glpi-plugin.py
```

O teste HTTP requer PHP/cURL no PATH; `PHP_BINARY` permite indicar o executável. Para PHP Windows portátil, `PHP_EXTENSION_DIR` indica a pasta ext e habilita curl no processo de teste. O servidor simulado escuta somente loopback e usa dados sintéticos. Nunca aponte estes testes para servidor real.

## Evidência desta entrega

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
