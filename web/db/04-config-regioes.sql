-- =============================================================================
-- Migração fiscal_04_config_regioes (2026-10-23)
-- A lista de regiões passa a morar no banco: a carga lê fiscal.config 'regioes' no começo de cada rodada
-- (etl/consultas_fiscal.py, regioes_do_banco). Trocar região = um UPDATE aqui, sem mexer na VM.
-- Sem a linha, vale FISCAL_REGIOES do ENV e, por último, o REGIOES_PADRAO do código.
-- =============================================================================
create table if not exists fiscal.config (
  chave          text primary key,
  valor          text not null,
  observacao     text,
  atualizado_em  timestamptz not null default now()
);
alter table fiscal.config enable row level security;
comment on table fiscal.config is 'Configuração da carga do GESTÃO FISCAL. regioes = lista de NUMREGIAO separada por vírgula.';

insert into fiscal.config (chave, valor, observacao)
values ('regioes', '18,19,23,31,33,35,37,38,42,43',
        'Júlio, 2026-10-23: tirou 39, 41, 45 e 46 (manhã) e 27 e 40 (meio-dia). Antes: 16 regiões (2026-10-20).')
on conflict (chave) do update set valor = excluded.valor, observacao = excluded.observacao, atualizado_em = now();

-- Para trocar as regiões depois (exemplo):
--   update fiscal.config set valor = '18,19,23,31,33,35,37,38,42,43', atualizado_em = now() where chave = 'regioes';
