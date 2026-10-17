// ID documents print names in ALL CAPS. Tidy a name only when it is entirely
// upper- or lower-case; anything already mixed ("McDonald", "DeShawn") is left alone.
function properName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return s;
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’.])([a-zÀ-ɏ])/g, (m, sep, ch) => sep + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}
module.exports = { properName };
