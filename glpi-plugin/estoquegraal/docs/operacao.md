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

Cadastrar produto é operação separada: cria produto ativo em unidades, sem quantidade. **A API atual não oferece abertura de estoque: abra o saldo no dashboard antes de registrar a entrada pelo plugin.** Falha na entrada não repete o cadastro. Não existem edição direta de saldo, exclusão de movimentos ou estorno pelo plugin; histórico mostra estornos registrados no dashboard.

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
