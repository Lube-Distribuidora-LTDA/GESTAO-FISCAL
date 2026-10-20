/* =============================================================================
 * pag-visao.js — VISÃO GERAL: quantos produtos estão sem tributação ou sem preço
 * de venda nas regiões escolhidas, onde (região, departamento, fornecedor) e o que
 * é mais urgente (vendeu na região nos últimos meses e hoje tem pendência).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var MAIS = ["uf", "filialReg", "secao", "produto", "ncm", "trib", "estoque", "venda", "cadastro", "vendaReg"];

L.registrarPagina({
  id: "visao", grupo: "Tributação e preço", menu: "Visão geral", icone: "home",
  titulo: "Tributação e preço por região", olho: "Rotina 201 · produtos ativos nas regiões escolhidas", semPeriodo: true,
  filtros: ["regiao", "depto", "fornecedor", "pendencia"], mais: MAIS,
  render: render,
});

/* leva a lista de produtos já filtrada pela pendência do cartão clicado */
function irProdutos(pend, vendeu) {
  var f = L.estado.filtros;
  f.pendencia = pend.slice(); if (vendeu) f.vendaReg = [1]; else delete f.vendaReg;
  L.irPara("produtos");
}

function render(raiz) {
  var sel = L.filtrar(L.spec()), r = L.resumo(sel);
  if (L.TRIB_INEXISTENTE) raiz.appendChild(L.h("div", { class: "aviso-faixa atencao" }, L.icEl("aviso"),
    L.h("span", { html: "<b>" + L.fInt(L.TRIB_INEXISTENTE) + " produto × região</b> apontam para um CODST que não existe no cadastro de tributações (rotina 514). Eles contam como <b>sem tributação</b>." })));
  raiz.appendChild(L.kpisFiscais(r, irProdutos));
  if (!r.cel) { raiz.appendChild(L.h("div", { class: "vazio grande", html: "<b>Nada com estes filtros</b>Limpe algum filtro para ver os produtos." })); return; }

  // ---------------- regiões + rosca
  var pReg = L.painel({ titulo: "Situação por região", sub: "produtos ativos em cada região · clique na barra para abrir a região (na cor clicada, só aquela situação)", classe: "c-7" });
  var bReg = L.h("div"); pReg.corpo.appendChild(bReg);
  L.graficoSituacaoRegiao(bReg, sel);
  pReg.corpo.appendChild(L.legendaSituacoes());

  var pSit = L.painel({ titulo: "Produto × região", sub: L.fInt(r.cel) + " combinações · clique para abrir", classe: "c-5" });
  var bSit = L.h("div"); pSit.corpo.appendChild(bSit);
  var fat = L.SITUACOES.map(function (s) { return { rot: s.nome, valor: r.porSit[s.id], cor: L.corSit(s.id), corTexto: s.id === 0 || s.id === 2 ? "#0b1533" : "#fff", idxOriginal: s.id }; });
  L.graf.rosca(bSit, { fatias: fat, altura: 250, fmt: L.fInt, centro: { valor: L.fPct(r.cobertura, 0), titulo: "completas" },
    dica: function (i) { var s = L.SITUACOES[i]; return { titulo: s.nome, linhas: [{ rot: "Combinações", val: L.fInt(r.porSit[i]) + " (" + L.fPct(r.porSit[i] / r.cel, 1) + ")" }, { rot: "Produtos", val: L.fInt(r.prodSit[i]) }], extra: '<div class="dica-sub">' + L.esc(s.dica) + "</div>" }; },
    aoClicar: function (i, s, ev) { L.clique("pendencia", i, ev); } });
  pSit.corpo.appendChild(L.graf.legendaLista(fat, L.fInt, function (i, ev) { L.clique("pendencia", i, ev); }));
  raiz.appendChild(L.grade(pReg, pSit));

  // ---------------- departamentos e fornecedores
  var pDep = L.painel({ titulo: "Departamentos com pendência", sub: "produtos com alguma região sem tributação ou sem preço · clique para abrir · Ctrl+clique filtra", classe: "c-6" });
  barras(pDep.corpo, sel, "depto", 9);
  var pFor = L.painel({ titulo: "Fornecedores com pendência", sub: "produtos com alguma região sem tributação ou sem preço · clique para abrir · Ctrl+clique filtra", classe: "c-6" });
  barras(pFor.corpo, sel, "fornecedor", 9);
  raiz.appendChild(L.grade(pDep, pFor));

  // ---------------- mais urgentes
  var urg = L.celulas(sel, function (c) { return L.C.s[c] !== 0 && L.C.vn[c] > 0; });
  var tab = L.tabelaCelulas(urg, { titulo: "Venderam na região e hoje têm pendência", arquivo: "fiscal-vendeu-e-tem-pendencia", aba: "Mais urgentes", rank: true,
    filtrosTexto: function () { return L.descricaoFiltros([["Lista", "produto × região que vendeu nos últimos " + L.META.meses_venda + " meses e hoje está sem tributação ou sem preço"]]); } });
  raiz.appendChild(L.grade(L.painel({ titulo: "Mais urgentes: venderam na região e hoje estão sem tributação ou sem preço", sub: "venda faturada dos últimos " + L.META.meses_venda + " meses na própria região · do maior para o menor · clique para abrir o produto", classe: "c-12", semPad: true, corpo: tab })));
  raiz.appendChild(L.nota("Situação de hoje na rotina 201 (PCTABPR), carga de " + L.fDataHora(L.META.carga || L.META.gerado_em) + ". Só produtos ativos (em linha, de revenda, fora do fornecedor INATIVOS e sem itens de consumo) × as " + L.R.n + " regiões escolhidas. \"Sem tributação\" = sem CODST na região (ou CODST que não existe na 514); \"sem preço\" = preço de venda zero ou vazio; \"fora da 201\" = o produto nunca foi precificado na região. A tributação por UF (PCTABTRIB) está desligada no WinThor e não entra."));
}

function barras(corpo, sel, dim, n) {
  var gr = L.agruparProd(sel, dim).filter(function (x) { return x.pend; }), top = gr.slice(0, n), tot = gr.reduce(function (s, x) { return s + x.pend; }, 0), box = L.h("div");
  corpo.appendChild(box);
  if (!top.length) { box.appendChild(L.h("div", { class: "vazio", html: "<b>Nenhuma pendência</b>Todos os produtos estão completos nas regiões da tela." })); return; }
  L.graf.barras(box, {
    itens: top.map(function (x) { return { rot: L.nomeDe(dim, x.k), valor: x.pend }; }), total: tot, fmt: L.fInt, linhaH: 28,
    cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var x = top[i]; return { titulo: L.nomeDe(dim, x.k), linhas: [{ rot: "Produtos com pendência", val: L.fInt(x.pend) + " de " + L.fInt(x.prod) }, { rot: "Com região sem tributação", val: L.fInt(x.semTrib) }, { rot: "Com região sem preço", val: L.fInt(x.semPreco) }, { rot: "Produto × região pendentes", val: L.fInt(x.celPend) }] }; },
    aoClicar: function (i, s, ev) { L.clique(dim, top[i].k, ev); },
  });
}

})();
