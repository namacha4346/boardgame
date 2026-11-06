/* VS TEAMS 大会ビルダー
 * 設定（config）を作ると、その設定に合わせた進行・集計・発表画面が組み上がる。
 * 保存：この端末（localStorage）。共有：Google Apps Script のURLを入れると複数端末で同じ大会を見られる。
 */
(() => {
"use strict";

/* ---------- 基本 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => p + Math.random().toString(36).slice(2, 8);
const TEAMS = ["A", "B"];
const other = t => t === "A" ? "B" : "A";
const r1 = n => Math.round(n * 10) / 10;
const fmt = n => (Math.round(n * 10) / 10).toString();
const LS_DOC = "vsteams-builder-doc", LS_SYNC = "vsteams-builder-sync", LS_TAB = "vsteams-builder-tab";

/* 卓の人数ごとの標準配点（個人戦） */
const PRESET_POINTS = { 2: [5, 0], 3: [7, 4, 1], 4: [10, 7, 4, 1], 5: [8, 6, 4, 2, 1], 6: [7, 5, 4, 3, 2, 1], 8: [8, 7, 6, 5, 4, 3, 2, 1] };
const presetFor = total => (PRESET_POINTS[total] || Array.from({length: total}, (_, i) => total - i)).slice();

const KIND_LABEL = { indiv: "個人戦", team: "チーム戦", duel: "デュエル（アイテム）" };
const MODE_LABEL = { count: "人数×点", tier: "段階で点", manual: "点数を直接入力", first: "先着（どちらか一方だけ）" };

/* ---------- 見本の設定（2026年10月の八人の盤士杯） ---------- */
function sampleConfig() {
  const T = (game, kind, perTeam, extra = {}) => ({ id: uid("t"), game, kind, perTeam, points: kind === "indiv" ? presetFor(perTeam * 2) : [], win: 6, draw: 3, item: "", host: "", ...extra });
  const items = [
    { id: "i1", name: "位置ヒント", desc: "エイトパズルで1文字の正しい位置を教えてもらう" },
    { id: "i2", name: "ドボン公開", desc: "エイトテレパシーでドボンを教えてもらう" },
    { id: "i3", name: "70秒延長", desc: "エイトボンバーの制限時間を70秒にする" }
  ];
  return {
    name: "八人の盤士杯",
    teams: [{ name: "ボドゲdeナイトフィーバー", color: "#c0392b" }, { name: "Bodoge八犬伝", color: "#1f3a5f" }],
    teamSize: 8,
    roster: { A: [], B: [] },
    items,
    phases: [
      { id: uid("p"), type: "round", name: "ROUND 1", time: "11:20〜12:30", minutes: 70, tables: [T("コンプレット", "indiv", 3), T("キャメルアップ", "indiv", 3), T("エージェントアヴェニュー", "team", 2)] },
      { id: uid("p"), type: "round", name: "ROUND 2", time: "13:15〜14:25", minutes: 70, tables: [T("ファラウェイ", "indiv", 3), T("ハイソサエティ", "indiv", 2), T("タイガー＆ドラゴン", "team", 2), T("バトルライン", "duel", 1, { item: "i1" })] },
      { id: uid("p"), type: "event", name: "3秒トライ", time: "14:25〜14:40", minutes: 15, parts: [{ id: uid("e"), name: "抜けた人数", mode: "count", reps: 1, max: 8, per: 3, bonusAt: 0, bonus: 0 }] },
      { id: uid("p"), type: "round", name: "ROUND 3", time: "14:50〜16:05", minutes: 75, tables: [T("ハーモニーズ", "indiv", 2), T("リトルタウンビルダーズ", "indiv", 2), T("街コロ通", "indiv", 2), T("宝石の煌き：デュエル", "duel", 1, { item: "i3" }), T("ドラキュラ vs ヴァン・ヘルシング", "duel", 1, { item: "i2" })] },
      { id: uid("p"), type: "event", name: "チーム対抗クイズ", time: "17:20〜18:20", minutes: 60, parts: [
        { id: uid("e"), name: "エイトパズル（正しい位置の文字数）", mode: "tier", reps: 3, max: 8, tiers: [[8, 5], [6, 3], [4, 1]] },
        { id: uid("e"), name: "ミッション", mode: "first", reps: 1, options: [[10, "30秒以内"], [6, "1分以内"], [3, "2分以内"]] },
        { id: uid("e"), name: "エイトテレパシー（そろった人数）", mode: "count", reps: 3, max: 8, per: 1, bonusAt: 0, bonus: 0 },
        { id: uid("e"), name: "エイトボンバー（渡せた人数）", mode: "count", reps: 2, max: 8, per: 1, bonusAt: 8, bonus: 3 }
      ] }
    ]
  };
}
function blankConfig() {
  return { name: "新しい大会", teams: [{ name: "チームA", color: "#c0392b" }, { name: "チームB", color: "#1f3a5f" }], teamSize: 4, roster: { A: [], B: [] }, items: [], phases: [] };
}
const blankResults = () => ({ order: {}, team: {}, duel: {}, ev: {} });
const blankTimer = () => ({ total: 60 * 60000, end: null, paused: null, label: "" });

/* ---------- 状態 ---------- */
let doc = null;
try { doc = JSON.parse(localStorage.getItem(LS_DOC) || "null"); } catch (_) { doc = null; }
if (!doc || !doc.config) doc = { v: 1, config: sampleConfig(), results: blankResults(), timer: blankTimer(), savedAt: 0 };
normalize();
let tab = "play";
try { tab = localStorage.getItem(LS_TAB) || "play"; } catch (_) {}
if (!["play", "sum", "setup", "data"].includes(tab)) tab = "play";
let stageOn = false, stHidden = false, stTimer = true, maxSeen = doc.savedAt || 0;
/* 当日画面：表示中の種目、開いている卓、同着の入力待ち */
let cur = null, openT = {}, tieNext = {}, openP = {};
try { cur = localStorage.getItem("vsteams-builder-cur"); } catch (_) {}

function normalize() {
  const c = doc.config;
  c.teams = c.teams || blankConfig().teams;
  c.roster = c.roster || { A: [], B: [] };
  c.items = c.items || [];
  c.phases = c.phases || [];
  doc.results = Object.assign(blankResults(), doc.results || {});
  const R = doc.results;
  c.phases.forEach(ph => (ph.tables || []).forEach(tb => {
    tb.names = tb.names || { A: [], B: [] };
    /* 古い形式（名前を結果側に、順位を数字で持っていた）からの移しかえ */
    if (R.names && R.names[tb.id]) { tb.names = R.names[tb.id]; }
    if (R.seats && R.seats[tb.id] && !R.order[tb.id]) {
      const list = [];
      TEAMS.forEach(t => (R.seats[tb.id][t] || []).forEach((rk, i) => { if (rk != null) list.push({ t, i, rk }); }));
      list.sort((a, b) => a.rk - b.rk);
      R.order[tb.id] = list.map((x, k) => ({ t: x.t, i: x.i, tie: k > 0 && list[k - 1].rk === x.rk }));
    }
  }));
  delete R.names; delete R.seats;
  doc.timer = Object.assign(blankTimer(), doc.timer || {});
  document.documentElement.style.setProperty("--ta", c.teams[0].color || "#c0392b");
  document.documentElement.style.setProperty("--tb", c.teams[1].color || "#1f3a5f");
}
const tn = t => esc(doc.config.teams[t === "A" ? 0 : 1].name || ("チーム" + t));

/* ---------- 点数の計算 ---------- */
/* 着順に押した記録（order）から順位を出す。同着は前の人と同じ順位 */
function rankMap(tb) {
  const ord = doc.results.order[tb.id] || [], m = { A: [], B: [] };
  let rk = 0;
  ord.forEach((o, k) => { if (!(o.tie && k > 0)) rk = k + 1; if (m[o.t]) m[o.t][o.i] = rk; });
  return m;
}
function indivRes(tb) {
  const R = rankMap(tb), total = tb.perTeam * 2, pts = tb.points || [];
  const seats = [];
  TEAMS.forEach(t => { for (let i = 0; i < tb.perTeam; i++) seats.push({ t, i, r: (R[t] || [])[i] ?? null }); });
  const out = { pts: { A: 0, B: 0 }, seat: {}, filled: 0, need: total };
  const ranked = seats.filter(s => s.r != null);
  out.filled = ranked.length;
  ranked.forEach(s => {
    const same = ranked.filter(o => o.r === s.r).length;
    let sum = 0;
    for (let k = 0; k < same; k++) sum += pts[s.r - 1 + k] || 0;
    const p = r1(sum / same);
    out.seat[s.t + s.i] = p; out.pts[s.t] += p;
  });
  out.pts.A = r1(out.pts.A); out.pts.B = r1(out.pts.B);
  out.status = out.filled === 0 ? "empty" : out.filled < total ? "partial" : "done";
  return out;
}
function teamRes(tb) {
  const w = doc.results.team[tb.id];
  const pts = { A: 0, B: 0 };
  if (w === "draw") { pts.A = pts.B = tb.draw ?? 3; } else if (w === "A" || w === "B") pts[w] = tb.win ?? 6;
  return { pts, status: w ? "done" : "empty" };
}
function duelRes(tb) { const w = doc.results.duel[tb.id]; return { pts: { A: 0, B: 0 }, status: w ? "done" : "empty", win: w }; }
const tableRes = tb => tb.kind === "indiv" ? indivRes(tb) : tb.kind === "team" ? teamRes(tb) : duelRes(tb);

function partPts(pt, v) {
  if (v == null || v === "") return null;
  v = Number(v);
  if (pt.mode === "count") return v * (pt.per ?? 1) + (pt.bonusAt && v >= pt.bonusAt ? (pt.bonus || 0) : 0);
  if (pt.mode === "tier") { const t = (pt.tiers || []).slice().sort((a, b) => b[0] - a[0]).find(x => v >= x[0]); return t ? t[1] : 0; }
  return v; /* manual・first はそのまま点数 */
}
function eventRes(ph) {
  const out = { pts: { A: 0, B: 0 }, part: {}, filled: 0, need: 0 };
  (ph.parts || []).forEach(pt => {
    const reps = Math.max(1, pt.reps || 1);
    out.part[pt.id] = { A: 0, B: 0 };
    TEAMS.forEach(t => {
      const vals = ((doc.results.ev[pt.id] || {})[t]) || [];
      for (let k = 0; k < reps; k++) { out.need++; const p = partPts(pt, vals[k]); if (p != null) { out.filled++; out.part[pt.id][t] += p; out.pts[t] += p; } }
    });
  });
  out.pts.A = r1(out.pts.A); out.pts.B = r1(out.pts.B);
  out.status = out.filled === 0 ? "empty" : out.filled < out.need ? "partial" : "done";
  return out;
}
function phaseRes(ph) {
  if (ph.type === "event") return eventRes(ph);
  const out = { pts: { A: 0, B: 0 }, done: 0, n: 0, any: false };
  (ph.tables || []).forEach(tb => { const r = tableRes(tb); out.pts.A += r.pts.A; out.pts.B += r.pts.B; out.n++; if (r.status === "done") out.done++; if (r.status !== "empty") out.any = true; });
  out.pts.A = r1(out.pts.A); out.pts.B = r1(out.pts.B);
  out.status = out.done === out.n && out.n ? "done" : out.any ? "partial" : "empty";
  return out;
}
function totals() {
  const t = { A: 0, B: 0 };
  doc.config.phases.forEach(ph => { const r = phaseRes(ph); t.A += r.pts.A; t.B += r.pts.B; });
  return { A: r1(t.A), B: r1(t.B) };
}
function itemsOf(team) {
  const list = [];
  doc.config.phases.forEach(ph => (ph.tables || []).forEach(tb => {
    if (tb.kind === "duel" && doc.results.duel[tb.id] === team) {
      const idx = doc.config.items.findIndex(i => i.id === tb.item);
      list.push({ no: idx >= 0 ? idx + 1 : "？", name: idx >= 0 ? doc.config.items[idx].name : "（アイテム未設定）", from: tb.game || "デュエル卓" });
    }
  }));
  return list.sort((a, b) => String(a.no).localeCompare(String(b.no)));
}

/* ---------- 設定のチェック ---------- */
function problems() {
  const c = doc.config, out = [];
  if (!(c.teamSize > 0)) out.push("1チームの人数を入れてください。");
  c.phases.forEach(ph => {
    if (ph.type !== "round") return;
    const sum = (ph.tables || []).reduce((a, tb) => a + (Number(tb.perTeam) || 0), 0);
    if (sum !== c.teamSize) out.push(`${ph.name}：卓に入る人数の合計が1チーム${sum}人です（1チーム${c.teamSize}人にそろえてください）。`);
    (ph.tables || []).forEach(tb => {
      if (tb.kind === "indiv" && (tb.points || []).length !== tb.perTeam * 2) out.push(`${ph.name}「${tb.game || "卓"}」：配点が${(tb.points || []).length}人分です（${tb.perTeam * 2}人分にしてください）。`);
      if (tb.kind === "duel" && tb.perTeam !== 1) out.push(`${ph.name}「${tb.game || "卓"}」：デュエル卓は各チーム1人です。`);
      if (tb.kind === "duel" && !tb.item && c.items.length) out.push(`${ph.name}「${tb.game || "卓"}」：勝ったチームがもらうアイテムを選んでください。`);
    });
  });
  return out;
}

/* ---------- 画面の部品 ---------- */
const chip = s => s === "done" ? '<span class="chip ok">確定</span>' : s === "partial" ? '<span class="chip">入力中</span>' : '<span class="chip">未入力</span>';
const inp = (path, val, type = "str", attrs = "") => `<input data-bind="${path}" data-type="${type}" value="${esc(val ?? "")}" ${type === "num" ? 'type="number" inputmode="numeric"' : ""} ${attrs}>`;
function sel(path, val, opts, type = "str", attrs = "") {
  return `<select data-bind="${path}" data-type="${type}" ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
const rankOpts = n => [["", "–"], ...Array.from({ length: n }, (_, i) => [i + 1, (i + 1) + "位"])];
const numOpts = (max, min = 0) => [["", "–"], ...Array.from({ length: max - min + 1 }, (_, i) => [min + i, String(min + i)])];

/* ---------- 画面：設定 ---------- */
function renderSetup() {
  const c = doc.config, pr = problems();
  let h = `<div class="row between"><h2>準備</h2><div class="row"><button type="button" data-act="load-sample">見本（八人の盤士杯）を読み込む</button><button type="button" data-act="new-blank">白紙から作る</button></div></div>
  <p class="hint" style="margin:0">ここで決めた内容に合わせて「当日」「集計」「発表画面」ができあがります。結果を入れたあとに卓や種目を消すと、その結果も消えます。</p>
  ${pr.length ? `<div class="warn"><b>確認してください</b><ul style="margin:4px 0 0;padding-left:18px">${pr.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : '<div class="chip ok" style="align-self:flex-start">設定に問題はありません</div>'}
  <div class="grid">
    <article class="card"><h3>大会</h3>
      <label class="field"><span class="lbl">大会名</span>${inp("config.name", c.name)}</label>
      <label class="field"><span class="lbl">1チームの人数</span>${inp("config.teamSize", c.teamSize, "num", 'min="1" max="30"')}</label>
    </article>
    ${TEAMS.map((t, i) => `<article class="card"><h3>チーム${t}</h3>
      <div class="row"><label class="field" style="flex:1"><span class="lbl">チーム名</span>${inp(`config.teams.${i}.name`, c.teams[i].name)}</label>
      <label class="field"><span class="lbl">色</span><input type="color" data-bind="config.teams.${i}.color" data-type="str" value="${esc(c.teams[i].color)}"></label></div>
      <label class="field"><span class="lbl">メンバー（1行に1人。卓割りの名前で選べます）</span><textarea data-bind="config.roster.${t}" data-type="lines" style="min-height:6em;font-family:var(--body);font-size:14px">${esc((c.roster[t] || []).join("\n"))}</textarea></label>
    </article>`).join("")}
  </div>
  <article class="card"><div class="row between"><h3>アイテム（デュエル卓の勝者がもらう特典）</h3><button type="button" class="small" data-act="add-item">＋ アイテムを追加</button></div>
    <p class="hint" style="margin:0">発表画面には中身を出さず、番号だけを出します（番号の意味は主催だけが知っている）。</p>
    ${c.items.length ? `<div class="scroll"><table class="seats"><tr><th>番号</th><th>名前</th><th>効果</th><th></th></tr>${c.items.map((it, i) => `<tr><td>${i + 1}</td><td>${inp(`config.items.${i}.name`, it.name)}</td><td>${inp(`config.items.${i}.desc`, it.desc, "str", 'style="width:100%"')}</td><td><button type="button" class="small danger" data-act="del-item" data-i="${i}">消す</button></td></tr>`).join("")}</table></div>` : '<p class="hint" style="margin:0">まだありません。</p>'}
  </article>
  <div class="row between"><h2>進行（上から順番）</h2><div class="row"><button type="button" data-act="add-round">＋ ボードゲームROUND</button><button type="button" data-act="add-event">＋ 全員参加の種目</button></div></div>`;
  c.phases.forEach((ph, pi) => {
    const P = `config.phases.${pi}`;
    const head = `<div class="row between"><div class="row"><span class="chip">${ph.type === "round" ? "ボードゲームROUND" : "全員参加の種目"}</span>${inp(P + ".name", ph.name, "str", 'style="font-weight:700"')}</div>
      <div class="row"><button type="button" class="small" data-act="move" data-i="${pi}" data-d="-1" ${pi === 0 ? "disabled" : ""}>↑</button><button type="button" class="small" data-act="move" data-i="${pi}" data-d="1" ${pi === c.phases.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="small danger" data-act="del-phase" data-i="${pi}">消す</button></div></div>
      <div class="row"><label class="field"><span class="lbl">時間帯（表示用）</span>${inp(P + ".time", ph.time, "str", 'placeholder="11:20〜12:30" style="width:9em"')}</label><label class="field"><span class="lbl">タイマーの分数</span>${inp(P + ".minutes", ph.minutes, "num", 'min="1" max="600"')}</label></div>`;
    const nT = (ph.tables || []).length, nP = (ph.parts || []).length;
    const sumLine = ph.type === "round" ? `${nT}卓・1チーム${(ph.tables || []).reduce((a, tb) => a + (Number(tb.perTeam) || 0), 0)}/${c.teamSize}人` : `${nP}項目`;
    h += `<details class="pd" ${openP[ph.id] ? "open" : ""} data-pid="${ph.id}"><summary><span class="chip">${ph.type === "round" ? "ROUND" : "種目"}</span><b>${esc(ph.name)}</b><span class="hint">${esc(ph.time || "")}　${sumLine}</span></summary>`;
    if (ph.type === "round") {
      const sum = (ph.tables || []).reduce((a, tb) => a + (Number(tb.perTeam) || 0), 0);
      h += `<article class="card phase">${head}
        <p class="hint" style="margin:0">卓に入る人数の合計：1チーム <b>${sum}</b> / ${c.teamSize} 人</p>
        ${(ph.tables || []).map((tb, ti) => {
          const T = `${P}.tables.${ti}`;
          return `<div class="tbl"><div class="row between"><div class="row">
              <label class="field"><span class="lbl">ゲーム名</span>${inp(T + ".game", tb.game, "str", 'style="width:13em"')}</label>
              <label class="field"><span class="lbl">種類</span>${sel(T + ".kind", tb.kind, Object.entries(KIND_LABEL), "str", 'data-re="kind"')}</label>
              <label class="field"><span class="lbl">各チーム何人</span>${inp(T + ".perTeam", tb.perTeam, "num", 'min="1" max="10" data-re="per"')}</label>
            </div><button type="button" class="small danger" data-act="del-table" data-i="${pi}" data-j="${ti}">卓を消す</button></div>
            ${tb.kind === "indiv" ? `<label class="field"><span class="lbl">配点（1位から順に、カンマ区切り・${tb.perTeam * 2}人分）</span>${inp(T + ".points", (tb.points || []).join(","), "list")}</label>` : ""}
            ${tb.kind === "team" ? `<div class="row"><label class="field"><span class="lbl">勝ちチームの点</span>${inp(T + ".win", tb.win, "num")}</label><label class="field"><span class="lbl">引き分けの点（各チーム）</span>${inp(T + ".draw", tb.draw, "num")}</label></div>` : ""}
            ${tb.kind === "duel" ? `<label class="field"><span class="lbl">勝ったチームがもらうアイテム</span>${sel(T + ".item", tb.item, [["", "（選ぶ）"], ...c.items.map((it, i) => [it.id, (i + 1) + "　" + it.name])])}</label>` : ""}
            <div class="row" style="align-items:flex-start">${TEAMS.map(t => `<div class="field"><span class="lbl ${t === "A" ? "ta" : "tb"}">${tn(t)} の席（名前・任意）</span>${Array.from({ length: tb.perTeam }, (_, i) => `<input list="ros${t}" data-bind="${T}.names.${t}.${i}" data-type="str" value="${esc(((tb.names || {})[t] || [])[i] || "")}" placeholder="${t}${i + 1}" style="width:9em;margin-top:3px">`).join("")}</div>`).join("")}
            <label class="field"><span class="lbl">進行役（任意）</span>${inp(T + ".host", tb.host, "str", 'style="width:9em"')}</label></div>
          </div>`;
        }).join("")}
        <div class="row"><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="indiv">＋ 個人戦の卓</button><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="team">＋ チーム戦の卓</button><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="duel">＋ デュエル卓</button></div>
      </article></details>`;
    } else {
      h += `<article class="card phase event">${head}
        ${(ph.parts || []).map((pt, ki) => {
          const K = `${P}.parts.${ki}`;
          let detail = "";
          if (pt.mode === "count") detail = `<label class="field"><span class="lbl">最大の人数</span>${inp(K + ".max", pt.max, "num")}</label><label class="field"><span class="lbl">1人あたりの点</span>${inp(K + ".per", pt.per, "num", 'step="0.5"')}</label><label class="field"><span class="lbl">ボーナスの条件（○人以上）</span>${inp(K + ".bonusAt", pt.bonusAt, "num")}</label><label class="field"><span class="lbl">ボーナスの点</span>${inp(K + ".bonus", pt.bonus, "num")}</label>`;
          if (pt.mode === "tier") detail = `<label class="field"><span class="lbl">最大の値</span>${inp(K + ".max", pt.max, "num")}</label><label class="field" style="flex:1"><span class="lbl">段階（「以上:点」をカンマ区切り。例 8:5,6:3,4:1）</span>${inp(K + ".tiers", (pt.tiers || []).map(x => x.join(":")).join(","), "pairs")}</label>`;
          if (pt.mode === "first") detail = `<label class="field" style="flex:1"><span class="lbl">選択肢（「点:説明」をカンマ区切り。例 10:30秒以内,6:1分以内）</span>${inp(K + ".options", (pt.options || []).map(x => x.join(":")).join(","), "pairs")}</label>`;
          return `<div class="tbl"><div class="row between"><div class="row">
              <label class="field"><span class="lbl">名前</span>${inp(K + ".name", pt.name, "str", 'style="width:16em"')}</label>
              <label class="field"><span class="lbl">点数の付け方</span>${sel(K + ".mode", pt.mode, Object.entries(MODE_LABEL), "str", 'data-re="mode"')}</label>
              <label class="field"><span class="lbl">回数（問題数）</span>${inp(K + ".reps", pt.reps, "num", 'min="1" max="20"')}</label>
            </div><button type="button" class="small danger" data-act="del-part" data-i="${pi}" data-j="${ki}">消す</button></div>
            <div class="row">${detail}</div></div>`;
        }).join("")}
        <div><button type="button" class="small" data-act="add-part" data-i="${pi}">＋ 項目を追加</button></div>
        <p class="hint" style="margin:0">人数×点：渡せた人数・抜けた人数など。段階で点：正しい文字数などで点が変わる。先着：先にクリアしたチームだけ点が入る。</p>
      </article></details>`;
    }
  });
  if (!c.phases.length) h += '<p class="hint">まだ何もありません。上のボタンでROUNDや種目を追加してください。</p>';
  return h + `<datalist id="rosA">${(c.roster.A || []).map(n => `<option value="${esc(n)}">`).join("")}</datalist><datalist id="rosB">${(c.roster.B || []).map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
}

/* ---------- 画面：当日（結果の入力） ---------- */
/* 名前が未入力の席は「A1」「B2」のように出す（色でチームがわかる） */
const nameOf = (tb, t, i) => ((tb.names || {})[t] || [])[i] || `${t}${i + 1}`;
function curPhase() {
  const ps = doc.config.phases;
  let i = ps.findIndex(p => p.id === cur);
  if (i < 0) { i = ps.findIndex(p => phaseRes(p).status !== "done"); if (i < 0) i = ps.length - 1; }
  return i;
}
function timerBar(ph) {
  const set = doc.timer.label === ph.name;
  return `<article class="card tbar"><div class="row between">
      <div class="row"><span class="hint">タイマー${doc.timer.label ? "（" + esc(doc.timer.label) + "）" : ""}</span><span class="tbig" id="tmBig">--:--</span><span class="hint" id="tmEnd"></span></div>
      <div class="row">${set ? "" : `<button type="button" data-act="timer-set" data-label="${esc(ph.name)}" data-min="${ph.minutes || 60}">${esc(ph.name)}の${ph.minutes || 60}分にする</button>`}
        <button type="button" class="primary tgo" data-act="timer-go">スタート</button><button type="button" data-act="timer-reset">リセット</button><button type="button" data-act="timer-sound" id="tmSound">音：オフ</button></div>
    </div></article>`;
}
function tableCard(tb) {
  const r = tableRes(tb), done = r.status === "done", open = openT[tb.id] || !done;
  const sumTxt = tb.kind === "duel" ? (r.win ? `${tn(r.win)} の勝ち（アイテム獲得）` : "") : `<span class="ta">${fmt(r.pts.A)}</span> − <span class="tb">${fmt(r.pts.B)}</span>`;
  let h = `<article class="card tcard${done ? " done" : ""}"><button type="button" class="thead" data-act="toggle-table" data-tb="${tb.id}" aria-expanded="${open}">
      <span class="tname">${done ? "✓ " : ""}${esc(tb.game || "（ゲーム名なし）")}</span><span class="tsum">${sumTxt}</span><span class="hint">${KIND_LABEL[tb.kind]}・${tb.perTeam}対${tb.perTeam}</span></button>`;
  if (!open) return h + `</article>`;
  if (tb.kind === "indiv") {
    const rm = rankMap(tb), ord = doc.results.order[tb.id] || [], total = tb.perTeam * 2, n = ord.length;
    const next = n >= total ? null : (tieNext[tb.id] && n > 0 ? rm[ord[n - 1].t][ord[n - 1].i] : n + 1);
    h += `<p class="guide">${n >= total ? "全員の順位が入りました。" : `<b>${next}位</b>の人を押してください${tieNext[tb.id] ? "（前の人と同着）" : ""}`}</p><div class="seatgrid">`;
    TEAMS.forEach(t => { for (let i = 0; i < tb.perTeam; i++) {
      const rk = rm[t][i];
      h += `<button type="button" class="seat ${t === "A" ? "sa" : "sb"}${rk ? " ranked" : ""}" data-act="pick" data-tb="${tb.id}" data-t="${t}" data-i="${i}"><span class="rk">${rk ? rk + "位" : ""}</span><span class="nm">${esc(nameOf(tb, t, i))}</span><span class="pt">${rk ? fmt(r.seat[t + i]) + "点" : ""}</span></button>`;
    } });
    h += `</div><div class="row"><button type="button" data-act="tie" data-tb="${tb.id}" aria-pressed="${!!tieNext[tb.id]}" ${n === 0 || n >= total ? "disabled" : ""}>次の人を前と同着にする</button><button type="button" data-act="undo-rank" data-tb="${tb.id}" ${n ? "" : "disabled"}>1つ戻す</button><button type="button" class="danger" data-act="clear-rank" data-tb="${tb.id}" ${n ? "" : "disabled"}>やり直す</button></div>
      <p class="hint" style="margin:0">順位の付いた人をもう一度押すと、その人の順位を消せます。</p>`;
  } else {
    const cur2 = tb.kind === "team" ? doc.results.team[tb.id] : doc.results.duel[tb.id];
    const opts = [["A", tn("A") + " の勝ち", "sa"], ["B", tn("B") + " の勝ち", "sb"]];
    if (tb.kind === "team") opts.push(["draw", "引き分け", ""]);
    h += `<div class="winrow">${opts.map(([v, l, cl]) => `<button type="button" class="win ${cl}" data-act="win" data-tb="${tb.id}" data-k="${tb.kind}" data-v="${v}" aria-pressed="${cur2 === v}">${l}</button>`).join("")}</div>`;
    if (tb.kind === "duel") { const it = doc.config.items.find(i => i.id === tb.item); h += `<p class="hint" style="margin:0">点数なし。勝ったチームが「${esc(it ? it.name : "アイテム")}」をもらう。</p>`; }
  }
  return h + `</article>`;
}
function partCard(pt, er) {
  const reps = Math.max(1, pt.reps || 1);
  let h = `<article class="card"><div class="row between"><h3>${esc(pt.name)}</h3><span class="tsum"><span class="ta">${fmt(er.part[pt.id].A)}</span> − <span class="tb">${fmt(er.part[pt.id].B)}</span></span></div>`;
  for (let k = 0; k < reps; k++) {
    if (reps > 1) h += `<div class="qlabel">第${k + 1}問</div>`;
    TEAMS.forEach(t => {
      const v = (((doc.results.ev[pt.id] || {})[t]) || [])[k], p = partPts(pt, v);
      let ctl;
      if (pt.mode === "count" || pt.mode === "tier") ctl = Array.from({ length: (pt.max || 8) + 1 }, (_, n) => `<button type="button" class="num" data-act="num" data-pt="${pt.id}" data-t="${t}" data-k="${k}" data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join("");
      else if (pt.mode === "first") ctl = [...(pt.options || []), [0, "なし"]].map(([pv, l]) => `<button type="button" class="num wide" data-act="num" data-pt="${pt.id}" data-t="${t}" data-k="${k}" data-v="${pv}" data-first="1" aria-pressed="${v === pv}">${esc(l)}${pv ? `（${pv}）` : ""}</button>`).join("");
      else ctl = inp(`results.ev.${pt.id}.${t}.${k}`, v, "num", 'step="0.5" style="width:6em"');
      h += `<div class="numrow"><span class="nteam ${t === "A" ? "ta" : "tb"}">${tn(t)}</span><div class="nums">${ctl}</div><span class="npt">${p != null ? fmt(p) + "点" : "–"}</span></div>`;
    });
  }
  return h + `</article>`;
}
function renderPlay() {
  const c = doc.config;
  if (!c.phases.length) return '<p class="hint">まだ大会の中身がありません。「準備」でROUNDや種目を作ってください。</p>';
  const pi = curPhase(), ph = c.phases[pi], pr = phaseRes(ph);
  let h = `<nav class="pills" aria-label="種目">${c.phases.map((p, i) => { const s = phaseRes(p).status; return `<button type="button" data-act="phase" data-i="${i}" aria-pressed="${i === pi}"><span class="dot ${s}"></span>${esc(p.name)}</button>`; }).join("")}</nav>
    <div class="row between"><h2>${esc(ph.name)} <span class="hint">${esc(ph.time || "")}</span></h2><div class="row">${chip(pr.status)}<b class="ta">${fmt(pr.pts.A)}</b> − <b class="tb">${fmt(pr.pts.B)}</b><button type="button" data-act="st-open">発表画面</button></div></div>
    ${timerBar(ph)}`;
  if (ph.type === "round") {
    const tbs = ph.tables || [], left = tbs.filter(tb => tableRes(tb).status !== "done");
    h += `<div class="grid">${[...left, ...tbs.filter(tb => !left.includes(tb))].map(tableCard).join("")}</div>`;
  } else {
    const er = eventRes(ph);
    h += `<div class="grid one">${(ph.parts || []).map(pt => partCard(pt, er)).join("")}</div>`;
  }
  h += `<div class="row between">${pi > 0 ? `<button type="button" data-act="phase" data-i="${pi - 1}">← ${esc(c.phases[pi - 1].name)}</button>` : "<span></span>"}${pi < c.phases.length - 1 ? `<button type="button" class="primary" data-act="phase" data-i="${pi + 1}">${esc(c.phases[pi + 1].name)} →</button>` : ""}</div>`;
  return h;
}

