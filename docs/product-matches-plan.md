# Seleção e prevenção de duplicatas — 23/10/2026

Escopo autorizado: corrigir seleção/visibilidade/erros no plugin; adicionar consulta e validação central de possíveis duplicatas, sem modificar estoque, legado ou permissões. Sem servidor real, commit ou migração.

1. Regressões locais: seleção dinâmica, zero/positivo, armários entrada/saída, erro/vazio; comparação normalizada e backend concorrente/idempotente.
2. Serviço reutilizado ProductService: endpoint aditivo product-matches nas duas APIs; comparação de tokens sem acentos, ordem e espaços; unidades numéricas juntas. Sem fusão, sem nova restrição SQL. Campo opcional duplicateConfirmation com candidatos revisados e justificativa; revalidação transacional antes do INSERT. Auditoria da exceção. IDs únicos existentes não são editáveis na integração e permanecem sob constraints.
3. Dashboard e plugin: busca de candidatos com debounce/geração; usar existente, avisar inativo; confirmação justificada para distinto. Falha de consulta bloqueia o fluxo. Plugin seleção exibe foco/scroll, loading e falha local; zero selecionável e entrada elegível.
4. Verificar tipos/build, suites isoladas e navegador sintético; documentação/OpenAPI e pacote versão nova. Homologação GLPI pendente.

Concluído:64 testes backend, PHP12 grupos e regressões assets/endpoint, Node2, HTTP loopback, navegador isolado nas duas interfaces, build/lint. Revisão independente com3 achados corrigidos. Pacote0.1.4; homologação real pendente.
