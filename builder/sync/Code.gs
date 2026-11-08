/**
 * VS TEAMS 大会ビルダー：複数端末で共有するための保存先（Google Apps Script）
 *
 * 使い方は builder/README.md を参照。
 * 1行に1大会。A列＝大会ID、B列＝版番号（保存するたびに1ずつ増える）、C列以降＝大会のデータ（長いときは分けて入れる）。
 *
 * 保存のしかた：端末は「最後に読んだ版番号」を添えて送る。
 * その間にほかの端末が保存していたら（版番号が違ったら）保存せず、今の内容と版番号を返す。
 * 端末はそれを手元の内容と欄ごとに混ぜてから、もう一度送る。こうして、ほかの端末の入力を上書きで消さない。
 */

// ▼ 書き込み用の合言葉。必ず自分だけの文字に変えてから使う（運営スタッフだけに伝える）。
//   空のままだと、URLを知っている人は誰でも書き込めてしまう。
var WRITE_KEY = '';

var SHEET_NAME = 'data';
var CHUNK = 45000;     // 1つのセルに入れる文字数（セルの上限は5万字）
var MAX_DOC = 2000000; // 1大会のデータの上限（文字数）
var MAX_EVENTS = 200;  // 保存できる大会の数の上限

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 1) return 0;
  var ids = sh.getRange(1, 1, last, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 1;
  return 0;
}

// セルに入れるときは、それぞれの先頭に「|」を付ける。
// 区切った途中が「=」や「'」で始まると、数式や文字の印として扱われて中身が変わってしまうため。
function read_(sh, row) {
  var vals = sh.getRange(row, 1, 1, Math.max(3, sh.getLastColumn())).getValues()[0];
  var parts = vals.slice(2).map(String);
  var marked = parts.length && parts[0].charAt(0) === '|';
  return { rev: Number(vals[1]) || 0, doc: parts.map(function (p) { return marked && p.charAt(0) === '|' ? p.slice(1) : p; }).join('') };
}

function json_(obj) {
  obj.now = Date.now(); // 端末の時計のずれを直すため、こちらの時刻も返す
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cleanId_(id) {
  return String(id || '').replace(/[^\w-]/g, '').slice(0, 64);
}

function doGet(e) {
  var id = cleanId_(e && e.parameter && e.parameter.id);
  if (!id) return json_({ ok: false, error: 'no id' });
  var sh = sheet_(), row = findRow_(sh, id);
  if (!row) return json_({ ok: true, doc: null, rev: 0 });
  var cur = read_(sh, row);
  return json_({ ok: true, doc: cur.doc || null, rev: cur.rev });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse(e.postData.contents);
    if (WRITE_KEY && String(body.key || '') !== WRITE_KEY) return json_({ ok: false, error: 'key' });
    var id = cleanId_(body.id), doc = String(body.doc || '');
    if (!id) return json_({ ok: false, error: 'no id' });
    if (doc.length > MAX_DOC) return json_({ ok: false, error: 'too large' });
    var sh = sheet_(), row = findRow_(sh, id), rev = 0;
    if (row) {
      var cur = read_(sh, row);
      rev = cur.rev;
      if (body.base !== rev) return json_({ ok: false, conflict: true, rev: rev, doc: cur.doc }); // ほかの端末が先に保存していた
      sh.getRange(row, 1, 1, sh.getLastColumn()).clearContent();
    } else {
      if (sh.getLastRow() >= MAX_EVENTS) return json_({ ok: false, error: 'too many events' });
      row = sh.getLastRow() + 1;
    }
    var parts = [];
    for (var i = 0; i < doc.length; i += CHUNK) parts.push('|' + doc.slice(i, i + CHUNK));
    if (!parts.length) parts.push('|');
    sh.getRange(row, 1, 1, 2 + parts.length).setValues([[id, rev + 1].concat(parts)]);
    return json_({ ok: true, rev: rev + 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