/* ---------- 画面：集計 ---------- */
function renderSum() {
  const t = totals();
  const rows = doc.config.phases.map(ph => { const r = phaseRes(ph); return `<tr><td>${esc(ph.name)}</td><td>${chip(r.status)}</td><td class="pt ta">${fmt(r.pts.A)}</td><td class="pt tb">${fmt(r.pts.B)}</td></tr>`; }).join("");
  const items = team => { const l = itemsOf(team); return `<article class="card"><h3><span class="${team === "A" ? "ta" : "tb"}">${tn(team)}</span> のアイテム（${l.length}個）</h3>${l.length ? `<ul style="margin:0;padding-left:18px">${l.map(x => `<li>${x.no}　${esc(x.name)} <span class="hint">（${esc(x.from)}）</span></li>`).join("")}</ul>` : '<p class="hint" style="margin:0">まだありません。</p>'}</article>`; };
  return `<h2>集計</h2><article class="card"><div class="scroll"><table class="seats"><tr><th>種目</th><th></th><th class="ta">${tn("A")}</th><th class="tb">${tn("B")}</th></tr>${rows}<tr><th>合計</th><th></th><th class="pt ta">${fmt(t.A)}</th><th class="pt tb">${fmt(t.B)}</th></tr></table></div>
  <div class="row"><button type="button" class="primary" data-act="st-open">発表画面を開く</button><button type="button" data-act="copy">結果を文字でコピー</button><span class="hint" id="copymsg"></span></div></article>
  <div class="grid">${items("A")}${items("B")}</div>`;
}

