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
/* 共有先として受け付けるURL（Apps Script。動作確認用に localhost も可） */
function okSyncUrl(u) {
  try { const x = new URL(u); if (x.username || x.password) return false; return (x.protocol === "https:" && x.hostname === "script.google.com") || (x.protocol === "http:" && x.hostname === "localhost"); } catch (_) { return false; }
}
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
    { id: "i1", no: 1, name: "位置ヒント", desc: "エイトパズルで1文字の正しい位置を教えてもらう" },
    { id: "i2", no: 2, name: "ドボン公開", desc: "エイトテレパシーでドボンを教えてもらう" },
    { id: "i3", no: 3, name: "70秒延長", desc: "エイトボンバーの制限時間を70秒にする" }
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
const blankResults = () => ({ order: {}, team: {}, duel: {}, ev: {}, absent: {}, used: {} });
const blankTimer = () => ({ total: 60 * 60000, end: null, paused: null, label: "" });

/* ---------- 状態 ---------- */
let doc = null;
try { doc = JSON.parse(localStorage.getItem(LS_DOC) || "null"); } catch (_) { doc = null; }
const freshDoc = () => ({ v: 2, config: sampleConfig(), results: blankResults(), timer: blankTimer(), rts: {}, cts: 0, tts: 0 });
let fresh = !doc || !doc.config;
if (fresh) doc = freshDoc();
let tab = "play";
try { tab = localStorage.getItem(LS_TAB) || "play"; } catch (_) {}
if (!["play", "sum", "setup", "data"].includes(tab)) tab = "play";
let stageOn = false, stHidden = false, stTimer = true, maxSeen = 0;
/* 発表画面の状態（開いているか・点数を伏せているか・タイマーを出すか）は端末ごとに覚えておく */
/* 開いているかどうかはこのタブだけ（再読み込みでは残るが、別のタブ・あとで開いたときは閉じた状態） */
try { const st = JSON.parse(localStorage.getItem("vsteams-builder-stage") || "{}"); stHidden = !!st.hidden; stTimer = st.timer !== false; stageOn = sessionStorage.getItem("vsteams-builder-stage-on") === "1"; } catch (_) {}
function saveStage() { try { localStorage.setItem("vsteams-builder-stage", JSON.stringify({ hidden: stHidden, timer: stTimer })); sessionStorage.setItem("vsteams-builder-stage-on", stageOn ? "1" : "0"); } catch (_) {} }
/* 発表画面の操作ボタンは、3秒さわらないと隠す（プロジェクターに映り込まないように） */
let idleTimer = null;
function wake() { const st = document.getElementById("stage"); if (!st) return; st.classList.remove("idle"); clearTimeout(idleTimer); idleTimer = setTimeout(() => st.classList.add("idle"), 3000); }
["mousemove", "pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, wake, { passive: true }));
document.addEventListener("keydown", e => { if (e.key === "Escape" && stageOn && !document.fullscreenElement) { stageOn = false; saveStage(); renderStage(); } });
/* 当日画面：表示中の種目、開いている卓、同着の入力待ち */
let cur = null, openT = {}, tieNext = {}, openP = {}, openTb = {}, absentMode = {}, firstPrev = {};
try { cur = localStorage.getItem("vsteams-builder-cur"); } catch (_) {}

/* 読み込んだデータ・共有のデータは信用せず、形と値をそろえる（画面に入れる値を安全にする） */
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/, COLOR = /^#[0-9a-fA-F]{6}$/;
/* "__proto__" などは、オブジェクトの仕組みを書き換えられてしまうのでIDとして認めない */
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"]);
const ID = { test: k => typeof k === "string" && ID_RE.test(k) && !BAD_KEYS.has(k) };
const okId = (v, p) => ID.test(v) ? v : uid(p);
const num = (v, d, lo = -1e6, hi = 1e6) => { if (v == null || v === "") return d; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
const tnum = (v, d) => num(v, d, 0, Number.MAX_SAFE_INTEGER); /* 時刻（ミリ秒） */
const str = (v, max = 200) => (v == null ? "" : String(v)).slice(0, max);
const strs = (a, max) => Array.isArray(a) ? a.slice(0, 60).map(x => str(x, max)) : [];
function sanitizeConfig(c) {
  c = c && typeof c === "object" ? c : blankConfig();
  const dc = blankConfig().teams;
  const out = { name: str(c.name, 80), teamSize: int(c.teamSize, 4, 1, 30) };
  out.teams = [0, 1].map(i => { const t = (c.teams || [])[i] || {}; return { name: str(t.name, 60) || dc[i].name, color: COLOR.test(t.color) ? t.color : dc[i].color }; });
  out.roster = { A: strs((c.roster || {}).A, 40), B: strs((c.roster || {}).B, 40) };
  out.items = (Array.isArray(c.items) ? c.items : []).slice(0, 30).map(it => ({ id: okId(it && it.id, "i"), no: int(it && it.no, 0, 0, 999), name: str(it && it.name, 40), desc: str(it && it.desc, 200) }));
  out.phases = (Array.isArray(c.phases) ? c.phases : []).slice(0, 40).map(ph => {
    ph = ph || {};
    const o = { id: okId(ph.id, "p"), type: ph.type === "event" ? "event" : "round", name: str(ph.name, 60), time: str(ph.time, 40), minutes: int(ph.minutes, 60, 1, 600) };
    if (o.type === "round") o.tables = (Array.isArray(ph.tables) ? ph.tables : []).slice(0, 30).map(tb => {
      tb = tb || {};
      const kind = ["indiv", "team", "duel"].includes(tb.kind) ? tb.kind : "indiv";
      const per = kind === "duel" ? 1 : int(tb.perTeam, 2, 1, 10);
      return { id: okId(tb.id, "t"), game: str(tb.game, 60), kind, perTeam: per, points: Array.isArray(tb.points) ? tb.points.slice(0, 40).map(x => num(x, 0)) : [],
        win: num(tb.win, 6), draw: num(tb.draw, 3), item: typeof tb.item === "string" && ID.test(tb.item) ? tb.item : "", host: str(tb.host, 40),
        names: { A: strs((tb.names || {}).A, 40), B: strs((tb.names || {}).B, 40) } };
    });
    else o.parts = (Array.isArray(ph.parts) ? ph.parts : []).slice(0, 30).map(pt => {
      pt = pt || {};
      return { id: okId(pt.id, "e"), name: str(pt.name, 60), mode: ["count", "tier", "manual", "first"].includes(pt.mode) ? pt.mode : "count", reps: int(pt.reps, 1, 1, 20), max: int(pt.max, 8, 1, 30),
        per: num(pt.per, 1), bonusAt: int(pt.bonusAt, 0, 0, 30), bonus: num(pt.bonus, 0),
        tiers: (Array.isArray(pt.tiers) ? pt.tiers : []).slice(0, 20).map(x => [num((x || [])[0], 0), num((x || [])[1], 0)]),
        options: (Array.isArray(pt.options) ? pt.options : []).slice(0, 20).map(x => [num((x || [])[0], 0), str((x || [])[1], 30)]) };
    });
    return o;
  });
  return out;
}
function sanitizeResults(R) {
  R = R && typeof R === "object" ? R : {};
  const out = blankResults(), each = (o, f) => Object.keys(o && typeof o === "object" ? o : {}).forEach(k => { if (ID.test(k)) f(k, o[k]); });
  each(R.order, (k, v) => { out.order[k] = (Array.isArray(v) ? v : []).filter(o => o && (o.t === "A" || o.t === "B")).map(o => ({ t: o.t, i: int(o.i, 0, 0, 30), tie: !!o.tie })); });
  each(R.team, (k, v) => { if (["A", "B", "draw"].includes(v)) out.team[k] = v; });
  each(R.duel, (k, v) => { if (v === "A" || v === "B") out.duel[k] = v; });
  each(R.absent, (k, v) => { out.absent[k] = (Array.isArray(v) ? v : []).filter(o => o && (o.t === "A" || o.t === "B")).slice(0, 4).map(o => ({ t: o.t, i: int(o.i, 0, 0, 30) })); });
  each(R.used, (k, v) => { if (v === "A" || v === "B") out.used[k] = v; });
  each(R.ev, (k, v) => { out.ev[k] = { A: [], B: [] }; TEAMS.forEach(t => (Array.isArray((v || {})[t]) ? v[t] : []).slice(0, 20).forEach((x, i) => { out.ev[k][t][i] = x == null || x === "" ? null : num(x, null); })); });
  /* 古い形式の欄も、形と値をそろえてから通す（そのまま通すと、読み込んだあとに開けなくなることがある） */
  if (R.seats && typeof R.seats === "object") { out.seats = {}; each(R.seats, (k, v) => { out.seats[k] = { A: [], B: [] }; TEAMS.forEach(t => (Array.isArray((v || {})[t]) ? v[t] : []).slice(0, 10).forEach((x, i) => { const n = x == null || x === "" ? null : num(x, null, 1, 40); out.seats[k][t][i] = n == null ? null : Math.round(n); })); }); }
  if (R.names && typeof R.names === "object") { out.names = {}; each(R.names, (k, v) => { out.names[k] = { A: strs((v || {}).A, 40), B: strs((v || {}).B, 40) }; }); }
  return out;
}
/* 結果の欄の名前（rts のキー）。種目の問題番号は 0〜19 だけ（大きな番号で保存が止まらないように） */
const MAX_REPS = 20;
function okRKey(k) {
  const p = String(k).split("|");
  if (p[0] === "ev") return p.length === 4 && ID.test(p[1]) && (p[2] === "A" || p[2] === "B") && /^\d{1,2}$/.test(p[3]) && Number(p[3]) < MAX_REPS;
  return p.length === 2 && ["order", "team", "duel", "absent", "used"].includes(p[0]) && ID.test(p[1]);
}
function sanitizeDoc(d) {
  d = d && typeof d === "object" ? d : {};
  const tm = d.timer || {}, rts = {};
  Object.keys(d.rts && typeof d.rts === "object" ? d.rts : {}).forEach(k => { if (okRKey(k)) rts[k] = tnum(d.rts[k], 0); });
  return { v: 2, config: sanitizeConfig(d.config), results: sanitizeResults(d.results), rts, cts: tnum(d.cts, 0), tts: tnum(d.tts, 0),
    timer: { total: num(tm.total, 3600000, 60000, 36000000), end: tm.end == null ? null : tnum(tm.end, null), paused: tm.paused == null ? null : num(tm.paused, null, -36000000, 36000000), label: str(tm.label, 60) } };
}
let startError = false;
try { doc = sanitizeDoc(doc); normalize(); }
catch (_) { /* 保存されていた内容が壊れていた：控えに残して、見本から始める */
  try { localStorage.setItem("vsteams-builder-broken", localStorage.getItem(LS_DOC) || ""); } catch (_) {}
  doc = freshDoc(); normalize(); fresh = true; startError = true;
}
/* 初めて開いたときの見本もすぐ保存する（同時に開いた別のタブと、卓のIDがそろうように） */
if (fresh) { try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (_) {} }
function normalize(d = doc) {
  const c = d.config;
  const R = d.results;
  c.phases.forEach(ph => (ph.tables || []).forEach(tb => {
    tb.names = tb.names || { A: [], B: [] };
    /* 古い形式（名前を結果側に、順位を数字で持っていた）からの移しかえ */
    if (R.names && R.names[tb.id]) { tb.names = { A: strs(R.names[tb.id].A, 40), B: strs(R.names[tb.id].B, 40) }; }
    if (R.seats && R.seats[tb.id] && !R.order[tb.id]) {
      const list = [];
      TEAMS.forEach(t => (R.seats[tb.id][t] || []).forEach((rk, i) => { if (rk != null) list.push({ t, i, rk }); }));
      list.sort((a, b) => a.rk - b.rk);
      R.order[tb.id] = list.map((x, k) => ({ t: x.t, i: x.i, tie: k > 0 && list[k - 1].rk === x.rk }));
    }
  }));
  delete R.names; delete R.seats;
  /* アイテムの番号：一度付けた番号は、ほかのアイテムを消しても変わらない */
  const seen = new Set(); let top = Math.max(0, ...c.items.map(it => it.no || 0));
  c.items.forEach(it => { if (!it.no || seen.has(it.no)) it.no = ++top; seen.add(it.no); });
  if (d !== doc) return;
  document.documentElement.style.setProperty("--ta", c.teams[0].color || "#c0392b");
  document.documentElement.style.setProperty("--tb", c.teams[1].color || "#1f3a5f");
}
const tn = t => esc(doc.config.teams[t === "A" ? 0 : 1].name || ("チーム" + t));

/* ---------- 点数の計算 ---------- */
/* 着順に押した記録（order）から順位を出す。同着は前の人と同じ順位 */
/* 欠席の席は「下から2番目の順位に座っていた」ものとして数える（その下の人は1つ下の順位になる）。
   ほかの人の順位がその位置まで入ったところで、欠席の席に順位が付く */
const absentOf = tb => doc.results.absent[tb.id] || [];
function rankSeq(tb, ord = doc.results.order[tb.id] || []) {
  const abs = absentOf(tb), at = tb.perTeam * 2 - 1 - abs.length;
  if (!abs.length || ord.length < at) return ord;
  const rest = ord.slice(at).map((o, k) => k === 0 ? { ...o, tie: false } : o);
  return [...ord.slice(0, at), ...abs.map(a => ({ t: a.t, i: a.i, tie: false, absent: true })), ...rest];
}
function rankMap(tb, ord) {
  const m = { A: [], B: [], X: [] };
  let rk = 0;
  rankSeq(tb, ord).forEach((o, k) => { if (!(o.tie && k > 0)) rk = k + 1; if (m[o.t]) m[o.t][o.i] = rk; });
  return m;
}
/* 次に押した人に付く順位 */
function nextRank(tb) { const ord = doc.results.order[tb.id] || []; return rankMap(tb, [...ord, { t: "X", i: 0, tie: !!tieNext[tb.id] && ord.length > 0 }]).X[0]; }
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
    const p = sum / same;
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
      const it = doc.config.items.find(i => i.id === tb.item);
      list.push({ no: it ? it.no : "？", name: it ? it.name : "（アイテム未設定）", from: tb.game || "デュエル卓", key: tb.id, used: doc.results.used[tb.id] === team });
    }
  }));
  return list.sort((a, b) => (typeof a.no === "number" ? a.no : 999) - (typeof b.no === "number" ? b.no : 999));
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
  /* 種目の設定で、届かない値になっていないか */
  c.phases.forEach(ph => (ph.parts || []).forEach(pt => {
    const where = `${ph.name}「${pt.name}」`;
    if (pt.mode === "count" && pt.max > c.teamSize) out.push(`${where}：最大の人数（${pt.max}）が1チームの人数（${c.teamSize}）より多くなっています。`);
    if (pt.mode === "count" && pt.max < c.teamSize) out.push(`${where}：最大の人数（${pt.max}）が1チームの人数（${c.teamSize}）より少なく、当日は${pt.max}までしか押せません（わざとなら、そのままで大丈夫です）。`);
    if (pt.mode === "count" && pt.bonusAt && pt.bonusAt > pt.max) out.push(`${where}：ボーナスの条件（${pt.bonusAt}人以上）が最大の人数（${pt.max}）を超えていて、届きません。`);
    if (pt.mode === "tier" && (pt.tiers || []).some(x => x[0] > pt.max)) out.push(`${where}：段階の値が最大の値（${pt.max}）を超えていて、届かない段階があります。`);
    if (pt.mode === "tier" && !(pt.tiers || []).length) out.push(`${where}：段階が入っていません。`);
    if (pt.mode === "first" && !(pt.options || []).length) out.push(`${where}：選択肢が入っていません。`);
  }));
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
  let h = `<div class="row between"><h2>準備</h2>${pr.length ? "" : '<span class="chip ok">設定に問題はありません</span>'}</div>
  ${pr.length ? `<div class="warn"><b>確認してください</b><ul style="margin:4px 0 0;padding-left:18px">${pr.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
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
          const it = c.items.find(x => x.id === tb.item), nNamed = TEAMS.reduce((a, t) => a + ((tb.names || {})[t] || []).filter(Boolean).length, 0);
          const brief = tb.kind === "indiv" ? `配点 ${(tb.points || []).join(",")}` : tb.kind === "team" ? `勝ち${fmt(tb.win)}点・引き分け${fmt(tb.draw)}点` : `アイテム ${it ? it.no + " " + esc(it.name) : "未設定"}`;
          return `<details class="tbl" data-tid="${tb.id}" ${openTb[tb.id] ? "open" : ""}><summary><b>${esc(tb.game || "（ゲーム名なし）")}</b><span class="hint">${KIND_LABEL[tb.kind]}・${tb.perTeam}対${tb.perTeam}　${brief}　席の名前 ${nNamed}/${tb.perTeam * 2}</span></summary><div class="tbl-in"><div class="row between"><div class="row">
              <label class="field"><span class="lbl">ゲーム名</span>${inp(T + ".game", tb.game, "str", 'style="width:13em"')}</label>
              <label class="field"><span class="lbl">種類</span>${sel(T + ".kind", tb.kind, Object.entries(KIND_LABEL), "str", 'data-re="kind"')}</label>
              <label class="field"><span class="lbl">各チーム何人</span>${inp(T + ".perTeam", tb.perTeam, "num", 'min="1" max="10" data-re="per"')}</label>
            </div><button type="button" class="small danger" data-act="del-table" data-i="${pi}" data-j="${ti}">卓を消す</button></div>
            ${tb.kind === "indiv" ? `<label class="field"><span class="lbl">配点（1位から順に、カンマ区切り・${tb.perTeam * 2}人分）</span>${inp(T + ".points", (tb.points || []).join(","), "list")}</label>` : ""}
            ${tb.kind === "team" ? `<div class="row"><label class="field"><span class="lbl">勝ちチームの点</span>${inp(T + ".win", tb.win, "num")}</label><label class="field"><span class="lbl">引き分けの点（各チーム）</span>${inp(T + ".draw", tb.draw, "num")}</label></div>` : ""}
            ${tb.kind === "duel" ? `<label class="field"><span class="lbl">勝ったチームがもらうアイテム</span>${sel(T + ".item", tb.item, [["", "（選ぶ）"], ...c.items.map(it => [it.id, it.no + "　" + it.name])])}</label>` : ""}
            <div class="row" style="align-items:flex-start">${TEAMS.map(t => `<div class="field"><span class="lbl ${t === "A" ? "ta" : "tb"}">${tn(t)} の席（名前・任意）</span>${Array.from({ length: tb.perTeam }, (_, i) => `<input list="ros${t}" data-bind="${T}.names.${t}.${i}" data-type="str" value="${esc(((tb.names || {})[t] || [])[i] || "")}" placeholder="${t}${i + 1}" style="width:9em;margin-top:3px">`).join("")}</div>`).join("")}
            <label class="field"><span class="lbl">進行役（任意）</span>${inp(T + ".host", tb.host, "str", 'style="width:9em"')}</label></div>
          </div></details>`;
        }).join("")}
        <div class="row"><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="indiv">＋ 個人戦の卓</button><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="team">＋ チーム戦の卓</button><button type="button" class="small" data-act="add-table" data-i="${pi}" data-k="duel">＋ デュエル卓</button></div>
      </article></details>`;
    } else {
      h += `<article class="card phase event">${head}
        ${(ph.parts || []).map((pt, ki) => {
          const K = `${P}.parts.${ki}`;
          let detail = "";
          if (pt.mode === "count") detail = `<label class="field"><span class="lbl">最大の人数</span>${inp(K + ".max", pt.max, "num", 'min="1" max="30" data-re="pmax"')}</label><label class="field"><span class="lbl">1人あたりの点</span>${inp(K + ".per", pt.per, "num", 'step="0.5"')}</label><label class="field"><span class="lbl">ボーナスの条件（○人以上）</span>${inp(K + ".bonusAt", pt.bonusAt, "num")}</label><label class="field"><span class="lbl">ボーナスの点</span>${inp(K + ".bonus", pt.bonus, "num")}</label>`;
          if (pt.mode === "tier") detail = `<label class="field"><span class="lbl">最大の値</span>${inp(K + ".max", pt.max, "num", 'min="1" max="30" data-re="pmax"')}</label><label class="field" style="flex:1"><span class="lbl">段階（「以上:点」をカンマ区切り。例 8:5,6:3,4:1）</span>${inp(K + ".tiers", (pt.tiers || []).map(x => x.join(":")).join(","), "pairs")}</label>`;
          if (pt.mode === "first") detail = `<label class="field" style="flex:1"><span class="lbl">選択肢（「点:説明」をカンマ区切り。例 10:30秒以内,6:1分以内）</span>${inp(K + ".options", (pt.options || []).map(x => x.join(":")).join(","), "pairs")}</label>`;
          const brief = pt.mode === "count" ? `1人${fmt(pt.per)}点${pt.bonusAt ? `・${pt.bonusAt}人以上で+${fmt(pt.bonus)}` : ""}` : pt.mode === "tier" ? (pt.tiers || []).map(x => `${x[0]}以上${fmt(x[1])}点`).join("・") : pt.mode === "first" ? (pt.options || []).map(x => `${esc(x[1])}${fmt(x[0])}点`).join("・") : "";
          return `<details class="tbl" data-tid="${pt.id}" ${openTb[pt.id] ? "open" : ""}><summary><b>${esc(pt.name || "（名前なし）")}</b><span class="hint">${MODE_LABEL[pt.mode]}${pt.reps > 1 ? `・${pt.reps}問` : ""}　${brief}</span></summary><div class="tbl-in"><div class="row between"><div class="row">
              <label class="field"><span class="lbl">名前</span>${inp(K + ".name", pt.name, "str", 'style="width:16em"')}</label>
              <label class="field"><span class="lbl">点数の付け方</span>${sel(K + ".mode", pt.mode, Object.entries(MODE_LABEL), "str", 'data-re="mode"')}</label>
              <label class="field"><span class="lbl">回数（問題数）</span>${inp(K + ".reps", pt.reps, "num", 'min="1" max="20" data-re="preps"')}</label>
            </div><button type="button" class="small danger" data-act="del-part" data-i="${pi}" data-j="${ki}">消す</button></div>
            <div class="row">${detail}</div></div></details>`;
        }).join("")}
        <div><button type="button" class="small" data-act="add-part" data-i="${pi}">＋ 項目を追加</button></div>
        <p class="hint" style="margin:0">人数×点：渡せた人数・抜けた人数など。段階で点：正しい文字数などで点が変わる。先着：先にクリアしたチームだけ点が入る。</p>
      </article></details>`;
    }
  });
  if (!c.phases.length) h += '<p class="hint">まだ何もありません。上のボタンでROUNDや種目を追加してください。</p>';
  /* アイテムはデュエル卓を使うときだけ要るので、進行の下にたたんでおく */
  h += `<details class="pd" data-pid="items" ${openP.items ? "open" : ""}><summary><span class="chip">アイテム</span><b>デュエル卓の勝者がもらう特典</b><span class="hint">${c.items.length}個</span></summary><article class="card">
    <div class="row between"><p class="hint" style="margin:0">発表画面には番号だけを出します（中身は主催だけが知っている）。番号は、ほかのアイテムを消しても変わりません。</p><button type="button" class="small" data-act="add-item">＋ アイテムを追加</button></div>
    ${c.items.length ? `<div class="scroll"><table class="seats"><tr><th>番号</th><th>名前</th><th>効果</th><th></th></tr>${c.items.map((it, i) => `<tr><td>${it.no}</td><td>${inp(`config.items.${i}.name`, it.name)}</td><td>${inp(`config.items.${i}.desc`, it.desc, "str", 'style="width:100%"')}</td><td><button type="button" class="small danger" data-act="del-item" data-i="${i}">消す</button></td></tr>`).join("")}</table></div>` : '<p class="hint" style="margin:0">まだありません。</p>'}
  </article></details>`;
  return h +`<datalist id="rosA">${(c.roster.A || []).map(n => `<option value="${esc(n)}">`).join("")}</datalist><datalist id="rosB">${(c.roster.B || []).map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
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
/* ほかの操作は「…」の中にしまう（いつも使うボタンだけを見せる） */
const more = (inner, label = "ほかの操作") => `<details class="more"><summary aria-label="${label}" title="${label}">…</summary><div class="menu">${inner}</div></details>`;
/* タイマーは1行。止まっているときにスタートを押すと、このROUNDの分数で始まる */
function timerBar(ph) {
  const tm = doc.timer, min = ph.minutes || 60, mine = tm.label === ph.name;
  return `<div class="tbar"><span class="tlab">${esc(tm.label || "タイマー")}</span><span class="tbig" id="tmBig">--:--</span><span class="hint tend" id="tmEnd"></span>
      <button type="button" class="primary tgo" data-act="timer-go" data-label="${esc(ph.name)}" data-min="${min}">スタート</button>
      ${more(`${mine ? "" : `<button type="button" data-act="timer-set" data-label="${esc(ph.name)}" data-min="${min}">${esc(ph.name)}の${min}分にする</button>`}<button type="button" data-act="timer-reset">リセット</button><button type="button" data-act="timer-sound" id="tmSound">音：オフ</button>`, "タイマーのほかの操作")}
    </div>`;
}
function tableCard(tb) {
  /* 入れ終わった卓は、最後に押した直後は開いたまま（押し間違いに気づけるように）。見出しで開け閉めできる */
  const r = tableRes(tb), done = r.status === "done", open = openT[tb.id] ?? !done;
  const sumTxt = tb.kind === "duel" ? (r.win ? `${tn(r.win)} の勝ち（アイテム獲得）` : "") : `<span class="ta">${fmt(r.pts.A)}</span> − <span class="tb">${fmt(r.pts.B)}</span>`;
  let h = `<article class="card tcard${done ? " done" : ""}"><button type="button" class="thead" data-act="toggle-table" data-tb="${tb.id}" aria-expanded="${open}">
      <span class="tname">${open ? "▾ " : "▸ "}${done ? "✓ " : ""}${esc(tb.game || "（ゲーム名なし）")}</span><span class="tsum">${sumTxt}</span><span class="hint">${KIND_LABEL[tb.kind]}・${tb.perTeam}対${tb.perTeam}</span></button>`;
  if (!open) return h + `</article>`;
  if (tb.kind === "indiv") {
    const rm = rankMap(tb), ord = doc.results.order[tb.id] || [], abs = absentOf(tb), total = tb.perTeam * 2, n = ord.length, cap = total - abs.length, am = !!absentMode[tb.id];
    const isAbs = (t, i) => abs.some(a => a.t === t && a.i === i);
    /* 欠席の席のすぐ次の順位は、前の人と同着にできない（間に欠席の席が入るため） */
    const noTie = abs.length && n === total - 1 - abs.length;
    const guide = am ? "<b>欠席の人</b>を押してください（もう一度押すと取り消し）" : n >= cap ? "全員の順位が入りました。" : `<b>${nextRank(tb)}位</b>の人を押してください${tieNext[tb.id] ? "（前の人と同着）" : ""}`;
    h += `<p class="guide">${guide}</p><div class="seatgrid">`;
    TEAMS.forEach(t => { for (let i = 0; i < tb.perTeam; i++) {
      const rk = rm[t][i], ab = isAbs(t, i);
      h += `<button type="button" class="seat ${t === "A" ? "sa" : "sb"}${rk ? " ranked" : ""}${ab ? " absent" : ""}" data-act="pick" data-tb="${tb.id}" data-t="${t}" data-i="${i}"><span class="rk">${ab ? "欠席" + (rk ? `（${rk}位扱い）` : "") : rk ? rk + "位" : ""}</span><span class="nm">${esc(nameOf(tb, t, i))}</span><span class="pt">${rk ? fmt(r.seat[t + i]) + "点" : ""}</span></button>`;
    } });
    /* いつも見せるのは、今使えるボタンだけ。めったに使わない操作は「…」の中 */
    const canTie = n > 0 && n < cap && !am && !noTie;
    const named = TEAMS.some(t => ((tb.names || {})[t] || []).some(Boolean));
    h += `</div><div class="row tact">${am ? `<button type="button" class="primary" data-act="absent-mode" data-tb="${tb.id}">欠席を選び終わる</button>` : ""}${n && !am ? `<button type="button" data-act="undo-rank" data-tb="${tb.id}">↶ 1つ戻す</button>` : ""}${canTie ? `<button type="button" data-act="tie" data-tb="${tb.id}" aria-pressed="${!!tieNext[tb.id]}">次の人を同着に</button>` : ""}
      ${more(`${n ? `<button type="button" class="danger" data-act="clear-rank" data-tb="${tb.id}">順位をすべて消す</button>` : ""}${tb.perTeam > 1 && !am ? `<button type="button" data-act="absent-mode" data-tb="${tb.id}">欠席がいる</button>` : ""}
        <p class="hint">順位の付いた人をもう一度押すと、その人の順位だけ消せます。${tb.perTeam > 1 ? "欠席の席は、下から2番目の順位にいたものとして数えます。" : ""}${named ? "" : "席の名前は「準備」の卓の中で入れられます。"}</p>`)}</div>`;
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
    h += `<div class="qpair">`;
    TEAMS.forEach(t => {
      const v = (((doc.results.ev[pt.id] || {})[t]) || [])[k], p = partPts(pt, v);
      let ctl;
      if (pt.mode === "count" || pt.mode === "tier") ctl = Array.from({ length: (pt.max || 8) + 1 }, (_, n) => `<button type="button" class="num" data-act="num" data-pt="${pt.id}" data-t="${t}" data-k="${k}" data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join("");
      else if (pt.mode === "first") ctl = [...(pt.options || []), [0, "なし"]].map(([pv, l]) => `<button type="button" class="num wide" data-act="num" data-pt="${pt.id}" data-t="${t}" data-k="${k}" data-v="${pv}" data-first="1" aria-pressed="${v === pv}">${esc(l)}${pv ? `（${pv}）` : ""}</button>`).join("");
      else ctl = inp(`results.ev.${pt.id}.${t}.${k}`, v, "num", 'step="0.5" style="width:6em"');
      h += `<div class="numrow ${t === "A" ? "na" : "nb"}"><div class="nhead"><span class="nteam ${t === "A" ? "ta" : "tb"}">${tn(t)}</span><span class="npt">${p != null ? fmt(p) + "点" : "–"}</span></div><div class="nums${pt.mode === "count" || pt.mode === "tier" ? " grid" : ""}">${ctl}</div></div>`;
    });
    h += `</div>`;
  }
  return h + `</article>`;
}
const STATUS_LABEL = { done: "確定", partial: "入力中", empty: "未入力" };
/* 初めて開いたときの案内（閉じたら出さない） */
function welcome() {
  let seen = false; try { seen = localStorage.getItem("vsteams-builder-welcome") === "1"; } catch (_) {}
  if (seen || syncConf().url) return ""; /* 共有中は出さない（ここから白紙にすると、共有中の大会が消えてしまうため） */
  return `<div class="welcome"><p><b>見本の大会が入っています。</b>席を押して試すか、白紙から自分の大会を作れます。</p>
    <div class="row"><button type="button" class="primary" data-act="welcome-blank">白紙から作る</button><button type="button" data-act="welcome-close">このまま試す</button></div></div>`;
}
function renderPlay() {
  const c = doc.config;
  if (!c.phases.length) return '<p class="hint">まだ大会の中身がありません。「準備」でROUNDや種目を作ってください。</p>';
  const pi = curPhase(), ph = c.phases[pi], pr = phaseRes(ph);
  /* 表示中のROUNDを覚えておく（最後の卓を入れた瞬間に、勝手に次へ移らないように） */
  if (cur !== ph.id) { cur = ph.id; try { localStorage.setItem("vsteams-builder-cur", cur); } catch (_) {} }
  let h = welcome() + `<nav class="pills" aria-label="種目">${c.phases.map((p, i) => { const s = phaseRes(p).status; return `<button type="button" data-act="phase" data-i="${i}" aria-pressed="${i === pi}" title="${STATUS_LABEL[s]}"><span class="dot ${s}" aria-hidden="true"></span>${esc(p.name)}<span class="sr">（${STATUS_LABEL[s]}）</span></button>`; }).join("")}</nav>
    <div class="phead"><div class="ptitle"><h2>${esc(ph.name)} <span class="hint">${esc(ph.time || "")}</span></h2><span class="psum"><b class="ta">${fmt(pr.pts.A)}</b> − <b class="tb">${fmt(pr.pts.B)}</b></span></div><div class="pctl">${timerBar(ph)}<button type="button" data-act="st-open">発表画面</button></div></div>`;
  if (ph.type === "round") {
    const tbs = ph.tables || [];
    h += `<div class="grid">${tbs.map(tableCard).join("")}</div>`;
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
  const items = team => { const l = itemsOf(team), left = l.filter(x => !x.used).length; return `<article class="card"><h3><span class="${team === "A" ? "ta" : "tb"}">${tn(team)}</span> のアイテム（残り${left}個／${l.length}個）</h3>${l.length ? l.map(x => `<div class="itemrow${x.used ? " used" : ""}"><span><span class="nm">${x.no}　${esc(x.name)}</span> <span class="hint">（${esc(x.from)}）</span></span><button type="button" class="small" data-act="use-item" data-tb="${x.key}" aria-pressed="${x.used}">${x.used ? "使用済み" : "使った"}</button></div>`).join("") : '<p class="hint" style="margin:0">まだありません。</p>'}</article>`; };
  return `<h2>集計</h2><article class="card"><div class="scroll"><table class="seats"><tr><th>種目</th><th></th><th class="ta">${tn("A")}</th><th class="tb">${tn("B")}</th></tr>${rows}<tr><th>合計</th><th></th><th class="pt ta">${fmt(t.A)}</th><th class="pt tb">${fmt(t.B)}</th></tr></table></div>
  <div class="row"><button type="button" class="primary" data-act="st-open">発表画面を開く</button><button type="button" data-act="copy">結果を文字でコピー</button><span class="hint" id="copymsg"></span></div></article>
  <div class="grid">${items("A")}${items("B")}</div>`;
}

/* ---------- 画面：データ・共有 ---------- */
function renderData() {
  const s = syncConf();
  const base = s.url && s.id ? `${location.origin}${location.pathname}?e=${encodeURIComponent(s.id)}&s=${encodeURIComponent(s.url)}` : "";
  const share = base && s.key ? base + "&k=" + encodeURIComponent(s.key) : base;
  let hasBackup = false; try { hasBackup = !!localStorage.getItem("vsteams-builder-backup"); } catch (_) {}
  const pj = pendingJoin ? `<article class="card welcome"><h3>共有中の大会に参加しますか？</h3><p style="margin:0">リンクの大会ID「<b>${esc(pendingJoin.id)}</b>」に参加します。<br>つながる先：<code style="overflow-wrap:anywhere">${esc(pendingJoin.url)}</code><br>自分たちの Apps Script のURLか確かめてから参加してください。<br>この端末の今の内容は、共有中の大会の内容に置きかわります（今の内容は控えとして残します）。${pendingJoin.key ? "" : "<br>合言葉がないリンクなので、見るだけになります（入力は保存されません）。"}</p>
    <div class="row"><button type="button" class="primary" data-act="join-yes">参加する</button><button type="button" data-act="join-no">参加しない</button></div></article>` : "";
  return `<h2>データ・共有</h2>${pj}
  <article class="card"><h3>複数の端末で共有する</h3>
    <p class="hint" style="margin:0">Googleスプレッドシートに置いた共有用の仕組み（Apps Script）のURLを入れると、スマホで入れた結果がパソコンの発表画面にも出ます。作り方は README を見てください。</p>
    <label class="field"><span class="lbl">Apps Script のURL（…/exec）</span><input id="syncUrl" value="${esc(s.url || "")}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%"></label>
    <label class="field"><span class="lbl">大会ID（同じIDの端末同士で共有。英数字）</span><input id="syncId" value="${esc(s.id || "")}" placeholder="例：bansishi-2026"></label>
    <label class="field"><span class="lbl">合言葉（Code.gs の WRITE_KEY と同じもの。空なら見るだけ）</span><input id="syncKey" value="${esc(s.key || "")}" autocomplete="off"></label>
    <div class="row"><button type="button" class="primary" data-act="sync-save">共有を始める</button><button type="button" data-act="sync-off">共有をやめる</button></div>
    ${share ? `<label class="field"><span class="lbl">運営スタッフ用リンク（入力できる。参加者には渡さない）</span><input readonly value="${esc(share)}" style="width:100%" id="shareLink"></label><div><button type="button" class="small" data-act="copy-share">リンクをコピー</button></div>` : ""}
    ${base && s.key ? `<label class="field"><span class="lbl">見るだけのリンク（合言葉なし。発表用のパソコンなど）</span><input readonly value="${esc(base)}" style="width:100%"></label>` : ""}
    ${hasBackup ? `<div><button type="button" class="small" data-act="restore-backup">共有に参加する前の内容を出す</button></div>` : ""}
  </article>
  <article class="card"><h3>大会をまるごと入れかえる</h3><p class="hint" style="margin:0">今の設定と結果を消して、見本か白紙に入れかえます。直後なら画面下の「元に戻す」で戻せます。</p>
    <div class="row"><button type="button" data-act="load-sample">見本（八人の盤士杯）を読み込む</button><button type="button" data-act="new-blank">白紙にする</button></div></article>
  <article class="card"><h3>結果だけを消す</h3><p class="hint" style="margin:0">設定（チーム・卓・種目）は残して、順位や点数の入力だけを消します。消した直後なら、画面下の「元に戻す」で戻せます。</p><div><button type="button" class="danger" data-act="reset-results">結果を消す</button></div></article>
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
/* 見るだけの端末でも押せるボタン（画面の切りかえ・発表画面・コピー・共有の設定） */
const RO_OK = new Set(["phase", "toggle-table", "st-open", "st-close", "st-hide", "st-timer", "st-full", "copy", "copy-share", "copy-data", "sync-save", "sync-off", "join-yes", "join-no", "restore-backup", "timer-sound", "welcome-close"]);
const RO_MSG = "見るだけの端末です（合言葉なし）。入力は運営スタッフ用リンクで開いた端末で行ってください。";
/* 描き直したあとも、押したボタンにフォーカスを戻す（キーボードで続けて操作できるように） */
const KEEP_ATTRS = ["act", "tb", "t", "i", "j", "pt", "k", "v", "tab"];
function btnSelector(b) { return "button" + KEEP_ATTRS.filter(k => b.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(b.dataset[k])}"]`).join(""); }
function renderPanel() {
  const a = document.activeElement, inPanel = a && $("panel").contains(a), keep = a && a.dataset && a.dataset.bind, keepId = a && a.id && inPanel ? a.id : null;
  const keepBtn = inPanel && a.tagName === "BUTTON" && (a.dataset.act || a.dataset.tab) ? btnSelector(a) : null;
  const y = window.scrollY;
  const ro = readOnly && tab !== "data" ? `<p class="warn" style="margin:0">${RO_MSG}</p>` : "";
  $("panel").innerHTML = ro + (tab === "setup" ? renderSetup() : tab === "play" ? renderPlay() : tab === "sum" ? renderSum() : renderData());
  if (readOnly) {
    $("panel").querySelectorAll("button[data-act]").forEach(b => { if (!RO_OK.has(b.dataset.act)) b.disabled = true; });
    $("panel").querySelectorAll("[data-bind]").forEach(el => { el.disabled = true; });
  }
  const el = keep ? document.querySelector(`[data-bind="${CSS.escape(keep)}"]`) : keepId ? $(keepId) : keepBtn ? $("panel").querySelector(keepBtn) : null;
  if (el && !el.disabled) { el.focus({ preventScroll: true }); if (el.tagName === "INPUT" && el.type !== "color") { try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } window.scrollTo({ top: y }); }
  tick(true);
}
/* 発表画面は暗い背景なので、チームの色を明るくして使う */
const light = c => `color-mix(in srgb, ${c} 55%, #ffffff)`;
function renderStage() {
  const st = $("stage"); st.hidden = !stageOn; document.body.style.overflow = stageOn ? "hidden" : ""; document.body.classList.toggle("stage-open", stageOn);
  if (!stageOn) return;
  const t = totals(), phases = doc.config.phases, res = phases.map(phaseRes), all = res.length && res.every(r => r.status === "done");
  $("stTitle").textContent = doc.config.name || "VS TEAMS";
  $("stPhase").textContent = all ? "最終結果" : "途中経過";
  $("stNA").innerHTML = tn("A"); $("stNB").innerHTML = tn("B");
  $("stNA").style.color = light(doc.config.teams[0].color); $("stNB").style.color = light(doc.config.teams[1].color);
  $("stSA").textContent = stHidden ? "?" : fmt(t.A); $("stSB").textContent = stHidden ? "?" : fmt(t.B);
  const leader = t.A > t.B ? doc.config.teams[0].name : doc.config.teams[1].name;
  $("stLead").textContent = stHidden ? "" : t.A === t.B ? (all ? "引き分け" : "同点") : all ? `${leader} の優勝！（${fmt(Math.abs(t.A - t.B))}点差）` : `${leader} が ${fmt(Math.abs(t.A - t.B))}点リード`;
  /* 最終結果は、チーム名と点数の下に大きく1行で出す */
  const win = all && !stHidden && t.A !== t.B;
  $("stWin").hidden = !win; $("stWin").textContent = win ? `${leader} の優勝！` : "";
  if (win) $("stLead").textContent = `${fmt(Math.abs(t.A - t.B))}点差`;
  st.querySelector('[data-act="timer-go"]').disabled = readOnly;
  ["A", "B"].forEach(tm => { const l = itemsOf(tm); $("stI" + tm).innerHTML = l.length ? l.map(x => `<span class="ib${x.used ? " used" : ""}">${x.no}</span>`).join("") + `<span>アイテム 残り${l.filter(x => !x.used).length}個</span>` : ""; });
  $("stBreak").innerHTML = phases.map((ph, i) => { const r = res[i], m = Math.max(r.pts.A, r.pts.B, 1), h = stHidden;
    return `<div class="st-row"><span class="v va" style="color:${light(doc.config.teams[0].color)}">${h ? "–" : fmt(r.pts.A)}</span><span class="sbar a"><i style="width:${h ? 0 : r.pts.A / m * 100}%;background:${light(doc.config.teams[0].color)}"></i></span><span class="lab">${esc(ph.name)}</span><span class="sbar"><i style="width:${h ? 0 : r.pts.B / m * 100}%;background:${light(doc.config.teams[1].color)}"></i></span><span class="v" style="color:${light(doc.config.teams[1].color)}">${h ? "–" : fmt(r.pts.B)}</span></div>`; }).join("");
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
  /* 全角の数字・記号は半角に。「−」（マイナス記号）や「‐」も「-」として読む */
  const t = el.dataset.type, v = ["num", "list", "pairs"].includes(t) ? el.value.normalize("NFKC").replace(/[\u2212\u2010-\u2015]/g, "-") : el.value;
  if (t === "num") return v.trim() === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  if (t === "list") { const xs = v.split(/[,\s、]+/).filter(Boolean); return xs.every(x => Number.isFinite(Number(x))) ? xs.map(Number) : undefined; }
  if (t === "pairs") {
    /* 「値:点」「点:説明」。区切りは最初の「:」だけ（説明に「1:00」のような「:」があってもよい） */
    const isOpt = el.dataset.bind.endsWith("options");
    const out = v.split(/[,、]+/).map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(-?\d+(?:\.\d+)?)\s*(?:[:=]|-(?=\s*-?\d))\s*(.+)$/); return m ? [Number(m[1]), m[2].trim()] : null; });
    if (out.some(p => !p || (!isOpt && !Number.isFinite(Number(p[1]))))) return undefined; /* 読めない書き方 */
    return out.map(([a, b]) => [a, isOpt ? b : Number(b)]);
  }
  if (t === "lines") return v.split(/\n/).map(s => s.trim()).filter(Boolean);
  return v;
}
/* 変更の時刻：設定（cts）・タイマー（tts）・結果は欄ごと（rts）。共有のときに欄ごとに新しい方を残す */
function stamp() { const v = Math.max(Date.now(), maxSeen + 1); maxSeen = v; return v; }
const markC = () => { doc.cts = stamp(); };
const markT = () => { doc.tts = stamp(); };
const markR = key => { doc.rts[key] = stamp(); };
function rKeyOf(path) { const k = path.split("."); if (k[0] !== "results") return null; return k[1] === "ev" ? `ev|${k[2]}|${k[3]}|${k[4]}` : `${k[1]}|${k[2]}`; }
function allRKeys(R) {
  const ks = new Set(Object.keys(doc.rts));
  ["order", "team", "duel", "absent", "used"].forEach(g => Object.keys(R[g] || {}).forEach(id => ks.add(g + "|" + id)));
  Object.keys(R.ev).forEach(id => TEAMS.forEach(t => (R.ev[id][t] || []).forEach((_, k) => ks.add(`ev|${id}|${t}|${k}`))));
  return [...ks];
}
const markAllR = before => { allRKeys(before || doc.results).forEach(markR); };
/* 卓の人数・種類が変わったとき：いない席の順位を消し、配点は手で変えていなければ作り直す */
function adjustTable(tb, old) {
  if (tb.kind === "duel") tb.perTeam = 1;
  if (tb.kind === "team" && old.kind !== "team") tb.perTeam = 2;
  tb.perTeam = Math.max(1, Math.min(10, Math.round(Number(tb.perTeam) || 1)));
  const n = tb.perTeam * 2, oldPreset = JSON.stringify(presetFor(old.perTeam * 2));
  if (tb.kind === "indiv" && (tb.points || []).length !== n && (!(tb.points || []).length || JSON.stringify(tb.points) === oldPreset)) tb.points = presetFor(n);
  if (tb.kind !== old.kind) { ["order", "team", "duel", "absent"].forEach(k => { delete doc.results[k][tb.id]; markR(k + "|" + tb.id); }); }
  else if (tb.perTeam < old.perTeam) {
    if (doc.results.order[tb.id]) { doc.results.order[tb.id] = fixTies(doc.results.order[tb.id].filter(o => o.i < tb.perTeam)); markR("order|" + tb.id); }
    if (doc.results.absent[tb.id]) { doc.results.absent[tb.id] = doc.results.absent[tb.id].filter(o => o.i < tb.perTeam); markR("absent|" + tb.id); }
  }
}
const fixTies = ord => { if (ord[0]) ord[0].tie = false; return ord; };
function onBind(el, final) {
  const path = el.dataset.bind; let val = parseVal(el);
  if (readOnly) { flash(RO_MSG); renderSoon(); return; }
  if (val === undefined) { flash(el.dataset.type === "list" ? "配点は数字をカンマで区切って入れてください（例 7,5,4,3,2,1）。読めない文字があったので、元に戻しました。" : el.dataset.bind.endsWith("options") ? "「点:説明」をカンマで区切って入れてください（例 10:30秒以内,6:1分以内）。" : "「以上の値:点」をカンマで区切って入れてください（例 8:5,6:3,4:1）。"); renderSoon(); return; }
  /* 設定の数字は、欄に決めた範囲（min・max）に収める（0人のチームなどを作らないように） */
  if (val != null && el.dataset.type === "num" && path.startsWith("config.")) {
    const lo = el.getAttribute("min"), hi = el.getAttribute("max"), v0 = val;
    if (lo != null) val = Math.max(Number(lo), val);
    if (hi != null) val = Math.min(Number(hi), val);
    if (v0 !== val) flash(`${lo}〜${hi}の範囲で入れてください（${val}にしました）。`);
  }
  if (JSON.stringify(getPath(path)) === JSON.stringify(val)) { if (final) renderSoon(); return; }
  /* 設定の数字を空欄のまま確定したら、元の値に戻す */
  if (val == null && path.startsWith("config.") && el.dataset.type === "num") { renderSoon(); return; }
  const parent = path.split(".").slice(0, -1).join("."), old = el.dataset.re ? JSON.parse(JSON.stringify(getPath(parent))) : null;
  /* 結果が入っている卓の種類を変える・席を減らすのは、その結果を消してからにしてもらう */
  if (el.dataset.re === "kind" || el.dataset.re === "per") {
    const id = old.id, ord = doc.results.order[id] || [], abs = doc.results.absent[id] || [];
    const hasResult = ord.length || abs.length || doc.results.team[id] || doc.results.duel[id];
    const newPer = el.dataset.re === "per" ? val : (val === "duel" ? 1 : val === "team" && old.kind !== "team" ? 2 : old.perTeam);
    const lost = [...ord, ...abs].some(o => o.i >= newPer);
    if ((el.dataset.re === "kind" && hasResult) || (el.dataset.re === "per" && lost)) {
      flash(`「${old.game || "この卓"}」には結果が入っています。先に「当日」でこの卓の結果を消してから変えてください。`);
      renderSoon(); return;
    }
  }
  /* 結果が入っている種目の点数の付け方を変える・最大や問題数を減らすのも、結果を消してからにしてもらう
     （そのままだと、入っていた値が別の意味で数えられたり、ボタンのない値が合計に残ったりする） */
  if (["mode", "pmax", "preps"].includes(el.dataset.re)) {
    const ev = doc.results.ev[old.id] || {}, vals = [];
    TEAMS.forEach(t => (ev[t] || []).forEach((v, k) => { if (v != null) vals.push({ v, k }); }));
    const bad = el.dataset.re === "mode" ? vals.length > 0 : el.dataset.re === "pmax" ? (old.mode === "count" || old.mode === "tier") && vals.some(x => x.v > val) : vals.some(x => x.k >= val);
    if (bad) { flash(`「${old.name || "この項目"}」には結果が入っています。先に「当日」でその結果を消してから変えてください。`); renderSoon(); return; }
  }
  const oldSize = doc.config.teamSize;
  setPath(path, val);
  /* 1チームの人数を変えたら、最大の人数が前の人数のままの種目も合わせる */
  if (path === "config.teamSize" && val !== oldSize) {
    let n = 0;
    doc.config.phases.forEach(ph => (ph.parts || []).forEach(pt => {
      if (pt.mode !== "count" || pt.max !== oldSize) return;
      const ev = doc.results.ev[pt.id] || {};
      if (TEAMS.some(t => (ev[t] || []).some(v => v != null && v > val))) return;
      pt.max = val; n++;
    }));
    if (n) flash(`全員参加の種目${n}つの「最大の人数」も${val}人に合わせました。卓の人数は上の「確認してください」を見て直してください。`);
  }
  const rk = rKeyOf(path);
  if (rk) markR(rk); else markC();
  /* 先着：一方に点が入ったら、もう一方は0点 */
  if (el.dataset.first && val > 0) { const [pid, k] = el.dataset.first.split("."); const t = path.split(".")[3]; setPath(`results.ev.${pid}.${other(t)}.${k}`, 0); markR(`ev|${pid}|${other(t)}|${k}`); }
  if (el.dataset.re === "kind" || el.dataset.re === "per") adjustTable(getPath(parent), old);
  if (el.dataset.re === "mode") {
    const pt = getPath(parent), mx = pt.max || doc.config.teamSize;
    Object.assign(pt, { max: mx, per: pt.per ?? 1, tiers: pt.tiers && pt.tiers.length ? pt.tiers : [[mx, 5], [Math.ceil(mx * .75), 3], [Math.ceil(mx * .5), 1]], options: pt.options && pt.options.length ? pt.options : [[10, "1位"]] });
  }
  /* 文字や数字の欄は描き直さない（打っている途中・Tabで次の欄へ移るときにカーソルが消えないように） */
  const needRender = el.tagName === "SELECT" || !!el.dataset.re || (final && (path.startsWith("results.") || ["list", "pairs", "num"].includes(el.dataset.type) || path.endsWith(".name") || path.startsWith("config.teams")));
  changed(false);
  if (needRender) renderSoon();
}
/* 描き直しは少し後で。Tabで次の欄に移ってから描き直し、その欄にカーソルを戻す */
let renderTimer2 = null;
function renderSoon() { clearTimeout(renderTimer2); renderTimer2 = setTimeout(() => renderPanel(), 0); }
let localSeq = 0, saveWarned = 0;
/* この端末に保存。できなかったら黙らずに知らせる（容量がいっぱい・プライベートモードなど） */
function saveLocal() {
  try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); return true; }
  catch (_) { if (Date.now() - saveWarned > 20000) { saveWarned = Date.now(); flash("この端末に保存できませんでした。「データ・共有」の書き出しで内容を控えてください。"); } return false; }
}
function changed(rerender) {
  localSeq++;
  const lastU = undoStack[undoStack.length - 1]; if (lastU && lastU.at == null) lastU.at = latestStamp();
  saveLocal();
  normalize(); renderBoard(); renderStage();
  if (rerender) renderPanel();
  pushSoon();
}
/* 「元に戻す」：消した卓・種目・アイテムは、その物だけを元の場所に戻す（ほかの入力は消さない）。
   大会まるごとの置きかえ（白紙・見本・読み込み・結果を消す）は、そのあとに入力や変更がなかったときだけ戻せる */
let undoStack = [], undoTimer = null;
const latestStamp = () => Math.max(doc.cts, doc.tts, ...Object.values(doc.rts), 0);
function pushUndo(msg, apply, whole) {
  undoStack.push({ msg, apply, whole, at: null }); /* at は操作を反映した直後（changed）に決める */ if (undoStack.length > 10) undoStack.shift();
  const u = $("undo"); $("undoMsg").textContent = msg; u.hidden = false;
  clearTimeout(undoTimer); undoTimer = setTimeout(() => { u.hidden = true; }, 30000);
}
function wholeUndo(msg) {
  const keep = JSON.parse(JSON.stringify({ config: doc.config, results: doc.results }));
  pushUndo(msg, () => { const before = doc.results; doc.config = sanitizeConfig(keep.config); doc.results = sanitizeResults(keep.results); markAllR(before); markAllR(doc.results); }, true);
}
const findPhase = id => doc.config.phases.find(p => p.id === id);
/* 危ない操作は2回押しで実行（1回目はボタンの文字が変わる） */
function sure(b, label) {
  if (b.dataset.sure) return true;
  b.dataset.sure = "1"; const orig = b.textContent; b.textContent = label || "本当に実行する（もう一度押す）"; b.classList.add("danger");
  setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = orig; } }, 4000);
  return false;
}

