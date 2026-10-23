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
