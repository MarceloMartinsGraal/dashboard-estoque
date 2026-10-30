# Atualização0.1.9 — mesmo servidor e HTTPS

O helper CLI aceita local_http opcional para API em127.0.0.1/localhost/::1 do mesmo host e confirma os flags persistidos. Acesso público segue HTTPS. Usar essa opção apenas quando o processoPHP e a API alcançável estão no mesmo host; não usar localhost de outro servidor/container. O configurador do repositório tem --glpi-local, --mode local|online, --public-origin e --api-url; não exige SSH no modo local. No online compartilhado, compose.same-host.yaml publica só127.0.0.1:8080 atrás do proxy existente, sem ocupar80/443 do GLPI. O proxy do host deve sobrescrever X-Graal-Client-IP com o IP real da conexão para preservar limite de login por cliente.

Atualizar pelo instalador existente com backup; não desinstalar, não apagar tabelas/intenções ou substituir a chave GLPI. O instalador executa cache:clear; assets e regras de estoque não mudaram. Conferir a URL que o PHP realmente alcança; PUBLIC_ORIGIN do navegador é independente. Instruções completas no repositório: docs/configuracao-local-online.md. Não há migração de schema nova nesta alteração. GLPI real e proxy HTTPS ainda exigem homologação.

# Instalação futura e operação

## Instalar em homologação

1. Prepare um GLPI **11.0.5 isolado**, com backup de banco, arquivos e chave criptográfica GLPI. Não use uma instalação existente para os testes iniciais.
2. Confira o SHA-256 do ZIP e extraia sua pasta `estoquegraal/` em `<GLPI>/plugins/`. Deve existir `<GLPI>/plugins/estoquegraal/setup.php`, sem pasta adicional intermediária. Preserve proprietário/permissões usados pelo GLPI; não use 777.
3. Na administração de plugins do GLPI, instale e ative. A integração começa desabilitada e os direitos operacionais começam em zero. A instalação cria somente `glpi_plugin_estoquegraal_intents`, configurações `plugin:estoquegraal` e o direito `plugin_estoquegraal`.
4. Um administrador com direito de atualizar configuração define URL HTTPS terminando em `/api/integration/v1`, identificador estável da instância, credencial e timeouts. Vazio no campo credencial preserva o segredo; remover credencial desabilita a integração. A opção HTTP é exclusivamente para localhost/127.0.0.1/::1 de desenvolvimento.
5. No dashboard, prepare a credencial da mesma instância com escopos `read`, `products:write`, `movements:write`, conforme contrato da API. Use uma credencial específica e mantenha-a apenas no servidor GLPI. Não cole tokens em logs, chamados ou JavaScript.
6. No perfil GLPI, aba Estoque Graal, conceda explicitamente consultar (READ), movimentar (UPDATE) e/ou cadastrar (CREATE). Movimentar/cadastrar também exige consultar. Visualizar um chamado não concede movimentação automaticamente.
7. Configure no dashboard o vínculo externo entre o ID nativo do usuário GLPI e o funcionário ativo. Não associe pelo nome. O ID enviado é o da sessão humana, nunca o da credencial técnica; chamado e entidade são lidos do servidor GLPI e revalidados a cada requisição.
8. Siga o roteiro de homologação antes de uso operacional.

A credencial é armazenada pelo mecanismo oficial `Config`/`secured_configs`/`GLPIKey`; o formulário nunca reapresenta seu valor. Backup e rotação da chave GLPI precisam preservar a capacidade de decriptar configurações. Não mude a instância depois que existirem intenções locais: a alteração é bloqueada para evitar misturar operações.

## Rede

Servidor GLPI → dashboard: HTTPS com certificado válido e cadeia CA confiável para PHP/cURL. Não desabilite validação TLS. Configure firewall/proxy para essa comunicação. Navegador → GLPI: sessão e CSRF normais do GLPI, sem token do dashboard. Não são necessários webhooks nem acesso do dashboard ao banco GLPI. Timeout de conexão e total são configuráveis, total de 1 a 30 segundos; respostas limitadas a 2 MiB e redirecionamentos não são seguidos.

## Usar a aba do chamado

Busque produtos, selecione um e confira saldo por armário. Escolha explicitamente entrada/saída, armário, quantidade inteira positiva, data e motivo. Motivos outro/correção exigem observação. Revise, marque a conferência e confirme. Abrir/fechar o chamado ou visualizar a aba não altera estoque.

