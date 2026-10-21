# Melhorias do dashboard — 21/10/2026

Escopo aprovado no pedido: histórico com abas/filtros/URL, seleção de armários, quantidades e marca. Referência visual externa: Downloads/AGENTS.md; não substitui AGENTS.md operacional.

1. Testar formatação decimal, consultas de histórico combinadas/paginadas e opções de armários sem associação prévia. Reproduzir catálogo desatualizado no navegador.
2. Implementar consulta de histórico no servidor, incluindo direção do estorno e realocações separadas; preservar origens, referências e datas. Filtros na URL e acesso por produto.
3. Buscar catálogo/saldos ao abrir movimentação; origens com saldo, destinos ativos completos, seleção explícita e atualização após cadastro. Página de armários com busca/saldos por unidade.
4. Centralizar formatação pt-BR sem alterar valores de API. Aplicar SVGs oficiais copiados byte a byte e fontes locais, tokens dourado/grafite/neutros; sem tema novo.
5. Executar testes sintéticos PostgreSQL, build, tipos e navegador com capturas. Documentar causa e limites. Sem commit/push/deploy/carga real.


## Resultado

Etapas implementadas e verificadas. 42 testes aprovados em PostgreSQL real isolado; tipos e build aprovados. Revisão independente corrigida: direção dos armários conforme deltas, preservação da origem legada ao navegar pelo produto, formatação da prévia, nome do responsável nos filtros ativos e página inteira na URL. Navegador verificou cadastro/seleção com 125 armários, entrada em novo local, saída/realocação/estorno, filtros, paginação e reload, teclado, logos/fontes, contraste principal e viewport móvel. Capturas registradas com dados sintéticos. AGENTS.md operacional preservado; manual visual apenas como referência. Sem migração ou escrita em dados reais; sem commit, push ou deploy.
