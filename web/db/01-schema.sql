-- =============================================================================
-- GESTÃO FISCAL — schema `fiscal` no DATA WAREHOUSE
-- Migração fiscal_01_schema (2026-10-20).
--
-- Primeiro módulo: TRIBUTAÇÃO E PREÇO POR REGIÃO. Fonte: WinThor, rotina 201
-- (Precificar Produto → PCTABPR: preço de venda e tributação de saída por região),
-- 203 (Cadastrar Produto → PCPRODUT), 302 (clientes por região → PCCLIENT/PCPRACA),
-- 514 (tipos de tributação → PCTRIBUT) e 572 (regiões → PCREGIAO), mais a venda
-- faturada (PCMOV) e o estoque de hoje (PCEST).
-- Carga: etl/sync_fiscal.py (TRUNCATE + INSERT nos fatos, upsert nos cadastros).
-- Toda tabela com RLS ligado e SEM políticas: a chave pública não lê nada; só o ETL
-- e as funções da Vercel (credencial de servidor).
-- =============================================================================

create schema if not exists fiscal;
comment on schema fiscal is
  'GESTÃO FISCAL: tributação e preço de venda por região (rotina 201 do WinThor, PCTABPR). ETL em Desktop\BI\17. FISCAL.';

-- ----------------------------------------------------------------------------- controle
create table if not exists fiscal.controle_carga (
  id               bigserial primary key,
  consulta         text,
  tabela_destino   text,
  status           text,
  linhas           integer,
  linhas_esperadas integer,
  segundos         numeric,
  mensagem         text,
  executado_em     timestamptz default now()
);
create index if not exists controle_carga_executado_em on fiscal.controle_carga (executado_em desc);

-- ----------------------------------------------------------------------------- cadastros
-- 514: o que cada CODST significa
create table if not exists fiscal.tributacao (
  codst          integer primary key,
  mensagem       text,
  obs            text,
  sittribut      text,                 -- CST
  aliq_icms      numeric,              -- CODICM
  aliq_icms_tab  numeric,              -- CODICMTAB
  iva            numeric,
  perc_base_red  numeric,
  cfop           integer,              -- CODFISCAL (dentro do estado)
  cfop_inter     integer,              -- CODFISCALINTER
  atualizado_em  timestamptz default now()
);

-- 572 + 302: regiões e quantos clientes compram em cada uma
create table if not exists fiscal.regiao (
  numregiao           integer primary key,
  regiao              text,
  uf                  text,
  codfilial           text,             -- 99 = todas
  status              text,             -- A / I (nulo conta como ativa)
  ativa               boolean not null default true,
  clientes            integer not null default 0,
  clientes_ativos     integer not null default 0,   -- não excluído e não bloqueado
  clientes_compraram  integer not null default 0,   -- DTULTCOMP dentro da janela de venda
  no_painel           boolean not null default false, -- uma das regiões escolhidas (ENV FISCAL_REGIOES; migração 03)
  atualizado_em       timestamptz default now()
);

-- 203: produto. O core.dim_produto (dono: BI COMPRAS) não tem departamento, seção, NCM nem
-- REVENDA — exceção consciente, como no `inventario.produto`. Quando o dono ganhar essas
-- colunas, este sistema passa a ler de lá.
create table if not exists fiscal.produto (
  codprod        integer primary key,
  descricao      text,
  embalagem      text,
  unidade        text,
  ncm            text,                 -- NBM
  codfornec      integer,
  fornecedor     text,
  codepto        integer,
  departamento   text,
  codsec         integer,
  secao          text,
  fora_de_linha  boolean not null default false,   -- OBS2 = 'FL'
  revenda        boolean not null default true,    -- REVENDA <> 'N'
  excluido       boolean not null default false,   -- DTEXCLUSAO preenchida
  dtcadastro     date,
  estoque        numeric not null default 0,       -- QTESTGER somado nas filiais de distribuição
  atualizado_em  timestamptz default now()
);

-- ----------------------------------------------------------------------------- fatos
-- 201: uma linha por produto × região, como o WinThor gravou (só produtos não excluídos)
create table if not exists fiscal.fato_preco_regiao (
  codprod       integer not null,
  numregiao     integer not null,
  codst         integer,              -- tributação de saída da região (PCTRIBUT)
  pvenda        numeric,              -- preço de venda
  ptabela       numeric,              -- preço de tabela
  dt_alt_preco  timestamp,            -- DTULTALTPVENDA
  rotina        text,                 -- quem alterou por último (201, 552, 507...)
  primary key (codprod, numregiao)
);
create index if not exists fato_preco_regiao_regiao on fiscal.fato_preco_regiao (numregiao);

-- venda faturada (CODOPER 'S', não cancelada) dos últimos meses, por produto × região
create table if not exists fiscal.fato_venda_regiao (
  codprod       integer not null,
  numregiao     integer not null,
  linhas        integer not null,
  qt            numeric,
  valor         numeric,             -- QT × (PUNIT + VLOUTROS)
  ultima_venda  date,
  primary key (codprod, numregiao)
);

-- ----------------------------------------------------------------------------- pacote do painel
create table if not exists fiscal.painel_cache (
  id          smallint primary key default 1 check (id = 1),
  gerado_em   timestamptz not null default now(),
  versao      text not null,
  bytes_json  integer,
  bytes_gz    integer,
  payload_gz  bytea not null
);

-- ----------------------------------------------------------------------------- RLS
alter table fiscal.controle_carga    enable row level security;
alter table fiscal.tributacao        enable row level security;
alter table fiscal.regiao            enable row level security;
alter table fiscal.produto           enable row level security;
alter table fiscal.fato_preco_regiao enable row level security;
alter table fiscal.fato_venda_regiao enable row level security;
alter table fiscal.painel_cache      enable row level security;

revoke all on schema fiscal from anon, authenticated;