Cadastrar produto é operação separada: cria produto ativo em unidades, sem quantidade. **Com o backend atualizado, produtos novos cadastrados pela integração recebem base operacional zero na data do cadastro (America/Sao_Paulo), sem movimento ou quantidade. Registre depois a primeira entrada pelo plugin, em operação separada e confirmada.** Produtos existentes sem abertura e legados continuam exigindo conciliação no dashboard; não recebem base zero retroativa. Falha na entrada não repete o cadastro. Não existem edição direta de saldo, exclusão de movimentos ou estorno pelo plugin; histórico mostra estornos registrados no dashboard.

Após timeout, consulte a intenção existente. O resultado pode já estar gravado. Reenvio explícito usa a mesma chave e o mesmo conteúdo; não crie uma nova intenção para contornar resultado desconhecido. As intenções persistem no banco GLPI, associadas a usuário/chamado/entidade/instância. A lista exibe as últimas 20 pendentes do contexto. O histórico confirmado continua no dashboard.

## Diagnóstico

| Situação | Ação |
| --- | --- |
| Integração inativa | Administrador confere configuração e habilitação |
| Credencial inválida/expirada (401) | Conferir/rotacionar credencial no dashboard e substituir no GLPI |
| Sem vínculo/permissão (403) | Conferir perfil, acesso ao chamado/entidade, escopo e vínculo com funcionário ativo |
| Conflito (409) | Conferir abertura, saldo atual, produto ativo e chave; não contornar gerando nova chave |
| Tempo excedido/indisponível | Consultar resultado da intenção, conferir rede/TLS e disponibilidade |
| Sessão/CSRF indisponível | Recarregar aba e autenticar novamente; não desligar proteção CSRF |
| Chave GLPI indisponível | Restaurar chave oficial correspondente ao backup antes de salvar credenciais |

Logs locais usam identificador de diagnóstico, ação, estado e status; não incluem token, corpo ou detalhes do chamado. Não publique arquivos de configuração e banco.

## Remover

Antes de desinstalar, concilie intenções pendentes e revogue manualmente a credencial no dashboard. Desative e desinstale pela administração GLPI. A desinstalação remove tabela de intenções, configuração/segredo e direitos próprios. **Não apaga nem estorna movimentos do dashboard**, não revoga automaticamente sua credencial e não altera o core GLPI. Guarde backup se precisar conservar diagnóstico local. Somente depois remova a pasta do plugin.

## Atualização 0.1.1 — requisito do backend

Atualize também o backend do dashboard com a correção de base zero da integração antes de usar este pacote. Não há migração ou alteração de produtos existentes. O plugin consulta o saldo após cadastrar e só habilita a entrada se `openingDate` estiver presente. Em backend antigo, continua bloqueando com mensagem de abertura pendente. Não substitua uma intenção de cadastro já concluída por novo cadastro: produtos criados antes da correção devem ser conciliados pelo fluxo existente.

## Atualização 0.1.2 — assets no GLPI 11

Esta versão corrige a localização física dos assets: `public/js/core.js`, `public/js/app.js`, `public/css/plugin.css`, `public/pics/logo.svg`. As URLs **não** incluem `/public`: os hooks GLPI continuam registrando `js/core.js`, `js/app.js` e `css/plugin.css`; o GLPI resolve esses caminhos dentro de public. A logo e o endpoint da aba usam a rota canônica `/plugins/estoquegraal`, prefixada por `Html::getPrefixedUrl`, compatível com instalação na raiz ou em subdiretório. Não configure IP/caminho físico no código.

Atualização a executar pelo administrador, inicialmente em homologação:

