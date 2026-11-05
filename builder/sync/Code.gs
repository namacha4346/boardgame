/**
 * VS TEAMS 大会ビルダー：複数端末で共有するための保存先（Google Apps Script）
 *
 * 使い方は builder/README.md を参照。
 * 1行に1大会。A列＝大会ID、B列＝保存時刻、C列以降＝大会のデータ（長いときは分けて入れる）。
 */
var SHEET_NAME = 'data';
var CHUNK = 45000; // 1つのセルに入れる文字数（セルの上限は5万字）

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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cleanId_(id) {
  return String(id || '').replace(/[^\w-]/g, '').slice(0, 64);
}

function doGet(e) {
  var id = cleanId_(e && e.parameter && e.parameter.id);
  if (!id) return json_({ ok: false, error: 'no id' });
  var sh = sheet_(), row = findRow_(sh, id);
  if (!row) return json_({ ok: true, doc: null, savedAt: 0 });
  var width = sh.getLastColumn();
  var vals = sh.getRange(row, 1, 1, width).getValues()[0];
  var doc = vals.slice(2).join('');
  return json_({ ok: true, doc: doc || null, savedAt: Number(vals[1]) || 0 });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse(e.postData.contents);
    var id = cleanId_(body.id), savedAt = Number(body.savedAt) || 0, doc = String(body.doc || '');
    if (!id) return json_({ ok: false, error: 'no id' });
    var sh = sheet_(), row = findRow_(sh, id);
    if (row) {
      var cur = Number(sh.getRange(row, 2).getValue()) || 0;
      if (cur >= savedAt) return json_({ ok: true, savedAt: cur, skipped: true }); // 新しい保存があるときは上書きしない
      sh.getRange(row, 1, 1, sh.getLastColumn()).clearContent();
    } else {
      row = sh.getLastRow() + 1;
    }
    var parts = [];
    for (var i = 0; i < doc.length; i += CHUNK) parts.push(doc.slice(i, i + CHUNK));
    if (!parts.length) parts.push('');
    sh.getRange(row, 1, 1, 2 + parts.length).setValues([[id, savedAt].concat(parts)]);
    return json_({ ok: true, savedAt: savedAt });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