/* ---------- 画面：データ・共有 ---------- */
function renderData() {
  const s = syncConf();
  const share = s.url && s.id ? `${location.origin}${location.pathname}?e=${encodeURIComponent(s.id)}&s=${encodeURIComponent(s.url)}` : "";
  return `<h2>データ・共有</h2>
  <article class="card"><h3>複数の端末で共有する</h3>
    <p class="hint" style="margin:0">Googleスプレッドシートに置いた共有用の仕組み（Apps Script）のURLを入れると、スマホで入れた結果がパソコンの発表画面にも出ます。作り方は README を見てください。</p>
    <label class="field"><span class="lbl">Apps Script のURL（…/exec）</span><input id="syncUrl" value="${esc(s.url || "")}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%"></label>
    <label class="field"><span class="lbl">大会ID（同じIDの端末同士で共有。英数字）</span><input id="syncId" value="${esc(s.id || "")}" placeholder="例：bansishi-2026"></label>
    <div class="row"><button type="button" class="primary" data-act="sync-save">共有を始める</button><button type="button" data-act="sync-off">共有をやめる</button></div>
    ${share ? `<label class="field"><span class="lbl">ほかの端末で開くリンク</span><input readonly value="${esc(share)}" style="width:100%" id="shareLink"></label><div><button type="button" class="small" data-act="copy-share">リンクをコピー</button></div>` : ""}
  </article>
  <article class="card"><h3>結果だけを消す</h3><p class="hint" style="margin:0">設定（チーム・卓・種目）は残して、順位や点数の入力だけを消します。元に戻せません。</p><div><button type="button" class="danger" data-act="reset-results">結果を消す</button></div></article>
  <article class="card"><h3>書き出し・読み込み</h3><p class="hint" style="margin:0">設定と結果をまとめた文字です。コピーして保存しておけば、同じ大会の設定を次回も使えます。</p>
    <textarea id="dataBox">${esc(JSON.stringify({ config: doc.config, results: doc.results }, null, 1))}</textarea>
    <div class="row"><button type="button" data-act="copy-data">コピー</button><button type="button" data-act="import">上の内容を読み込む</button><button type="button" data-act="import-config">設定だけ読み込む（結果は空）</button></div></article>`;
}