document.addEventListener("change", e => { const el = e.target; if (el.dataset && el.dataset.bind) onBind(el, true); });
/* 打っている途中は反映しない欄：設定の数字（空欄の瞬間に0や1として扱わないため）・人数や種類・リスト */
const commitOnly = el => el.tagName === "SELECT" || el.dataset.re || ["list", "pairs"].includes(el.dataset.type) || (el.dataset.type === "num" && el.dataset.bind.startsWith("config."));
document.addEventListener("input", e => { const el = e.target; if (el.dataset && el.dataset.bind && !commitOnly(el)) onBind(el, false); });

/* ---------- 操作 ---------- */
function newPid() { const id = uid("p"); openP[id] = true; return id; }
function findTable(id) { for (const ph of doc.config.phases) for (const tb of (ph.tables || [])) if (tb.id === id) return tb; return null; }
document.addEventListener("toggle", e => { const d = e.target; if (!d.dataset) return; if (d.dataset.pid) openP[d.dataset.pid] = d.open; if (d.dataset.tid) openTb[d.dataset.tid] = d.open; }, true);
/* 「…」のメニューは、外を押したら閉じる */
document.addEventListener("click", e => { document.querySelectorAll("details.more[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; }); }, true);
/* 結果だけを戻す「元に戻す」（設定の変更として扱わない） */
function resultUndo(msg, keys) {
  const before = keys.map(k => [k, JSON.parse(JSON.stringify(rGet(doc.results, k) ?? null))]);
  pushUndo(msg, () => { before.forEach(([k, v]) => { rSet(doc.results, k, v === null && !k.startsWith("ev|") ? undefined : v); markR(k); }); return "r"; });
}
const timerUndo = msg => { const keep = { ...doc.timer }; pushUndo(msg, () => { Object.assign(doc.timer, keep); markT(); fl = {}; return "r"; }); };
function newTable(kind, ph) {
  const left = Math.max(1, doc.config.teamSize - (ph.tables || []).reduce((a, tb) => a + (Number(tb.perTeam) || 0), 0));
  const per = kind === "duel" ? 1 : kind === "team" ? 2 : Math.min(left, 3);
  return { id: uid("t"), game: "", kind, perTeam: per, points: kind === "indiv" ? presetFor(per * 2) : [], win: 6, draw: 3, item: "", host: "" };
}
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; try { localStorage.setItem(LS_TAB, tab); } catch (_) {} renderTabs(); renderPanel(); window.scrollTo({ top: 0 }); return; }
  const a = b.dataset.act; if (!a) return;
  if (readOnly && !RO_OK.has(a)) { flash(RO_MSG); return; }
  const c = doc.config, i = Number(b.dataset.i), j = Number(b.dataset.j);
  switch (a) {
    case "load-sample": case "new-blank": {
      if (!sure(b, a === "load-sample" ? "今の内容を消して見本を読み込む" : "今の内容を消して白紙にする")) break;
      wholeUndo(a === "load-sample" ? "見本を読み込みました" : "白紙にしました");
      const before = doc.results; doc.config = a === "load-sample" ? sampleConfig() : blankConfig(); doc.results = blankResults(); markC(); markAllR(before); changed(true); break;
    }
    case "undo": {
      const u = undoStack.pop(); $("undo").hidden = true; if (!u) break;
      if (u.whole && latestStamp() > u.at) { undoStack = []; flash("このあとに入力や変更があったため、元に戻せません。"); break; }
      const res = u.apply();
      if (res === false) { flash("元の場所が見つからないため、元に戻せませんでした。"); break; }
      if (res !== "r") markC(); changed(true); flash(`元に戻しました（${u.msg}）`);
      if (undoStack.length) { const n = undoStack[undoStack.length - 1]; $("undoMsg").textContent = n.msg; $("undo").hidden = false; }
      break;
    }
    case "add-item": { const no = Math.max(0, ...c.items.map(x => x.no || 0)) + 1; c.items.push({ id: uid("i"), no, name: "アイテム" + no, desc: "" }); markC(); changed(true); break; }
    case "del-item": {
      const it = c.items[i], refs = [], games = []; c.phases.forEach(ph => (ph.tables || []).forEach(tb => { if (tb.item === it.id) { tb.item = ""; refs.push(tb.id); games.push(tb.game || "デュエル卓"); } }));
      if (games.length) setTimeout(() => flash(`「${games.join("」「")}」でもらえるアイテムが空になりました。準備で選び直してください。`), 0);
      c.items.splice(i, 1);
      pushUndo(`アイテム「${it.name}」を消しました`, () => { doc.config.items.splice(Math.min(i, doc.config.items.length), 0, it); refs.forEach(id => { const tb = findTable(id); if (tb) tb.item = it.id; }); });
      markC(); changed(true); break;
    }
    case "add-round": markC(); c.phases.push({ id: newPid(), type: "round", name: "ROUND " + (c.phases.filter(p => p.type === "round").length + 1), time: "", minutes: 60, tables: [] }); changed(true); break;
    case "add-event": markC(); c.phases.push({ id: newPid(), type: "event", name: "全員参加の種目", time: "", minutes: 30, parts: [{ id: uid("e"), name: "項目", mode: "count", reps: 1, max: c.teamSize, per: 1, bonusAt: 0, bonus: 0 }] }); changed(true); break;
    case "move": { const d = Number(b.dataset.d), k = i + d; if (k < 0 || k >= c.phases.length) break; [c.phases[i], c.phases[k]] = [c.phases[k], c.phases[i]]; markC(); changed(true); break; }
    case "del-phase": { const ph = c.phases.splice(i, 1)[0]; pushUndo(`「${ph.name}」を消しました`, () => { doc.config.phases.splice(Math.min(i, doc.config.phases.length), 0, ph); }); markC(); changed(true); break; }
    case "add-table": { const nt = newTable(b.dataset.k, c.phases[i]); openTb[nt.id] = true; c.phases[i].tables.push(nt); } markC(); changed(true); break;
    case "del-table": { const pid = c.phases[i].id, tb = c.phases[i].tables.splice(j, 1)[0]; pushUndo(`「${tb.game || "卓"}」を消しました`, () => { const ph = findPhase(pid); if (!ph) return false; ph.tables.splice(Math.min(j, ph.tables.length), 0, tb); }); markC(); changed(true); break; }
    case "add-part": { const id = uid("e"); openTb[id] = true; c.phases[i].parts.push({ id, name: "項目", mode: "count", reps: 1, max: c.teamSize, per: 1, bonusAt: 0, bonus: 0 }); } markC(); changed(true); break;
    case "del-part": { const pid = c.phases[i].id, pt = c.phases[i].parts.splice(j, 1)[0]; pushUndo(`「${pt.name}」を消しました`, () => { const ph = findPhase(pid); if (!ph) return false; ph.parts.splice(Math.min(j, ph.parts.length), 0, pt); }); markC(); changed(true); break; }
    case "phase": cur = c.phases[i].id; try { localStorage.setItem("vsteams-builder-cur", cur); } catch (_) {} renderPanel(); window.scrollTo({ top: 0 }); break;
    case "toggle-table": { const id = b.dataset.tb, tb = findTable(id); openT[id] = !(openT[id] ?? tableRes(tb).status !== "done"); renderPanel(); break; }
    case "pick": {
      const id = b.dataset.tb, t = b.dataset.t, k = Number(b.dataset.i), tb = findTable(id);
      const ord = doc.results.order[id] = doc.results.order[id] || [];
      const at = ord.findIndex(o => o.t === t && o.i === k);
      if (absentMode[id]) {
        /* 欠席の席を付け外し。順位が付いていた人なら順位も消す */
        const abs = doc.results.absent[id] = absentOf(tb).slice(), ai = abs.findIndex(a => a.t === t && a.i === k);
        if (tb.perTeam < 2) { flash("1対1の卓では欠席を選べません。"); break; }
        if (ai >= 0) abs.splice(ai, 1); else if (abs.length < 1) abs.push({ t, i: k }); else { flash("欠席にできるのは1卓に1人までです。"); break; }
        if (at >= 0) { const gone = ord.splice(at, 1)[0]; if (ord[at] && ord[at].tie) ord[at].tie = at > 0 && gone.tie; fixTies(ord); markR("order|" + id); }
        markR("absent|" + id); changed(true); break;
      }
      if (absentOf(tb).some(a => a.t === t && a.i === k)) { flash("欠席の席です。取り消すときは「欠席がいる」を押してから押してください。"); break; }
      /* 消した人と同着だった次の人は、消した人の立場（前と同着かどうか）を引き継ぐ */
      if (at >= 0) { const gone = ord.splice(at, 1)[0]; if (ord[at] && ord[at].tie) ord[at].tie = at > 0 && gone.tie; fixTies(ord); }
      else if (ord.length < tb.perTeam * 2 - absentOf(tb).length) { const ab = absentOf(tb).length, afterAbs = ab && ord.length === tb.perTeam * 2 - 1 - ab; ord.push({ t, i: k, tie: !!tieNext[id] && ord.length > 0 && !afterAbs }); tieNext[id] = false; }
      openT[id] = true; markR("order|" + id); changed(true); break;
    }
    case "absent-mode": absentMode[b.dataset.tb] = !absentMode[b.dataset.tb]; tieNext[b.dataset.tb] = false; renderPanel(); break;
    case "tie": tieNext[b.dataset.tb] = !tieNext[b.dataset.tb]; renderPanel(); break;
    case "undo-rank": { const ord = doc.results.order[b.dataset.tb] || []; ord.pop(); tieNext[b.dataset.tb] = false; markR("order|" + b.dataset.tb); changed(true); break; }
    case "clear-rank": resultUndo("順位をすべて消しました", ["order|" + b.dataset.tb]); doc.results.order[b.dataset.tb] = []; tieNext[b.dataset.tb] = false; markR("order|" + b.dataset.tb); changed(true); break;
    case "win": { const box = b.dataset.k === "team" ? doc.results.team : doc.results.duel, v = b.dataset.v; if (box[b.dataset.tb] === v) delete box[b.dataset.tb]; else box[b.dataset.tb] = v; openT[b.dataset.tb] = true; markR(b.dataset.k + "|" + b.dataset.tb); changed(true); break; }
    case "num": {
      const { pt, t, k } = b.dataset, v = Number(b.dataset.v), path = `results.ev.${pt}.${t}.${k}`, oPath = `results.ev.${pt}.${other(t)}.${k}`, fk = `${pt}|${k}`;
      const off = getPath(path) === v, ov = getPath(oPath);
      /* 先着：相手チームにもう点が入っているときは、2回押しで上書き（押し間違いで相手の点を消さないように） */
      if (b.dataset.first && !off && v > 0 && ov > 0) { resultUndo(`${tn(other(t))}の${fmt(ov)}点を消しました`, [`ev|${pt}|A|${k}`, `ev|${pt}|B|${k}`]); setTimeout(() => flash(`先着は一方だけなので、${tn(other(t))}の${fmt(ov)}点を消しました（画面下の「元に戻す」で戻せます）`), 0); }
      setPath(path, off ? null : v); markR(`ev|${pt}|${t}|${k}`);
      /* 先着を取り消したら、自動で0点にしたもう一方を、その前の値に戻す */
      if (b.dataset.first && off && v > 0 && ov === 0) { const pv = firstPrev[fk] && firstPrev[fk].t === other(t) ? firstPrev[fk].v : null; setPath(oPath, pv); markR(`ev|${pt}|${other(t)}|${k}`); delete firstPrev[fk]; }
      if (b.dataset.first && v > 0 && !off) { firstPrev[fk] = { t: other(t), v: ov == null ? null : ov }; setPath(oPath, 0); markR(`ev|${pt}|${other(t)}|${k}`); }
      changed(true); break;
    }
    case "st-open": stageOn = true; saveStage(); renderStage(); tick(true); break;
    case "st-close": stageOn = false; saveStage(); try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {} renderStage(); break;
    case "st-hide": stHidden = !stHidden; saveStage(); renderStage(); break;
    case "st-timer": stTimer = !stTimer; saveStage(); renderStage(); break;
    case "use-item": { const k = b.dataset.tb, w = doc.results.duel[k]; if (doc.results.used[k] === w) delete doc.results.used[k]; else if (w) doc.results.used[k] = w; markR("used|" + k); changed(true); break; }
    case "welcome-close": case "welcome-blank":
      try { localStorage.setItem("vsteams-builder-welcome", "1"); } catch (_) {}
      if (a === "welcome-blank") { wholeUndo("白紙にしました"); const before = doc.results; doc.config = blankConfig(); doc.results = blankResults(); markC(); markAllR(before); tab = "setup"; try { localStorage.setItem(LS_TAB, tab); } catch (_) {} changed(true); renderTabs(); }
      else renderPanel();
      break;
    case "st-full": try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) {} break;
    case "copy": {
      const t = totals(), lines = [`${c.name}　${c.teams[0].name} ${fmt(t.A)} − ${fmt(t.B)} ${c.teams[1].name}`, ...c.phases.map(ph => { const r = phaseRes(ph); return `・${ph.name}：${fmt(r.pts.A)} − ${fmt(r.pts.B)}`; })];
      try { await navigator.clipboard.writeText(lines.join("\n")); $("copymsg").textContent = "コピーしました"; } catch (_) { $("copymsg").textContent = lines.join(" ／ "); }
      break;
    }
    case "timer-set": if (doc.timer.end != null || doc.timer.paused != null) timerUndo("タイマーを切りかえました"); tset({ total: Number(b.dataset.min) * 60000, label: b.dataset.label, end: null, paused: null }); fl = {}; renderPanel(); break;
    case "timer-go": {
      unlockAudio(); const now = nowMs(), tm = doc.timer;
      if (tm.end != null) tset({ paused: tm.end - now, end: null });
      else if (tm.paused != null) tset({ end: now + tm.paused, paused: null });
      else { /* 止まっているとき：表示中のROUNDの分数で始める（発表画面のボタンは今の設定のまま） */ const own = b.dataset.label && tm.label !== b.dataset.label, total = own ? Math.max(1, Number(b.dataset.min) || 60) * 60000 : tm.total; tset({ total, label: own ? b.dataset.label : tm.label, end: now + total, paused: null }); fl = {}; renderPanel(); }
      tick(true); break;
    }
    case "timer-reset": { if (doc.timer.end != null || doc.timer.paused != null) timerUndo("タイマーをリセットしました"); tset({ end: null, paused: null }); fl = {}; tick(true); break; }
    case "timer-sound": sound = !sound; if (sound) { unlockAudio(); beep(880, .15, 1); } tick(true); break;
    case "sync-save": {
      const url = ($("syncUrl").value || "").trim(), id = ($("syncId").value || "").trim().replace(/[^\w-]/g, ""), key = ($("syncKey").value || "").trim();
      if (!url || !id) { flash("URLと大会IDの両方を入れてください。"); break; }
      if (!okSyncUrl(url)) { flash("URLは https://script.google.com/ で始まる、Apps Script のウェブアプリのURLを入れてください。"); break; }
      saveSync({ url, id, key }); startJoin(); renderPanel(); startSync(true); break;
    }
    case "join-yes": { const pj = pendingJoin; pendingJoin = null; if (!pj) break; try { localStorage.setItem("vsteams-builder-welcome", "1"); } catch (_) {} saveSync(pj); startJoin(); renderPanel(); startSync(true); break; }
    case "join-no": pendingJoin = null; renderPanel(); break;
    case "restore-backup": { let bk = null; try { bk = localStorage.getItem("vsteams-builder-backup"); } catch (_) {} if (bk && $("dataBox")) { $("dataBox").value = JSON.stringify(JSON.parse(bk), null, 1); flash("参加前の内容を下の欄に出しました。必要なら「上の内容を読み込む」で戻せます（共有中の大会も置きかわります）。"); } break; }
    case "sync-off": saveSync({}); setReadOnly(false); stopSync(); renderPanel(); break;
    case "copy-share": try { await navigator.clipboard.writeText($("shareLink").value); flash("リンクをコピーしました"); } catch (_) { $("shareLink").select(); } break;
    case "reset-results": { if (!sure(b, "本当に消す（もう一度押す）")) break; wholeUndo("結果を消しました"); const before = doc.results; doc.results = blankResults(); markAllR(before); changed(true); break; }
    case "copy-data": try { await navigator.clipboard.writeText($("dataBox").value); flash("コピーしました"); } catch (_) { $("dataBox").select(); } break;
    case "import": case "import-config": {
      try {
        const d = JSON.parse($("dataBox").value); if (!d.config || !Array.isArray(d.config.phases)) throw 0;
        /* 先に形をそろえて確かめる（読めなかったら、今の内容には手を付けない） */
        const nc = sanitizeConfig(d.config), nr = a === "import" ? sanitizeResults(d.results) : blankResults();
        normalize({ config: nc, results: nr });
        JSON.stringify({ config: nc, results: nr });
        if (!sure(b, "今の内容を置きかえて読み込む")) break;
        wholeUndo("読み込みました"); const before = doc.results;
        doc.config = nc; doc.results = nr; markC(); markAllR(before); markAllR(doc.results); changed(true); flash("読み込みました");
      }
      catch (_) { flash("読み込めませんでした。書き出した文字をそのまま貼ってください。"); }
      break;
    }
  }
});

