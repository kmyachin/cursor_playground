export function escapeHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export function attrEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