1. Concilie intenções em envio, faça backup dos arquivos do plugin e do banco/chave GLPI e desative o plugin. **Não desinstale**: desinstalação apaga configurações e intenções locais.
2. Gere/obtenha `estoquegraal-0.1.2.zip`, confira o SHA-256 e extraia em diretório temporário. Confira `estoquegraal/setup.php` e `estoquegraal/public/js/app.js`. Substitua a pasta de código do plugin pela pasta estoquegraal nova no mesmo diretório de plugins utilizado antes, preservando proprietário/permissões. Não crie outra cópia em marketplace e não deixe o backup dentro dos diretórios de descoberta de plugins. Não altere core, banco ou configuração web para expor a raiz do plugin.
3. Reative e confira versão 0.1.2 no gerenciador. Se GLPI indicar atualização, use o fluxo normal, sem desinstalar; esta versão não muda schema. Preserve configuração, credencial e direitos existentes.
4. Na raiz da instalação GLPI, como o usuário do serviço web, limpe cache pelo comando oficial `php bin/console glpi:cache:clear`. Se o PHP mantiver código antigo por OPcache, o administrador deverá invalidar/recarregar o processo PHP conforme a operação local. Esses procedimentos não foram executados por esta entrega.
5. Faça recarga completa da página do chamado (Ctrl+F5), não somente da aba. Isso permite carregar os hooks e renovar referências dos assets. Se houver proxy/cache HTTP, invalide apenas as URLs estáticas do plugin conforme sua política.
6. No Network, confira HTTP200 e MIME correto para os quatro arquivos. Na raiz, as URLs serão `/plugins/estoquegraal/js/core.js`, `/plugins/estoquegraal/js/app.js`, `/plugins/estoquegraal/css/plugin.css`, `/plugins/estoquegraal/pics/logo.svg`; em `/glpi`, terão esse prefixo. JS/CSS podem incluir `?v=...` gerado pelo GLPI. A pasta física public não faz parte da URL.
7. Abra e reabra a aba, digite uma busca e use o botão Buscar. Confirme POST no endpoint do próprio plugin, ação search e resultados retornados. Não faça movimentação real para testar assets. Se ainda houver 404, envie somente a URL da requisição do arquivo, sem cookies, tokens, cabeçalhos ou corpo; a rota/rewrite do ambiente precisa ser distinguida da estrutura do ZIP.

Limpar cache sozinho não corrige pacote antigo com assets fora de public. O backend compatível do dashboard continua necessário e a homologação no GLPI real continua pendente.

