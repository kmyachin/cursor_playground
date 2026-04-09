/** Визуальный «уровень» копилки / цели по проценту накопления */
export function piggyTierEmoji(pct) {
  var p = Math.min(100, Math.max(0, pct));
  if (p >= 100) return "🏆";
  if (p >= 75) return "⭐";
  if (p >= 50) return "🌳";
  if (p >= 25) return "🌿";
  return "🌱";
}

export function goalMapDotsHtml(pct) {
  var n = 10;
  var p = Math.min(100, Math.max(0, pct));
  var filled = Math.round((p / 100) * n);
  if (p > 0 && filled < 1) filled = 1;
  if (p >= 100) filled = n;
  var html =
    '<div class="goal-map" role="img" aria-label="Прогресс: ' +
    p +
    '%">';
  for (var i = 0; i < n; i++) {
    html +=
      '<span class="goal-map__dot' +
      (i < filled ? " goal-map__dot--on" : "") +
      '"></span>';
  }
  html += "</div>";
  return html;
}

export function goalAlmostThereHtml(g) {
  if (!g.target_amount || g.target_amount <= 0) return "";
  var pct = Math.min(
    100,
    Math.round((g.saved_total / g.target_amount) * 100)
  );
  if (pct >= 100) return "";
  var remainPct = 100 - pct;
  var dl = g.deadline ? String(g.deadline).slice(0, 10) : "";
  var daysLeft = null;
  if (dl) {
    var deadline = new Date(dl);
    var now = new Date();
    if (!isNaN(deadline.getTime())) {
      deadline.setHours(0, 0, 0, 0);
      now.setHours(0, 0, 0, 0);
      daysLeft = Math.ceil((deadline - now) / 86400000);
    }
  }
  if (pct >= 75 || remainPct <= 20) {
    return (
      '<div class="goal-almost goal-almost--hot">Почти у цели: осталось около ' +
      remainPct +
      "%. Так держать!</div>"
    );
  }
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return (
      '<div class="goal-almost">До даты цели ' +
      daysLeft +
      " дн. — уложишься?</div>"
    );
  }
  if (daysLeft !== null && daysLeft < 0) {
    return '<div class="goal-almost goal-almost--soft">Дата цели прошла — накопление можно продолжить.</div>';
  }
  return "";
}
