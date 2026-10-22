# Plugin Estoque Graal — plano de implementação

Execução nativa autorizada pelo pedido de22/10/2026, sem commits. Skills: planejamento, TDD, investigação quando necessário, revisão independente e verificação. Escopo: arquivos/testes/pacote; nenhum acesso a instalação GLPI ou estoque real.

Alvo explícito GLPI11.0.5 (min11.0.5/max11.0.6 exclusivo), PHP>=8.2/64bits/curl/json e dependências do GLPI; PHPportátil8.3 obtido oficialmente só para testes em work, sem instalação no servidor. Fontes oficiais tag11.0.5 e SHA dos arquivos consultados serão documentados.

- [x] Cliente PHP com URL configurada exclusivamente no servidor, TLS obrigatório salvo loopbackdev explícito, timeouts e sem redirects. Testes sintéticos de contrato/erros/segredos.
- [x] Intenções persistidas localmente no GLPI por usuário/chamado, chave aleatória por confirmação, payload imutável, aquisição atômica para duplo clique e resultado desconhecido recuperável; nenhuma transação GLPI aberta durante HTTP. Testes com repositório simulado e servidorAPIloopback.
- [x] Hooks de instalação/configuração/abaTicket/perfis; segredos via Config+secured_configs/GLPIKey oficiais. Direitos próprios READ/UPDATE/CREATE inicialmente0; acessoTicket/entidade e usuário em cada chamada. CSRF AJAX X-Glpi-Csrf-Token conforme listener11.0.5.
- [x] UI PHP/JS/CSS restritos ao plugin, HTML escapado/textContent, debounce/paginação/revisão/estados, cadastro separado. Sem hooks de status ou comentários do chamado.
- [x] Documentação, testes e pacote estoquegraal/ com manifesto/hash. Sem alterar API/dashboard. Revisão independente, PHP-lint e testes locais, JS e contrato; limitações explícitas de ausência de GLPI/MySQL reais.

Lacunas documentadas: cadastro não abre saldo; integração não tem endpoint de identidade da credencial (administrador deve conferir instância; resposta de movimento/resultado deve coincidir). Nenhum endpoint fictício ou alteração silenciosa no dashboard.

Verificado: 11 grupos PHP, 2 testes Node, teste cURL com servidor sintético, prévia Edge isolada e sintaxe PHP/JS. Revisão estática independente concluída; correção da corrida de retomada validada em navegador. Instalação/CSRF/criptografia/banco do GLPI real continuam pendentes, conforme documentação.
