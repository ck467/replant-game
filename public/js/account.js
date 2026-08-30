// Anonymous accounts: a name plus a random crop-portrait avatar,
// remembered in localStorage so a returning player keeps their identity.

const ACCOUNT_KEY = 'replant_account_v1';

function loadAccount() {
  try {
    const acc = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    if (acc && acc.name && Number.isInteger(acc.avatar)) return acc;
  } catch (e) { /* fresh player */ }
  return null;
}

function saveAccount(acc) {
  try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc)); } catch (e) {}
}

function clearAccount() {
  try { localStorage.removeItem(ACCOUNT_KEY); } catch (e) {}
}

function randomAvatar() {
  return Math.floor(Math.random() * CONFIG.AVATAR_COUNT);
}

// The crop sheet's portrait tiles live in columns 0 and 6 of its 10 rows
function avatarPos(i) {
  const col = i < 10 ? 0 : 6;
  const row = i % 10;
  const x = (col / (CONFIG.CROP_SHEET.cols - 1)) * 100;
  const y = (row / (CONFIG.CROP_SHEET.rows - 1)) * 100;
  return `${x.toFixed(4)}% ${y.toFixed(4)}%`;
}

function paintAvatar(el, i) {
  el.style.backgroundPosition = avatarPos(i);
}
