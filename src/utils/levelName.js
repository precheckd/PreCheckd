// The top skill level is stored as 'Expert' (older data and job requirements use it) but is shown to
// people as 'Master'; a Master result with a perfect Expert exam is shown as 'Grandmaster'.
// Views call levelName(level) or levelName(level, grandmaster). It is also put on `global` so every
// template can use it without each route passing it in.
const NAMES = { Expert: 'Master' };

function levelName(level, grandmaster) {
  if (grandmaster && (level === 'Expert' || level === 'Master')) return 'Grandmaster';
  return NAMES[level] || level;
}

global.levelName = levelName;
module.exports = { levelName };
