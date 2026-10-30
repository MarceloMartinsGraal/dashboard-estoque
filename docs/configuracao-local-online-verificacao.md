# Verificação do configurador local/online — 0.1.9

Dashboard e GLPI no mesmo Ubuntu/Oracle. Nenhum acesso ao servidor, GLPI, banco real ou arquivo .env real foi realizado.

- Python: 31 testes passaram, incluindo separação de origem pública/URL interna, modos, preservação de configuração e execução sem SSH. Os comandos de instalação são simulados nesses testes.
- CLI PHP real com cURL para API sintética em loopback: persistência do opt-in local_http e recusa de HTTP público/flag inválida. Kernel, Config e banco GLPI simulados; isso não equivale à homologação GLPI.
- Regressões PHP: busca/proxy, HTTP privado, configuração e cadastro rápido passaram.
- Revisão de código: corrigido compartilhamento do limite de login pelo IP do gateway; proxy HTTPS do host deve sobrescrever X-Graal-Client-IP. Verificação do manifesto e configuração Nginx é estática.

Não há Docker/Nginx executável disponível neste PC. Build de imagem, validação Compose pelo Docker, nginx -t, instalação no Ubuntu, permissões reais do PHP, proxy TLS, conectividade e GLPI 11.0.5 continuam pendentes de homologação autorizada. Não há migração nova ou alteração de regra de estoque.

Tipos, lint e build passaram. Suíte geral Node: 95 testes passaram, zero falhas, em PostgreSQL local sintético. ZIP 0.1.9: 27 arquivos, raiz estoquegraal/, helper e assets conferidos byte a byte com o fonte, ausência de .env/work/node_modules, geração reproduzível e regras de ignore verificadas. Links dos guias novos conferidos. O guia [configuracao-local-online.md](configuracao-local-online.md) explica comandos, atualização e limites.
