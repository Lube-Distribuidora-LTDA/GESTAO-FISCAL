/* =============================================================================
 * pag-mapa.js — MAPA PRODUTO × REGIÃO: uma linha por produto, uma coluna por região,
 * cada quadradinho na cor da situação. Passando o mouse: tributação, CST, ICMS, preço
 * e venda daquela região. Clique no quadradinho: relatório do produto; no cabeçalho:
 * relatório da região. Excel com a matriz inteira (o nome da situação em cada célula).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var MAIS = ["uf", "filialReg", "secao", "produto", "ncm", "trib", "estoque", "venda", "cadastro", "vendaReg"];
var est = { pag: 0, porPag: 50, busca: "", ord: "venda" };

L.registrarPagina({
  id: "mapa", grupo: "Tributação e preço", menu: "Mapa produto × região", icone: "grade",
  titulo: "Mapa produto × região", olho: "Cada quadradinho é a situação do produto na região", semPeriodo: true,
  filtros: ["regiao", "pendencia", "depto", "fornecedor", "situacaoProd"], mais: MAIS,
  render: render,
});

function render(raiz) {
  var sel = L.filtrar(L.spec()), modo = L.estado.pend || "com";
  var todas = L.porProduto(sel, modo === "com");
  var corpo = L.h("div");
  var p = L.painel({ titulo: "Produto × região", sub: L.fInt(todas.length) + " produtos × " + sel.regs.length + " regiões · passe o mouse para ver a tributação e o preço · clique no quadradinho para abrir o produto, no número da região para abrir a região", classe: "c-12", semPad: true, corpo: corpo, acoes: L.legendaSituacoes() });
  raiz.appendChild(L.grade(p));
  desenhar(corpo, sel, todas, modo);
}

function desenhar(corpo, sel, todas, modo) {
  var P = L.P, R = L.R, C = L.C, nR = R.n;
  L.limpar(corpo);
  // ---- topo: busca, ordem, pendentes, Excel
  var topo = L.h("div", { class: "tb-topo" });
  var inp = L.h("input", { type: "search", placeholder: "Buscar produto por código, nome ou NCM…", value: est.busca, autocomplete: "off", spellcheck: "false" }), tm;
  inp.addEventListener("input", function () { clearTimeout(tm); tm = setTimeout(function () { est.busca = inp.value; est.pag = 0; desenhar(corpo, sel, todas, modo); }, 220); });
  topo.appendChild(L.h("label", { class: "tb-busca" }, L.icEl("busca"), inp));
  if (est.busca) setTimeout(function () { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 0);
  topo.appendChild(L.h("span", { style: { flex: 1 } }));
  var seg = L.h("div", { class: "seg", title: "Ordem das linhas" });
  [["venda", "Mais venda"], ["pend", "Mais pendências"], ["desc", "A–Z"]].forEach(function (o) { seg.appendChild(L.h("button", { type: "button", class: est.ord === o[0] ? "on" : "", text: o[1], onclick: function () { est.ord = o[0]; est.pag = 0; desenhar(corpo, sel, todas, modo); } })); });
  topo.appendChild(seg);
  topo.appendChild(L.segPendentes("pend", modo, function (m) { L.estado.pend = m; est.pag = 0; L.sincronizarHash(); L.emitir("filtros"); }));
  var linhas = todas;
  if (est.busca) { var termos = L.norm(est.busca).split(/\s+/).filter(Boolean); linhas = linhas.filter(function (x) { var t = L.norm(P.cod[x.pi] + " " + P.desc[x.pi] + " " + P.ncm[x.pi]); return termos.every(function (q) { return t.indexOf(q) >= 0; }); }); }
  linhas = linhas.slice().sort(est.ord === "venda" ? function (a, b) { return b.vv - a.vv; } : est.ord === "desc" ? function (a, b) { return P.desc[a.pi].localeCompare(P.desc[b.pi], "pt-BR"); } : function (a, b) { return b.pend - a.pend || b.vendPend - a.vendPend || b.vv - a.vv; });
  topo.appendChild(L.h("button", { class: "mini-btn", type: "button", html: L.ic("baixar") + " Excel", title: "Baixa a matriz inteira (todas as linhas da busca e dos filtros)", onclick: function () { exportar(sel, linhas); } }));
  corpo.appendChild(topo);
  if (!linhas.length) { corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Nada por aqui</b>Nenhum produto com os filtros atuais." })); return; }

  // ---- totais por região (pendências)
  var porReg = L.porRegiao(sel);
  // ---- tabela
  var tab = L.h("table", { class: "tabela mapa" }), trh = L.h("tr");
  trh.appendChild(L.h("th", { class: "f1", text: "Produto" }));
  trh.appendChild(L.h("th", { class: "d", text: "Pend.", title: "Regiões com pendência (sem tributação, sem preço ou os dois)" }));
  porReg.forEach(function (x) {
    var ri = x.ri, th = L.h("th", { class: "col-reg" }, L.h("b", { text: String(R.num[ri]) }), L.h("small", { text: R.uf[ri] }));
    th.addEventListener("mousemove", function (ev) { L.dica.mostrar(ev, { titulo: "Região " + L.nomeRegiao(ri), linhas: L.SITUACOES.map(function (s) { return { rot: s.nome, cor: L.corSit(s.id), val: L.fInt(x.sit[s.id]) }; }).concat([{ rot: "Venda (" + L.META.meses_venda + " meses)", val: R.vL[ri] ? L.fR(R.vV[ri]) : "sem venda" }]), clique: "Clique para abrir a região" }); });
    th.addEventListener("mouseleave", L.dica.esconder);
    th.addEventListener("click", function (ev) { L.clique("regiao", R.num[ri], ev); });
    trh.appendChild(th);
  });
  tab.appendChild(L.h("thead", null, trh));
  var tb = L.h("tbody"), off = est.pag * est.porPag, pag = est.porPag ? linhas.slice(off, off + est.porPag) : linhas;
  pag.forEach(function (x) {
    var pi = x.pi, tr = L.h("tr");
    var td0 = L.h("td", { class: "f1 click" }, L.h("span", { class: "cel-foto" }, L.fotoMini(pi), L.h("span", { class: "cel-txt" }, L.h("b", { text: P.desc[pi] }), L.h("small", { text: "cód. " + P.cod[pi] + (P.fl[pi] ? " · fora de linha" : "") }))));
    td0.addEventListener("click", function (ev) { L.clique("produto", P.cod[pi], ev); });
    tr.appendChild(td0);
    tr.appendChild(L.h("td", { class: "d num " + (x.pend ? "pend" : "zero"), text: x.pend ? String(x.pend) : "0" }));
    porReg.forEach(function (rx) {
      var c = pi * nR + rx.ri, td = L.h("td", { class: "cel-m" });
      if (sel.ok(c)) {
        var s = C.s[c], q = L.h("span", { class: "q s" + s + (C.vn[c] > 0 ? " vendeu" : ""), text: L.SITUACOES[s].sigla });
        q.addEventListener("mousemove", function (ev) { L.dica.mostrar(ev, L.dicaCelula(c)); });
        q.addEventListener("mouseleave", L.dica.esconder);
        q.addEventListener("click", function (ev) { L.clique("produto", P.cod[pi], ev); });
        td.appendChild(q);
      }
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tab.appendChild(tb);
  var tf = L.h("tr", null, L.h("td", { class: "f1", text: "Pendências na região" }), L.h("td", { class: "d num", text: L.fInt(porReg.reduce(function (s, x) { return s + x.pend; }, 0)) }));
  porReg.forEach(function (x) { tf.appendChild(L.h("td", { class: "d num tot-reg" + (x.pend ? "" : " zero"), text: L.fAbrev(x.pend, false), title: L.fInt(x.pend) + " produtos com pendência na região " + R.num[x.ri] })); });
  tab.appendChild(L.h("tfoot", null, tf));
  corpo.appendChild(L.h("div", { class: "tb-wrap mapa-wrap" }, tab));

  // ---- paginação
  var pe = L.h("div", { class: "tb-pe" }), nPag = est.porPag ? Math.max(1, Math.ceil(linhas.length / est.porPag)) : 1;
  if (est.pag >= nPag) est.pag = nPag - 1;
  pe.appendChild(L.h("span", { text: (est.porPag ? (off + 1) + "–" + Math.min(linhas.length, off + est.porPag) : "1–" + linhas.length) + " de " + L.fInt(linhas.length) + " produtos" }));
  var pg = L.h("div", { class: "pg" });
  if (nPag > 1) {
    pg.appendChild(L.h("button", { class: "mini-btn", text: "‹", disabled: est.pag === 0, onclick: function () { est.pag--; desenhar(corpo, sel, todas, modo); } }));
    pg.appendChild(L.h("span", { class: "mono", text: (est.pag + 1) + " / " + nPag }));
    pg.appendChild(L.h("button", { class: "mini-btn", text: "›", disabled: est.pag >= nPag - 1, onclick: function () { est.pag++; desenhar(corpo, sel, todas, modo); } }));
  }
  var s2 = L.h("select", { onchange: function () { est.porPag = +s2.value; est.pag = 0; desenhar(corpo, sel, todas, modo); } });
  [[50, "50 linhas"], [100, "100 linhas"], [250, "250 linhas"], [0, "Tudo"]].forEach(function (o) { var op = L.h("option", { value: o[0], text: o[1] }); if (o[0] === est.porPag) op.selected = true; s2.appendChild(op); });
  pg.appendChild(s2);
  pe.appendChild(pg);
  corpo.appendChild(pe);
}

function exportar(sel, linhas) {
  var P = L.P, R = L.R, C = L.C, nR = R.n, porReg = Array.prototype.slice.call(sel.regs);
  var colunas = [
    { titulo: "Código", tipo: "inteiro", somar: false, valor: function (x) { return P.cod[x.pi]; } },
    { titulo: "Descrição", tipo: "texto", valor: function (x) { return P.desc[x.pi]; } },
    { titulo: "Regiões com pendência", tipo: "inteiro", valor: function (x) { return x.pend; } },
  ].concat(porReg.map(function (ri) {
    return { titulo: R.num[ri] + " " + R.nome[ri], tipo: "texto", valor: function (x) { var c = x.pi * nR + ri; return sel.ok(c) ? L.SITUACOES[C.s[c]].curto : ""; } };
  })).concat([
    { titulo: "Fornecedor", tipo: "texto", valor: function (x) { return L.nomeDe("fornecedor", P.forn[x.pi]); } },
    { titulo: "Departamento", tipo: "texto", valor: function (x) { return L.nomeDe("depto", P.dep[x.pi]); } },
  ]);
  Planilha.baixar({ arquivo: "fiscal-mapa-produto-regiao-" + new Date().toISOString().slice(0, 10) + ".xlsx", titulo: "Mapa produto × região — tributação e preço", aba: "Mapa",
    filtros: L.descricaoFiltros([["Legenda", "Completo = tributação e preço · Sem trib. = tem preço, falta tributação · Sem preço = tem tributação, falta preço · Sem os dois · Fora da 201 = nunca precificado na região"]]),
    colunas: colunas, linhas: linhas });
  L.toast("Planilha gerada: " + L.fInt(linhas.length) + " produtos × " + porReg.length + " regiões", "ok");
}

})();
