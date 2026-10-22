// Busca portuguesa sem extensão PostgreSQL e sem modificar descrições persistidas.
export const foldSql = (sql: string) =>
  `lower(translate(${sql},'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'))`;
export const foldText = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