Referências: [roteamento estático GLPI 11.0.5](https://github.com/glpi-project/glpi/blob/11.0.5/src/Glpi/Http/RequestRouterTrait.php), [hooks e prefixo de URL](https://github.com/glpi-project/glpi/blob/11.0.5/src/Html.php), [CLI oficial para cache](https://help.glpi-project.org/documentation/cli).

## Atualização 0.1.3 — falha interna em toda ação da aba

Sintoma na 0.1.2: qualquer busca na aba retornava "Falha interna do plugin" e HTTP 500 em `ajax/endpoint.php`. Causa: o GLPI 11 inclui scripts legados dentro de `LegacyFileLoadController::__invoke` (escopo de função), e o endpoint usava `$DB` sem `global`; o armazenamento de intenções recebia `null` antes de qualquer chamada ao dashboard. Correção: `global $DB;` no endpoint. Teste de regressão: `tests/endpoint.php` carrega o endpoint em escopo de função, como o GLPI 11. Sem mudança de schema, configuração ou contrato da API; atualizar como as versões anteriores, sem desinstalar.

## Atualização por script

`scripts/update-glpi-plugin.sh` executa no servidor GLPI os passos acima sem desinstalar: confere SHA-256 (quando o `.sha256` acompanha o ZIP) e a estrutura do pacote, desativa, move a pasta anterior para `/var/backups/glpi-plugins/` (fora dos diretórios de descoberta), instala a nova com o dono de `files/`, limpa o cache, recarrega Apache/PHP-FPM, executa `plugin:install` (hook idempotente; registra a nova versão) e `plugin:activate`. Recusa pacote inválido antes de alterar a instalação; se a cópia falhar, restaura a pasta anterior. Ao final mostra o estado e os comandos para voltar à versão anterior. Configuração, credencial, direitos e intenções ficam no banco GLPI e não são alterados.

Do PC administrativo, na raiz do repositório (empacota, envia por `scp` e executa por `ssh`, pedindo a senha do sudo):

```powershell
.\scripts\deploy-glpi-plugin.ps1 -Servidor usuario@IP_DO_GLPI
```

Ou, com o ZIP e o `.sha256` já em `/tmp` do servidor: `sudo bash update-glpi-plugin.sh /tmp/estoquegraal-X.Y.Z.zip [/var/www/glpi]`. Se o estado final não for ativo, conclua em Configurar → Plugins (Atualizar, se aparecer, e Ativar), nunca Desinstalar. Validado em contêiner Ubuntu 24.04 com GLPI simulado (troca, backup, checksum e pacote inválido); a execução em GLPI real permanece pendente de homologação.

## Atualização 0.1.4 — seleção e possíveis duplicatas

Atualize **também o backend e o frontend do dashboard**, a partir desta revisão. Backend inclui leitura product-matches e revalidação de candidatos no serviço compartilhado; frontend inclui a revisão no cadastro. Não há migração, importação ou alteração de dados existentes. Recompile/republique a aplicação pelo procedimento habitual de homologação; nenhum servidor foi atualizado por esta entrega.

Para GLPI, substitua a pasta inteira estoquegraal pela do ZIP0.1.4, desativando/reativando sem desinstalar, conforme procedimento de cache da seção0.1.2. Mantenha configuração, direitos e intenções. O pacote contém todos os arquivos; não atualize apenas app.js. Arquivos de runtime alterados nesta versão: setup.php, public/js/app.js, lib/View.php, lib/ApiClient.php, lib/Operations.php, ajax/endpoint.php. Código do dashboard: backend/src/product-matches.ts, products.ts, catalog.ts, integration.ts e frontend/src/product-matches.ts, main.ts. Não copiar TypeScript diretamente para o processo em produção: gerar build como habitual. Nenhuma alteração em credenciais ou escopos existentes além dos read/products:write já necessários.

O botão Selecionar e ver armários revela o painel, dá foco ao título e rola até ele. Saldo zero sugere entrada; saída permanece sem disponibilidade. Loading, falha de comunicação, armários vazios e abertura pendente são mensagens distintas. Legacy sem abertura permanece bloqueado. Dados de entrada incluem armários ativos sem saldo/associação; saída continua somente com disponibilidade.

Ao digitar descrição para cadastrar, revise todos os candidatos paginados, inclusive inativos e sem saldo. Use produto existente para selecioná-lo; produto inativo exige revisão no dashboard, sem reativação automática. Se realmente for diferente, marque a confirmação e escreva justificativa de negócio (5..500), sem dados pessoais ou segredos. Não é fusão automática. A revisão é repetida antes da preparação e no backend antes de gravar. Lista alterada exige nova revisão. Em caso de falha/404 nessa consulta, confira se o backend compatível está atualizado; não prosseguir presumindo catálogo vazio.

Cadastro novo continua com base zero sem quantidade; primeira entrada é outra operação confirmada. Intenções antigas não são reescritas: se cadastro antigo for rejeitado por novos candidatos, revise e prepare uma nova intenção de cadastro; se estiver desconhecido, consulte antes e concilie, sem criar operação substituta.

## Atualização 0.1.5 — confirmação e falhas de atualização

Atualização **somente do plugin**: backend e frontend do dashboard não precisam de nova alteração em relação à versão compatível0.1.4. Mantenha essa dependência. Substitua a pasta completa estoquegraal pelo ZIP0.1.5, desativando/reativando sem desinstalar; use o procedimento de backup/cache/recarga completa descrito na seção0.1.2. Arquivos de runtime alterados: `setup.php`, `public/js/app.js`, `lib/View.php`, `ajax/endpoint.php`. Sem migração ou alteração de dados/estoque/credenciais.

Uma operação confirmada permanece Concluído, mesmo que uma leitura subsequente falhe. Saldo, armários, histórico, busca e lista de intenções atualizam independentemente. Erros aparecem junto da seção afetada, com ação/status/requestId e opção de repetir somente aquela consulta. Há também Atualizar consultas (sem movimentar). Nenhum desses botões executa movimentação. Ao recuperar a mesma consulta com sucesso, seu erro é removido; erro ainda válido em outra seção permanece. Consultas atrasadas não substituem o resultado mais recente. Após resultado desconhecido, use Consultar resultado para recuperar por idempotência; nunca crie outra chave para contornar o aviso.

No histórico, `15 · memoria (variação: -3)` significa código15, nome memoria e delta de menos3 unidades **daquele movimento** nessa localização. Não é saldo calculado. No contrato, o nome vem de locations[].name e o delta de locations[].delta; saldo atual é consultado em balances. Se o próprio nome tiver parênteses, ele continua preservado literalmente, separado do rótulo variação.

### Coletar evidência sanitizada de erro

Não foi acessado o GLPI instalado e não há comprovação de qual requisição falhou nesse ambiente. Não envie cookies, Authorization, tokens CSRF, corpo de movimentação, HAR completo ou logs completos.

1. Confira a versão0.1.5 e recarregue a página inteira. Uma falha mostra algo como ação history; status500; requestId com32 caracteres hexadecimais. Anote **ação, status, requestId e seção**, sem repetir a movimentação.
2. Em Network, diferencie action execute (confirmação) de balances, locations, history, search, intents (leituras). O endpoint HTTP é o mesmo ajax/endpoint.php; não confundir o POST de leitura no plugin com POST /movements no dashboard. Registre apenas URL sem query sensível, status e esses metadados. RequestId também é retornado em JSON e no header X-EstoqueGraal-Request-Id. Se a resposta falhar antes de o plugin executar (p.ex. proxy, sessão ou erro no carregamento do core), o identificador poderá estar indisponível: a interface informa isso explicitamente.
3. Um administrador autorizado procura o mesmo requestId no log do plugin gerado por Toolbox::logInFile('estoquegraal', ...) no diretório de logs configurado no GLPI. O novo registro informa action, status, phase, exceptionType, site relativo ao plugin (ou core-or-extension) e line. Compartilhe somente esses campos sanitizados. Mensagem bruta de exceção, SQL, stack completo, dados do chamado e caminhos absolutos não são registrados nesse diagnóstico. Se uma investigação adicional exigir logs gerais, o administrador deve sanitizá-los antes.
4. Erro de status renderização local significa que a resposta chegou, mas seu tratamento na interface falhou; não é apresentado como HTTP500 do servidor. Falha de rede tem status0. JSON/HTML inválido mantém status HTTP observado e requestId do header, quando disponível.
5. A partir da linha correlacionada será possível investigar a exceção real do ambiente. Não atribua o500 a cache/mensagem antiga sem verificar. Atualização das leituras foi corrigida localmente; a origem do500 instalado permanece pendente dessas evidências.

## Atualização 0.1.6 — consulta de operações pendentes

Atualização **somente do plugin**, sem novo backend ou migração. Substitua a pasta estoquegraal inteira pela do ZIP0.1.6, sem desinstalar e seguindo backup/cache/recarga completa já descritos. Arquivos de runtime alterados: `setup.php`, `lib/GlpiIntentStore.php` e `public/js/app.js`. Não apague tabela, intenções ou chaves idempotentes para corrigir este erro.

Defeito comprovado localmente com o construtor SQL oficial GLPI11.0.5: o formato `ORDERBY => ['id' => 'DESC']` era interpretado como uma lista contendo DESC e gerava ordenação pela coluna `DESC`, inexistente no schema do plugin. O formato corrigido é `ORDERBY => ['id DESC']`. Isso corrige a consulta sem alterar schema, isolamento ou estados de idempotência. O teste anterior aceitava qualquer array de consulta em um substituto do banco e não reproduzia o construtor SQL; a regressão agora cobre o formato real.

A ação intents usa o usuário da sessão, o ID real do chamado e sua entidade validados pelo GLPI, e a instância configurada. Consulta somente a tabela local glpi_plugin_estoquegraal_intents, filtrando prepared/sending/unknown/rejected, ordenando por id decrescente e limitando20. Não chama POST /movements nem consulta o catálogo externo. Sem registros, o servidor retorna sucesso/data:[] e a tela mostra **Nenhuma operação pendente**. Retorno inválido do banco, exceção ou serialização inválida continua sendo erro500 com diagnóstico; não vira lista vazia.

### Compatibilidade e evidência ainda pendente

Não houve acesso autorizado ao servidor/logs nem à estrutura instalada. A exceção do requestId `9bd63b545eae7c15f346457b8b43ea27` ainda não foi correlacionada; ação/status/requestId sozinhos não comprovam seu tipo. O usuário informou que não tem acesso ao log agora. Não é preciso esse acesso para aplicar e testar a correção local; se o erro persistir após atualização, correlacione o novo diagnóstico como descrito na seção0.1.5.

O schema esperado segue exatamente o hook de instalação existente: id (PK auto incremento), intent_key (único), users_id, tickets_id, entities_id, instance_id, operation, payload, state, result e date_creation. Não foi introduzida coluna ou índice, e o hook de instalação não foi alterado. Quando houver administrador autorizado, ele pode comparar **somente metadados** no ambiente de homologação:

```sql
SHOW COLUMNS FROM glpi_plugin_estoquegraal_intents;
SHOW INDEX FROM glpi_plugin_estoquegraal_intents;
```

Esses comandos não foram executados nesta entrega. Se faltar tabela/coluna/índice, guarde diagnóstico/backup e investigue histórico da instalação antes de propor migração. Não reinstale/desinstale para reconstruir automaticamente a tabela: isso pode perder intenções necessárias para recuperação. Não há script de alteração de schema para esta versão.

Após atualizar, recarregue a página completa e consulte a lista: registros existentes devem aparecer somente no seu contexto; lista realmente vazia deve mostrar Nenhuma operação pendente. Uma falha real deve manter o diagnóstico visível. Não repita movimentações para validar a lista.

## Atualização 0.1.7 — busca padrão e cadastro rápido

**Atualize também o backend do dashboard** antes do plugin. O frontend do dashboard não mudou, mas recompile o projeto conforme procedimento habitual. O backend precisa reconhecer os parâmetros opcionais availability/status e GET product-options; pacote novo com backend antigo mostra erro de consulta, sem assumir catálogo vazio. Não há migração de banco ou mudança nas regras de saldo/abertura. Em seguida atualize a pasta estoquegraal completa, sem desinstalar, mantendo configurações/direitos/intenções e seguindo cache/recarga completa da seção0.1.2.

Arquivos runtime alterados: backend/src/products.ts e integration.ts; plugin setup.php, ajax/endpoint.php, lib/ApiClient.php, lib/Operations.php, lib/View.php e public/js/app.js. O ZIP contém o plugin inteiro. Preserve o patch já presente no repositório; não substitua código atual por ZIP antigo. Os testes PHP novos ficam em tests/ na raiz, pois a cópia atual do plugin não contém a antiga pasta tests/.

Ao abrir a aba, a busca já consulta **somente produtos ativos com saldo operacional positivo**. Não é necessário selecionar filtro. Incluir produtos sem saldo começa desmarcada; marque para encontrar ativos zerados e registrar entrada. Paginação e contagem já consideram o filtro no servidor. Cada cartão mostra descrição, quantidade, unidade e distribuição por armários. Se não houver correspondências: Nenhum produto com saldo encontrado. Pesquisar também produtos sem saldo. O botão dessa mensagem amplia a consulta; a pesquisa de possíveis duplicatas continua ampla, inclusive inativos/sem saldo, independentemente dessa preferência.

O cadastro foi comparado ao formulário real Novo produto/productFields({}) em frontend/src/main.ts. Apresenta quatro campos de negócio, nesta ordem:

| Campo | Obrigatoriedade | Padrão e validação |
| --- | --- | --- |
| Descrição | Obrigatório | Vazio; texto após trim,1..2000 caracteres |
| Categoria | Opcional | Não classificada; vazio enviado como null, ID real do catálogo |
| Subcategoria | Opcional | Não informada; null por padrão, exige categoria compatível |
| Situação | Obrigatório | Ativo; seleção Ativo/Inativo, boolean no backend |

Armário só aparece no dashboard na edição de produto com abertura e não integra os quatro campos novos. Unidade permanece implícita unidade. As opções vêm do backend; subcategorias do plugin são restritas à categoria escolhida e mostram Categoria / Subcategoria. Falha na consulta é mostrada e impede revisar o cadastro até recuperação; não são inventadas opções. Não se pede identidade, instância ou chamado ao usuário.

O alerta de similaridade continua antes de preparar e o backend revalida antes de salvar. É um produto diferente só aparece quando há candidatos; a justificativa adicional só aparece/é exigida quando essa confirmação é marcada. Usar produto existente evita novo cadastro. Produto inativo não é reativado automaticamente; eventual revisão de situação segue o dashboard. Erro de validação do cadastro fica separado da lista de candidatos, mantendo-a visível.

Cadastro não cria quantidade. Novo produto da integração continua com base zero e primeira entrada separada, revisada e confirmada. Falha/reenvio da entrada não repete cadastro. Produto criado inativo não pode ser movimentado enquanto sua situação não for revista pelo fluxo existente.

## Configuração assistida em homologação (plugin 0.1.8)

O script scripts/configurar-dashboard.sh prepara HTTP por IP privado e executa configurar-glpi.sh por SSH. Consulte docs/configuracao-automatica.md no repositório do dashboard. HTTP privado exige deployment_mode=homologacao e private_http explícito; produção mantém HTTPS. O ZIP inclui helper CLI protegido em tools/configure-cli.php. Não usar o arquivo .env inteiro como payload.
