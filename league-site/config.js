// VS TEAMS LEAGUE 公開ページの設定
// エントリーが確定したら teams を書き換え、Google スプレッドシートの「結果」タブを
// 「ウェブに公開（CSV）」したURLを csvUrl に入れる。csvUrl が空のあいだはサンプルデータで表示する。
window.LEAGUE = {
  name: "VS TEAMS LEAGUE",
  csvUrl: "",
  points: [5, 1, -1, -3],
  regular: 8,
  final: 2,
  carry: 0.5,
  // 各節の期間（月曜〜日曜）
  rounds: [
    { label: "第1節", start: "2027-01-04" },
    { label: "第2節", start: "2027-01-11" },
    { label: "第3節", start: "2027-01-18" },
    { label: "第4節", start: "2027-01-25" },
    { label: "第5節", start: "2027-02-01" },
    { label: "第6節", start: "2027-02-08" },
    { label: "第7節", start: "2027-02-15" },
    { label: "第8節", start: "2027-02-22" },
    { label: "ファイナル第1節", start: "2027-03-01" },
    { label: "ファイナル第2節", start: "2027-03-08" }
  ],
  // チームとメンバー（表示名は結果報告フォームに書く名前と同じにする）
  teams: [
    { name: "サンプル青", color: "#2546D8", members: ["選手01", "選手02", "選手03", "選手04"] },
    { name: "サンプル赤", color: "#E2402F", members: ["選手05", "選手06", "選手07", "選手08"] },
    { name: "サンプル金", color: "#E0A615", members: ["選手09", "選手10", "選手11", "選手12"] },
    { name: "サンプル緑", color: "#1E8C5A", members: ["選手13", "選手14", "選手15", "選手16"] }
  ],
  sample: true
};
