export function formatMoney(n) {
  return (
    new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0,
    }).format(n) + " ₽"
  );
}

export function formatDateTime(iso) {
  var d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isToday(iso) {
  var d = new Date(iso);
  var t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}