/* ---------- タイマー ---------- */
let sound = false, fl = {}, prevRem = null, actx = null, alertTimer = null;
function tset(p) { Object.assign(doc.timer, p); markT(); changed(false); }
/* 共有中は共有先の時計に合わせた「今」を使う */
const nowMs = () => Date.now() + clockOffset;
const remOf = now => doc.timer.end != null ? doc.timer.end - now : (doc.timer.paused != null ? doc.timer.paused : doc.timer.total);
const mmss = ms => { const neg = ms < 0; ms = Math.abs(ms); let s = Math.floor(ms / 1000); if (!neg && ms % 1000) s++; return (neg ? "+" : "") + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
function unlockAudio() { try { if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } if (actx && actx.state === "suspended") actx.resume(); } catch (_) {} }
function beep(f = 880, d = .25, n = 3) { if (!actx) return; try { for (let i = 0; i < n; i++) { const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * (d + .12); o.frequency.value = f; o.type = "square"; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + .02); } } catch (_) {} }
function flash(msg, f, n) { const a = $("alert"); a.textContent = msg; a.hidden = false; clearTimeout(alertTimer); alertTimer = setTimeout(() => { a.hidden = true; }, 15000); if (sound && f) beep(f, .25, n || 3); }
$("alert").addEventListener("click", () => { $("alert").hidden = true; });
function tick() {
  const now = nowMs(), tm = doc.timer, rem = remOf(now), running = tm.end != null, L = tm.label ? tm.label + "　" : "";
  if (running && prevRem != null) {
    if (!fl.f15 && tm.total > 15 * 60000 && prevRem > 15 * 60000 && rem <= 15 * 60000) { fl.f15 = 1; flash(L + "残り15分です", 988, 2); }
    if (!fl.f5 && tm.total > 5 * 60000 && prevRem > 5 * 60000 && rem <= 5 * 60000) { fl.f5 = 1; flash(L + "残り5分です", 988, 3); }
    if (!fl.f0 && prevRem > 0 && rem <= 0) { fl.f0 = 1; flash(L + "時間です！", 523, 5); }
  }
  prevRem = running ? rem : null;
  const lv = rem <= 5 * 60000 ? "last" : rem <= 15 * 60000 ? "warn" : "";
  const pct = tm.total ? Math.min(100, Math.max(0, (1 - rem / tm.total) * 100)) : 0;
  const endLocal = new Date((tm.end || 0) - clockOffset);
  const endTxt = running ? (rem > 0 ? `${endLocal.getHours()}:${String(endLocal.getMinutes()).padStart(2, "0")} に終了` : "時間切れ") : (tm.paused != null ? "一時停止中" : "スタートを押すと始まります");
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

/* ---------- 共有（Google Apps Script） ----------
 * 共有先には「版番号（rev）」つきで大会データを1つ置く。
 * 送るときは、最後に読んだ版番号を添える。ほかの端末が先に保存していたら（版が違ったら）断られるので、
 * 共有先の内容と手元の内容を欄ごとに比べて新しい方を残し（mergeDocs）、もう一度送る。
 */
function syncConf() { try { return JSON.parse(localStorage.getItem(LS_SYNC) || "{}"); } catch (_) { return {}; } }
function saveSync(s) { try { localStorage.setItem(LS_SYNC, JSON.stringify(s)); } catch (_) {} }
/* 見るだけの端末：入力できなくして、次に読み込んだときに共有先の内容に合わせる */
function setReadOnly(v) { if (readOnly === v) return; readOnly = v; document.body.classList.toggle("ro", v); if (doc) { renderPanel(); renderStage(); } }
let pollTimer = null, pushTimer = null, pushing = false, syncRev = null, joining = false, joinAt = 0, pendingRender = false, pendingJoin = null, readOnly = false, clockOffset = 0;
/* 共有を始めるとき：共有先に大会があればそちらを読み込む。ただし、始めてから手元で入力したものは混ぜて残す */
function startJoin() { joining = true; joinAt = latestStamp(); syncRev = null; }
function backupLocal() { try { localStorage.setItem("vsteams-builder-backup", JSON.stringify({ config: doc.config, results: doc.results })); } catch (_) {} }
/* 共有先の時計との差（タイマーを端末の時計のずれに左右されないようにする） */
function noteClock(j, t0, t1) { if (typeof j.now === "number") clockOffset = j.now - (t0 + t1) / 2; }
function syncStat(t, bad) { const el = $("syncStat"); el.textContent = t; el.style.color = bad ? "#ff9b90" : ""; }
function stopSync() { clearInterval(pollTimer); pollTimer = null; syncRev = null; syncStat("この端末に保存"); }
const rGet = (R, key) => { const k = key.split("|"); if (k[0] === "ev") return ((R.ev[k[1]] || {})[k[2]] || [])[Number(k[3])]; return (R[k[0]] || {})[k[1]]; };
function rSet(R, key, v) {
  const k = key.split("|");
  if (!okRKey(key)) return;
  if (k[0] === "ev") { R.ev[k[1]] = R.ev[k[1]] || { A: [], B: [] }; R.ev[k[1]][k[2]] = R.ev[k[1]][k[2]] || []; R.ev[k[1]][k[2]][Number(k[3])] = v == null ? null : v; return; }
  if (!R[k[0]]) return;
  if (v === undefined) delete R[k[0]][k[1]]; else R[k[0]][k[1]] = JSON.parse(JSON.stringify(v));
}
/* 欄ごとに新しい方を残す。設定・タイマーはまとめて新しい方 */
function mergeDocs(local, remote) {
  const out = JSON.parse(JSON.stringify(local));
  if (remote.cts > local.cts) { out.config = remote.config; out.cts = remote.cts; }
  if (remote.tts > local.tts) { out.timer = remote.timer; out.tts = remote.tts; }
  Object.keys(remote.rts).forEach(k => { if (remote.rts[k] > (local.rts[k] || 0)) { rSet(out.results, k, rGet(remote.results, k)); out.rts[k] = remote.rts[k]; } });
  return out;
}
const hasNewer = (a, b) => a.cts > b.cts || a.tts > b.tts || Object.keys(a.rts).some(k => a.rts[k] > (b.rts[k] || 0));
const seenTimes = d => { maxSeen = Math.max(maxSeen, d.cts, d.tts, ...Object.values(d.rts), 0); };
const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.dataset.bind); };
function adopt(next) {
  doc = next; normalize();
  saveLocal();
  renderBoard(); renderStage();
  if (typing()) pendingRender = true; else { renderTabs(); renderPanel(); }
}
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; renderPanel(); } }, 0));
async function pull() {
  const s = syncConf(); if (!s.url || !s.id) return;
  try {
    const t0 = Date.now(), r = await fetch(`${s.url}?id=${encodeURIComponent(s.id)}&t=${t0}`);
    const j = await r.json(); noteClock(j, t0, Date.now());
    if (!j.ok) throw new Error(j.error || "error");
    const label = readOnly ? `共有中・見るだけ（${s.id}）` : `共有中（${s.id}）`;
    if (!j.doc) { joining = false; syncRev = j.rev || 0; pushSoon(); syncStat(label); return; }
    if (j.rev === syncRev && !joining) { syncStat(label); return; }
    const remote = sanitizeDoc(typeof j.doc === "string" ? JSON.parse(j.doc) : j.doc);
    seenTimes(remote);
    syncRev = j.rev;
    if (readOnly) {
      /* 見るだけの端末は、手元の内容を混ぜずに共有先の内容に合わせる */
      if (joining) { joining = false; backupLocal(); }
      adopt(remote);
    }
    else if (joining) {
      joining = false;
      if (latestStamp() > joinAt) { const merged = mergeDocs(doc, remote); adopt(merged); if (hasNewer(merged, remote)) pushSoon(); }
      else { backupLocal(); adopt(remote); flash("共有中の大会を読み込みました（この端末の前の内容は「データ・共有」から出せます）"); }
    }
    else { const merged = mergeDocs(doc, remote); adopt(merged); if (hasNewer(merged, remote)) pushSoon(); }
    syncStat(label);
  } catch (err) { syncStat("共有先につながりません", true); }
}
function pushSoon() { if (!syncConf().url) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 400); }
async function push(tries = 0) {
  const s = syncConf(); if (!s.url || !s.id || joining || readOnly) return;
  if (pushing) { pushSoon(); return; }
  pushing = true; const seq = localSeq;
  try {
    const t0 = Date.now(), r = await fetch(s.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ id: s.id, key: s.key || "", base: syncRev, doc: JSON.stringify(doc) }) });
    const j = await r.json(); noteClock(j, t0, Date.now());
    if (j.error === "key") { setReadOnly(true); syncRev = null; pushing = false; syncStat(`共有中・見るだけ（${s.id}）`, true); flash("合言葉が違うか入っていないため、この端末の入力は共有されません。"); return; }
    if (j.conflict) {
      /* ほかの端末が先に保存していた：混ぜてから送り直す */
      const remote = sanitizeDoc(typeof j.doc === "string" ? JSON.parse(j.doc) : j.doc);
      seenTimes(remote); syncRev = j.rev; adopt(mergeDocs(doc, remote));
      pushing = false; if (tries < 5) return push(tries + 1); throw new Error("busy");
    }
    if (!j.ok) throw new Error(j.error || "error");
    syncRev = j.rev; syncStat(`共有中（${s.id}）`);
    if (localSeq !== seq) pushSoon();
  } catch (_) { syncStat("保存できませんでした（もう一度送ります）", true); setTimeout(pushSoon, 3000); }
  pushing = false;
}
function startSync(first) { const s = syncConf(); if (!s.url || !s.id) return; setReadOnly(!s.key); clearInterval(pollTimer); pollTimer = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 3000); if (first) pull(); }

/* 共有リンク（?e=大会ID&s=URL）で開いたとき */
/* 確認なしには参加しない（細工したリンクで手元の内容を置きかえられないように） */
(() => {
  const q = new URLSearchParams(location.search), id = (q.get("e") || "").replace(/[^\w-]/g, ""), url = q.get("s") || "", key = q.get("k") || "";
  if (q.has("e")) history.replaceState(null, "", location.pathname);
  if (!id || !okSyncUrl(url)) return;
  const cur = syncConf();
  if (cur.id === id && cur.url === url) { if (key && cur.key !== key) saveSync({ ...cur, key }); return; }
  pendingJoin = { id, url, key }; tab = "data";
})();
/* 同じブラウザのほかのタブで保存されたら、欄ごとに混ぜて取り込む */
window.addEventListener("storage", e => {
  if (e.key !== LS_DOC || !e.newValue) return;
  try { const other = sanitizeDoc(JSON.parse(e.newValue)); seenTimes(other); if (hasNewer(other, doc)) adopt(mergeDocs(doc, other)); } catch (_) {}
});

renderAll();
if (startError) flash("保存されていた内容が読めなかったため、見本から始めました（読めなかった内容は控えに残してあります）。");
startSync(true);
})();