/* ---------- 描画 ---------- */
const TABS = [["play", "当日"], ["sum", "集計"], ["setup", "準備"], ["data", "データ・共有"]];
function renderBoard() {
  const t = totals();
  $("evName").textContent = doc.config.name || "大会ビルダー";
  document.title = (doc.config.name || "大会") + "｜VS TEAMS 大会ビルダー";
  $("nA").innerHTML = tn("A"); $("nB").innerHTML = tn("B");
  $("sA").textContent = fmt(t.A); $("sB").textContent = fmt(t.B);
  $("lead").textContent = t.A === t.B ? "同点" : `${t.A > t.B ? doc.config.teams[0].name : doc.config.teams[1].name}が${fmt(Math.abs(t.A - t.B))}点リード`;
}
function renderTabs() { $("tabs").innerHTML = TABS.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join(""); }
function renderPanel() {
  const a = document.activeElement, keep = a && a.dataset && a.dataset.bind;
  $("panel").innerHTML = tab === "setup" ? renderSetup() : tab === "play" ? renderPlay() : tab === "sum" ? renderSum() : renderData();
  if (keep) { const el = document.querySelector(`[data-bind="${CSS.escape(keep)}"]`); if (el && el.tagName === "INPUT") { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
  tick(true);
}
/* 発表画面は暗い背景なので、チームの色を明るくして使う */
const light = c => `color-mix(in srgb, ${c} 55%, #ffffff)`;
function renderStage() {
  const st = $("stage"); st.hidden = !stageOn; document.body.style.overflow = stageOn ? "hidden" : "";
  if (!stageOn) return;
  const t = totals(), phases = doc.config.phases, res = phases.map(phaseRes), all = res.length && res.every(r => r.status === "done");
  $("stTitle").textContent = doc.config.name || "VS TEAMS";
  $("stPhase").textContent = all ? "最終結果" : "途中経過";
  $("stNA").innerHTML = tn("A"); $("stNB").innerHTML = tn("B");
  $("stNA").style.color = light(doc.config.teams[0].color); $("stNB").style.color = light(doc.config.teams[1].color);
  $("stSA").textContent = stHidden ? "?" : fmt(t.A); $("stSB").textContent = stHidden ? "?" : fmt(t.B);
  $("stLead").textContent = stHidden ? "" : t.A === t.B ? "同点" : `${fmt(Math.abs(t.A - t.B))}点差`;
  ["A", "B"].forEach(tm => { const l = itemsOf(tm); $("stI" + tm).innerHTML = l.length ? l.map(x => `<span class="ib">${x.no}</span>`).join("") + `<span>アイテム ${l.length}個</span>` : ""; });
  $("stBreak").innerHTML = phases.map((ph, i) => { const r = res[i], m = Math.max(r.pts.A, r.pts.B, 1), h = stHidden;
    return `<div class="st-row"><span class="v va" style="color:${light(doc.config.teams[0].color)}">${h ? "–" : fmt(r.pts.A)}</span><span class="sbar a"><i style="width:${h ? 0 : r.pts.A / m * 100}%;background:${doc.config.teams[0].color}"></i></span><span class="lab">${esc(ph.name)}</span><span class="sbar"><i style="width:${h ? 0 : r.pts.B / m * 100}%;background:${light(doc.config.teams[1].color)}"></i></span><span class="v" style="color:${light(doc.config.teams[1].color)}">${h ? "–" : fmt(r.pts.B)}</span></div>`; }).join("");
  st.classList.toggle("no-timer", !stTimer);
  st.querySelector('[data-act="st-timer"]').textContent = stTimer ? "タイマーを隠す" : "タイマーを出す";
  st.querySelector('[data-act="st-hide"]').textContent = stHidden ? "点数を出す" : "点数を伏せる";
}
function renderAll() { normalize(); renderBoard(); renderTabs(); renderPanel(); renderStage(); }

/* ---------- 値の書き込み ---------- */
function setPath(path, val) {
  const ks = path.split("."); let o = doc;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i], nk = ks[i + 1];
    if (o[k] == null || typeof o[k] !== "object") o[k] = /^\d+$/.test(nk) ? [] : {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = val;
}
function getPath(path) { return path.split(".").reduce((o, k) => o == null ? undefined : o[k], doc); }
function parseVal(el) {
  const v = el.value, t = el.dataset.type;
  if (t === "num") return v === "" ? null : Number(v);
  if (t === "list") return v.split(/[,\s、]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  if (t === "pairs") return v.split(/[,、]+/).map(s => s.split(/[:：]/)).filter(p => p[0] !== undefined && p[0].trim() !== "").map(([a, b]) => { const n = Number(a); return [isNaN(n) ? 0 : n, el.dataset.bind.endsWith("options") ? (b || "").trim() : Number(b) || 0]; });
  if (t === "lines") return v.split(/\n/).map(s => s.trim()).filter(Boolean);
  return v;
}
function onBind(el, final) {
  const path = el.dataset.bind, val = parseVal(el);
  if (JSON.stringify(getPath(path)) === JSON.stringify(val)) return;
  setPath(path, val);
  /* 先着：一方に点が入ったら、もう一方は0点 */
  if (el.dataset.first && val > 0) { const [pid, k] = el.dataset.first.split("."); const t = path.split(".")[3]; setPath(`results.ev.${pid}.${other(t)}.${k}`, 0); }
  /* 種類・人数が変わったら配点を作り直す */
  if (el.dataset.re === "kind" || el.dataset.re === "per") {
    const tb = getPath(path.split(".").slice(0, -1).join("."));
    if (tb.kind === "duel") tb.perTeam = 1;
    if (tb.kind === "team" && el.dataset.re === "kind") tb.perTeam = 2;
    if (tb.kind === "indiv") tb.points = presetFor(tb.perTeam * 2);
  }
  if (el.dataset.re === "mode") {
    const pt = getPath(path.split(".").slice(0, -1).join("."));
    Object.assign(pt, { max: pt.max || doc.config.teamSize, per: pt.per ?? 1, tiers: pt.tiers || [[8, 5], [6, 3], [4, 1]], options: pt.options || [[10, "1位"]] });
  }
  changed(final || el.tagName === "SELECT" || !!el.dataset.re);
}
function changed(rerender) {
  doc.savedAt = stamp();
  try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (_) {}
  normalize(); renderBoard(); renderStage();
  if (rerender) renderPanel();
  pushSoon();
}
function stamp() { const v = Math.max(Date.now(), maxSeen + 1, (doc.savedAt || 0) + 1); maxSeen = v; return v; }

document.addEventListener("change", e => { const el = e.target; if (el.dataset && el.dataset.bind) onBind(el, true); });
document.addEventListener("input", e => { const el = e.target; if (el.dataset && el.dataset.bind && el.tagName !== "SELECT" && el.dataset.type !== "list" && el.dataset.type !== "pairs") onBind(el, false); });

/* ---------- 操作 ---------- */
function newPid() { const id = uid("p"); openP[id] = true; return id; }
function findTable(id) { for (const ph of doc.config.phases) for (const tb of (ph.tables || [])) if (tb.id === id) return tb; return null; }
document.addEventListener("toggle", e => { const d = e.target; if (d.dataset && d.dataset.pid) openP[d.dataset.pid] = d.open; }, true);
function newTable(kind, ph) {
  const left = Math.max(1, doc.config.teamSize - (ph.tables || []).reduce((a, tb) => a + (Number(tb.perTeam) || 0), 0));
  const per = kind === "duel" ? 1 : kind === "team" ? 2 : Math.min(left, 3);
  return { id: uid("t"), game: "", kind, perTeam: per, points: kind === "indiv" ? presetFor(per * 2) : [], win: 6, draw: 3, item: "", host: "" };
}
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; try { localStorage.setItem(LS_TAB, tab); } catch (_) {} renderTabs(); renderPanel(); window.scrollTo({ top: 0 }); return; }
  const a = b.dataset.act; if (!a) return;
  const c = doc.config, i = Number(b.dataset.i), j = Number(b.dataset.j);
  switch (a) {
    case "load-sample": doc.config = sampleConfig(); doc.results = blankResults(); changed(true); break;
    case "new-blank": doc.config = blankConfig(); doc.results = blankResults(); changed(true); break;
    case "add-item": c.items.push({ id: uid("i"), name: "アイテム" + (c.items.length + 1), desc: "" }); changed(true); break;
    case "del-item": { const id = c.items[i].id; c.items.splice(i, 1); c.phases.forEach(ph => (ph.tables || []).forEach(tb => { if (tb.item === id) tb.item = ""; })); changed(true); break; }
    case "add-round": c.phases.push({ id: newPid(), type: "round", name: "ROUND " + (c.phases.filter(p => p.type === "round").length + 1), time: "", minutes: 60, tables: [] }); changed(true); break;
    case "add-event": c.phases.push({ id: newPid(), type: "event", name: "全員参加の種目", time: "", minutes: 30, parts: [{ id: uid("e"), name: "項目", mode: "count", reps: 1, max: c.teamSize, per: 1, bonusAt: 0, bonus: 0 }] }); changed(true); break;
    case "move": { const d = Number(b.dataset.d), k = i + d; if (k < 0 || k >= c.phases.length) break; [c.phases[i], c.phases[k]] = [c.phases[k], c.phases[i]]; changed(true); break; }
    case "del-phase": c.phases.splice(i, 1); changed(true); break;
    case "add-table": c.phases[i].tables.push(newTable(b.dataset.k, c.phases[i])); changed(true); break;
    case "del-table": c.phases[i].tables.splice(j, 1); changed(true); break;
    case "add-part": c.phases[i].parts.push({ id: uid("e"), name: "項目", mode: "count", reps: 1, max: c.teamSize, per: 1, bonusAt: 0, bonus: 0 }); changed(true); break;
    case "del-part": c.phases[i].parts.splice(j, 1); changed(true); break;
    case "phase": cur = c.phases[i].id; try { localStorage.setItem("vsteams-builder-cur", cur); } catch (_) {} renderPanel(); window.scrollTo({ top: 0 }); break;
    case "toggle-table": { const id = b.dataset.tb, tb = findTable(id); openT[id] = !(openT[id] || tableRes(tb).status !== "done"); renderPanel(); break; }
    case "pick": {
      const id = b.dataset.tb, t = b.dataset.t, k = Number(b.dataset.i), tb = findTable(id);
      const ord = doc.results.order[id] = doc.results.order[id] || [];
      const at = ord.findIndex(o => o.t === t && o.i === k);
      if (at >= 0) { ord.splice(at, 1); if (ord[at]) ord[at].tie = ord[at].tie && at > 0; }
      else if (ord.length < tb.perTeam * 2) { ord.push({ t, i: k, tie: !!tieNext[id] && ord.length > 0 }); tieNext[id] = false; }
      changed(true); break;
    }
    case "tie": tieNext[b.dataset.tb] = !tieNext[b.dataset.tb]; renderPanel(); break;
    case "undo-rank": { const ord = doc.results.order[b.dataset.tb] || []; ord.pop(); tieNext[b.dataset.tb] = false; changed(true); break; }
    case "clear-rank": if (b.dataset.sure) { doc.results.order[b.dataset.tb] = []; tieNext[b.dataset.tb] = false; changed(true); } else { b.dataset.sure = "1"; b.textContent = "本当にやり直す"; } break;
    case "win": { const box = b.dataset.k === "team" ? doc.results.team : doc.results.duel, v = b.dataset.v; box[b.dataset.tb] = box[b.dataset.tb] === v ? undefined : v; changed(true); break; }
    case "num": {
      const { pt, t, k } = b.dataset, v = Number(b.dataset.v), path = `results.ev.${pt}.${t}.${k}`;
      setPath(path, getPath(path) === v ? null : v);
      if (b.dataset.first && v > 0 && getPath(path) === v) setPath(`results.ev.${pt}.${other(t)}.${k}`, 0);
      changed(true); break;
    }
    case "st-open": stageOn = true; renderStage(); tick(true); break;
    case "st-close": stageOn = false; try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {} renderStage(); break;
    case "st-hide": stHidden = !stHidden; renderStage(); break;
    case "st-timer": stTimer = !stTimer; renderStage(); break;
    case "st-full": try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) {} break;
    case "copy": {
      const t = totals(), lines = [`${c.name}　${c.teams[0].name} ${fmt(t.A)} − ${fmt(t.B)} ${c.teams[1].name}`, ...c.phases.map(ph => { const r = phaseRes(ph); return `・${ph.name}：${fmt(r.pts.A)} − ${fmt(r.pts.B)}`; })];
      try { await navigator.clipboard.writeText(lines.join("\n")); $("copymsg").textContent = "コピーしました"; } catch (_) { $("copymsg").textContent = lines.join(" ／ "); }
      break;
    }
    case "timer-set": tset({ total: Number(b.dataset.min) * 60000, label: b.dataset.label, end: null, paused: null }); fl = {}; renderPanel(); break;
    case "timer-go": {
      unlockAudio(); const now = Date.now(), tm = doc.timer;
      if (tm.end != null) tset({ paused: tm.end - now, end: null });
      else if (tm.paused != null) tset({ end: now + tm.paused, paused: null });
      else { const mi = $("tmMin"), la = $("tmLabel"); const total = mi ? Math.max(1, Number(mi.value) || 1) * 60000 : tm.total; tset({ total, label: la ? la.value : tm.label, end: now + total, paused: null }); fl = {}; }
      tick(true); break;
    }
    case "timer-reset": { const mi = $("tmMin"), la = $("tmLabel"); tset({ total: mi ? Math.max(1, Number(mi.value) || 1) * 60000 : doc.timer.total, label: la ? la.value : doc.timer.label, end: null, paused: null }); fl = {}; tick(true); break; }
    case "timer-sound": sound = !sound; if (sound) { unlockAudio(); beep(880, .15, 1); } tick(true); break;
    case "sync-save": { const url = ($("syncUrl").value || "").trim(), id = ($("syncId").value || "").trim().replace(/[^\w-]/g, ""); if (!url || !id) { flash("URLと大会IDの両方を入れてください。"); break; } saveSync({ url, id }); renderPanel(); startSync(true); break; }
    case "sync-off": saveSync({}); stopSync(); renderPanel(); break;
    case "copy-share": try { await navigator.clipboard.writeText($("shareLink").value); flash("リンクをコピーしました"); } catch (_) { $("shareLink").select(); } break;
    case "reset-results": if (b.dataset.sure) { doc.results = blankResults(); changed(true); } else { b.dataset.sure = "1"; b.textContent = "本当に消す（もう一度押す）"; } break;
    case "copy-data": try { await navigator.clipboard.writeText($("dataBox").value); flash("コピーしました"); } catch (_) { $("dataBox").select(); } break;
    case "import": case "import-config": {
      try { const d = JSON.parse($("dataBox").value); if (!d.config || !Array.isArray(d.config.phases)) throw 0; doc.config = d.config; doc.results = a === "import" ? Object.assign(blankResults(), d.results || {}) : blankResults(); changed(true); flash("読み込みました"); }
      catch (_) { flash("読み込めませんでした。書き出した文字をそのまま貼ってください。"); }
      break;
    }
  }
});

