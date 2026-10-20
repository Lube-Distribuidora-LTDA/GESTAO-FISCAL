/* =============================================================================
 * pag-regioes.js — REGIÕES: as regiões escolhidas, uma a uma: quantos produtos
 * estão completos, sem tributação, sem preço, sem os dois ou fora da tabela, quantos
 * clientes compram nelas e quanto venderam. Clique abre o relatório da região.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var MAIS = ["filialReg", "secao", "produto", "ncm", "trib", "estoque", "venda", "cadastro", "vendaReg"];

L.registrarPagina({
  id: "regioes", grupo: "Tributação e preço", menu: "Regiões", icone: "pino",
  titulo: "Regiões", olho: "Pendências, clientes e venda de cada região", semPeriodo: true,
  filtros: ["regiao", "uf", "depto", "fornecedor", "pendencia"], mais: MAIS,
  render: render,
});

function render(raiz) {
  var sel = L.filtrar(L.spec()), R = L.R, linhas = L.porRegiao(sel);
  // ---------------- pendências por região (colunas empilhadas)
  var p = L.painel({ titulo: "Pendências por região", sub: "produto × região sem tributação e/ou sem preço · clique para abrir a região naquela situação", classe: "c-12" });
  var g = L.h("div"); p.corpo.appendChild(g);
  var series = [1, 2, 3, 4].map(function (s) { return { nome: L.SITUACOES[s].nome, cor: L.corSit(s), valores: linhas.map(function (x) { return x.sit[s]; }) }; });
  L.graf.colunas(g, { categorias: linhas.map(function (x) { return String(R.num[x.ri]); }), modo: "empilhado", altura: 290, fmt: function (v) { return L.fAbrev(v, false); }, rotulos: true, series: series,
    dica: function (i) { var x = linhas[i]; return { titulo: "Região " + L.nomeRegiao(x.ri) + " · " + R.uf[x.ri], linhas: [1, 2, 3, 4].map(function (s) { return { rot: L.SITUACOES[s].nome, cor: L.corSit(s), val: L.fInt(x.sit[s]) }; }).concat([{ rot: "Completos", val: L.fInt(x.sit[0]) + " (" + L.fPct(x.cobertura, 1) + ")" }]) }; },
    aoClicar: function (i, s, ev) { L.clique("regiao", R.num[linhas[i].ri], ev, s != null ? { f: { pendencia: [s + 1] } } : null); } });
  p.corpo.appendChild(L.graf.legenda([1, 2, 3, 4].map(function (s) { return { rot: L.SITUACOES[s].nome, cor: L.corSit(s) }; })));
  raiz.appendChild(L.grade(p));

  // ---------------- tabela
  var tab = L.tabela({
    titulo: "Regiões — tributação e preço", arquivo: "fiscal-regioes", aba: "Regiões", porPagina: 25, linhas: linhas, ordem: { id: "num", desc: false },
    buscaTexto: function (x) { return R.num[x.ri] + " " + R.nome[x.ri] + " " + R.uf[x.ri]; }, buscaDica: "Buscar região por número, nome ou UF…",
    colunas: [
      { id: "nome", titulo: "Região", tipo: "texto", valor: function (x) { return R.nome[x.ri]; } },
      { id: "num", titulo: "Nº", tipo: "inteiro", valor: function (x) { return R.num[x.ri]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "uf", titulo: "UF", tipo: "texto", valor: function (x) { return R.uf[x.ri]; } },
      { id: "fil", titulo: "Filial", tipo: "texto", valor: function (x) { return R.fil[x.ri] === "99" ? "todas" : R.fil[x.ri]; }, essencial: false },
      { id: "ok", titulo: "Completos", tipo: "inteiro", valor: function (x) { return x.sit[0]; } },
      { id: "s1", titulo: "Sem tributação", tipo: "inteiro", valor: function (x) { return x.sit[1]; }, classe: function (v) { return v ? "neg" : ""; }, dica: "Tem preço e falta a tributação" },
      { id: "s2", titulo: "Sem preço", tipo: "inteiro", valor: function (x) { return x.sit[2]; }, dica: "Tem tributação e falta o preço" },
      { id: "s3", titulo: "Sem os dois", tipo: "inteiro", valor: function (x) { return x.sit[3]; } },
      { id: "s4", titulo: "Fora da 201", tipo: "inteiro", valor: function (x) { return x.sit[4]; }, dica: "Produto nunca precificado na região" },
      { id: "cob", titulo: "Cobertura", tipo: "pct", valor: function (x) { return x.cobertura; }, barra: true, somar: false },
      { id: "vp", titulo: "Venderam e têm pendência", tipo: "inteiro", valor: function (x) { return x.vendPend; } },
      { id: "cli", titulo: "Clientes ativos", tipo: "inteiro", valor: function (x) { return R.cliA[x.ri]; }, essencial: false },
      { id: "cli12", titulo: "Compraram (" + L.META.meses_venda + " meses)", tipo: "inteiro", valor: function (x) { return R.cli12[x.ri]; }, essencial: false },
      { id: "vv", titulo: "Venda " + L.META.meses_venda + " meses (R$)", tipo: "moedaInt", valor: function (x) { return R.vV[x.ri]; }, exportarTipo: "moeda" },
      { id: "vpr", titulo: "Produtos vendidos", tipo: "inteiro", valor: function (x) { return R.vP[x.ri]; }, essencial: false },
      { id: "ult", titulo: "Última venda", tipo: "texto", valor: function (x) { return R.ult[x.ri]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) : "—"; }, exp: function (x) { return R.ult[x.ri] >= 0 ? L.fDia(R.ult[x.ri]) : ""; }, essencial: false },
    ],
    totais: function (res) { var l = res.todas || res.linhas, s = [0, 0, 0, 0, 0]; l.forEach(function (x) { for (var k = 0; k < 5; k++) s[k] += x.sit[k]; });
      return [{ rot: "Regiões", valor: String(l.length), pri: true }, { rot: "Sem tributação", valor: L.fInt(s[1] + s[3] + s[4]) }, { rot: "Sem preço", valor: L.fInt(s[2] + s[3] + s[4]) }, { rot: "Completos", valor: L.fInt(s[0]) }]; },
    aoClicar: function (x, ev) { L.clique("regiao", R.num[x.ri], ev); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Cada região", sub: "produtos ativos (com os filtros da tela) · venda dos últimos " + L.META.meses_venda + " meses · clique para abrir", classe: "c-12", semPad: true, corpo: tab })));
  raiz.appendChild(L.nota("Regiões escolhidas no ENV da carga (FISCAL_REGIOES): " + Array.prototype.map.call(R.num, String).join(", ") + ". Cliente ativo = não excluído e não bloqueado, na região própria do cliente ou na da praça dele (rotina 302). \"Sem tributação\" e \"sem preço\" no total incluem os produtos sem os dois e os fora da tabela."));
}

})();