/* ---------- タイマー ---------- */
let sound = false, fl = {}, prevRem = null, actx = null, alertTimer = null;
function tset(p) { Object.assign(doc.timer, p); changed(false); }
const remOf = now => doc.timer.end != null ? doc.timer.end - now : (doc.timer.paused != null ? doc.timer.paused : doc.timer.total);
const mmss = ms => { const neg = ms < 0; ms = Math.abs(ms); let s = Math.floor(ms / 1000); if (!neg && ms % 1000) s++; return (neg ? "+" : "") + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
function unlockAudio() { try { if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } if (actx && actx.state === "suspended") actx.resume(); } catch (_) {} }
function beep(f = 880, d = .25, n = 3) { if (!actx) return; try { for (let i = 0; i < n; i++) { const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * (d + .12); o.frequency.value = f; o.type = "square"; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + .02); } } catch (_) {} }
function flash(msg, f, n) { const a = $("alert"); a.textContent = msg; a.hidden = false; clearTimeout(alertTimer); alertTimer = setTimeout(() => { a.hidden = true; }, 15000); if (sound && f) beep(f, .25, n || 3); }
$("alert").addEventListener("click", () => { $("alert").hidden = true; });
function tick() {
  const now = Date.now(), tm = doc.timer, rem = remOf(now), running = tm.end != null, L = tm.label ? tm.label + "　" : "";
  if (running && prevRem != null) {
    if (!fl.f15 && tm.total > 15 * 60000 && prevRem > 15 * 60000 && rem <= 15 * 60000) { fl.f15 = 1; flash(L + "残り15分です", 988, 2); }
    if (!fl.f5 && tm.total > 5 * 60000 && prevRem > 5 * 60000 && rem <= 5 * 60000) { fl.f5 = 1; flash(L + "残り5分です", 988, 3); }
    if (!fl.f0 && prevRem > 0 && rem <= 0) { fl.f0 = 1; flash(L + "時間です！", 523, 5); }
  }
  prevRem = running ? rem : null;
  const lv = rem <= 5 * 60000 ? "last" : rem <= 15 * 60000 ? "warn" : "";
  const pct = tm.total ? Math.min(100, Math.max(0, (1 - rem / tm.total) * 100)) : 0;
  const endTxt = running ? (rem > 0 ? `${new Date(tm.end).getHours()}:${String(new Date(tm.end).getMinutes()).padStart(2, "0")} に終了` : "時間切れ") : (tm.paused != null ? "一時停止中" : "スタートを押すと始まります");
  const set = (id, f) => { const el = $(id); if (el) f(el); };
  set("tmBig", el => { el.textContent = mmss(rem); el.style.color = lv === "last" ? "var(--bad)" : lv === "warn" ? "var(--gold)" : ""; });
  set("tmEnd", el => el.textContent = (tm.label ? tm.label + "　" : "") + endTxt);
  set("stTt", el => { el.textContent = mmss(rem); el.dataset.lv = lv; });
  set("stTl", el => el.textContent = tm.label || "");
  set("stTe", el => el.textContent = endTxt);
  set("stTb", el => el.style.width = pct + "%");
  document.querySelectorAll(".tgo").forEach(el => el.textContent = running ? "一時停止" : tm.paused != null ? "再開" : "スタート");
  set("tmSound", el => el.textContent = "音：" + (sound ? "オン" : "オフ"));
}
setInterval(tick, 250);

/* ---------- 共有（Google Apps Script） ---------- */
function syncConf() { try { return JSON.parse(localStorage.getItem(LS_SYNC) || "{}"); } catch (_) { return {}; } }
function saveSync(s) { try { localStorage.setItem(LS_SYNC, JSON.stringify(s)); } catch (_) {} }
let pollTimer = null, pushTimer = null, pushing = false, lastPushed = 0;
function syncStat(t, bad) { const el = $("syncStat"); el.textContent = t; el.style.color = bad ? "#ff9b90" : ""; }
function stopSync() { clearInterval(pollTimer); pollTimer = null; syncStat("この端末に保存"); }
async function pull() {
  const s = syncConf(); if (!s.url || !s.id) return;
  try {
    const r = await fetch(`${s.url}?id=${encodeURIComponent(s.id)}&t=${Date.now()}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "error");
    if (j.doc) {
      const d = typeof j.doc === "string" ? JSON.parse(j.doc) : j.doc;
      if ((d.savedAt || 0) > maxSeen) maxSeen = d.savedAt;
      if ((d.savedAt || 0) > (doc.savedAt || 0)) {
        const a = document.activeElement, typing = a && a.tagName === "INPUT" && a.dataset.bind;
        if (!typing) { doc = d; try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (_) {} renderAll(); }
      } else if ((doc.savedAt || 0) > (d.savedAt || 0) && doc.savedAt !== lastPushed) pushSoon();
    } else if (doc.savedAt) pushSoon();
    syncStat(`共有中（${s.id}）`);
  } catch (err) { syncStat("共有先につながりません", true); }
}
function pushSoon() { if (!syncConf().url) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 500); }
async function push() {
  const s = syncConf(); if (!s.url || !s.id) return;
  if (pushing) { pushSoon(); return; }
  pushing = true; const sent = doc.savedAt;
  try {
    const r = await fetch(s.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ id: s.id, savedAt: sent, doc: JSON.stringify(doc) }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "error");
    lastPushed = sent; syncStat(`共有中（${s.id}）`);
  } catch (_) { syncStat("保存できませんでした（もう一度送ります）", true); setTimeout(pushSoon, 3000); }
  pushing = false;
}
function startSync(first) { const s = syncConf(); if (!s.url || !s.id) return; clearInterval(pollTimer); pollTimer = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 3000); if (first) pull(); }

/* 共有リンク（?e=大会ID&s=URL）で開いたとき */
(() => { const q = new URLSearchParams(location.search), id = q.get("e"), url = q.get("s"); if (id && url) { saveSync({ id, url }); doc.savedAt = 0; history.replaceState(null, "", location.pathname); } })();

renderAll();
startSync(true);
})();
