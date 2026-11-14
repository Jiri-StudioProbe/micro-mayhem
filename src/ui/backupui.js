// The Backup screen: a code to copy or save (your whole profile), and a place to paste or load one and restore it. The words are in history.js
// (describePreview), the format and the merging in src/backup.js; this is the DOM and the order of things. Text only, never markup.
// Restoring replaces the stored profile and then reloads the page, so that every part of the game starts again from what is stored (the level, the tuning,
// the history) instead of this module having to update each of them.
import { encodeBackup, decodeBackup, mergeProfiles, previewImport } from '../backup.js';
import { cleanProfileDoc } from '../profile.js';
import { describePreview, defaultFmtDate } from './history.js';

export function createBackupUi({ doc, router, Profile, now = () => new Date(), reload = () => location.reload(), fmtDate = defaultFmtDate, urlApi = typeof URL !== 'undefined' ? URL : null, clipboard = () => (typeof navigator !== 'undefined' ? navigator.clipboard : null) }) {
  const $ = id => doc.getElementById(id);
  let pending = null, token = 0, replaceArmed = 0;
  const status = (text, kind) => { const e = $('bkStatus'); e.textContent = text; e.className = 'bktext' + (kind ? ' ' + kind : ''); };

  // The code for the profile as it is now.
  async function prepare() {
    const my = ++token; $('bkCode').value = ''; $('bkInfo').textContent = 'Preparing the code…';
    try {
      const code = await encodeBackup(Profile.data);
      if (my !== token) return;
      $('bkCode').value = code;
      $('bkInfo').textContent = Profile.data.races.length + (Profile.data.races.length === 1 ? ' race' : ' races') + ' and your settings, as a code of ' + Math.max(1, Math.round(code.length / 1024)) + ' KB. Keep it somewhere safe.';
    } catch (_) { if (my === token) $('bkInfo').textContent = 'The code could not be made in this browser.'; }
  }

  function clearPreview() { pending = null; replaceArmed = 0; $('bkPreview').hidden = true; $('bkReplace').textContent = 'REPLACE EVERYTHING'; }

  async function check() {
    clearPreview(); status('');
    const res = await decodeBackup($('bkInput').value);
    if (!res.ok) { status(res.error, 'err'); return; }
    const imported = cleanProfileDoc(res.doc);
    if (!imported) { status('The code does not hold a profile.', 'err'); return; }
    pending = imported;
    const d = describePreview(previewImport(Profile.data, imported, Array.isArray(res.doc.races) ? res.doc.races.length : 0), fmtDate);
    $('bkPreviewText').textContent = d.lines.join(' '); $('bkMergeNote').textContent = d.merge; $('bkReplaceNote').textContent = d.replace;
    $('bkPreview').hidden = false; status('The code is good. Choose what to do with it.', 'ok');
  }

  function finish(ok) {
    if (!ok) { status('This browser is not letting the game keep data, so nothing could be restored.', 'err'); return; }
    status('Restored. Starting again with it…', 'ok'); reload();
  }
  function merge() { if (pending) finish(Profile.replace(mergeProfiles(Profile.data, pending))); }
  // REPLACE destroys what is here, so it asks twice: the first tap arms it (and says so), the second, within a few seconds, does it.
  function replace() {
    if (!pending) return;
    if (!replaceArmed) { replaceArmed = 1; $('bkReplace').textContent = 'TAP AGAIN TO REPLACE EVERYTHING'; status('This cannot be undone. Tap again to replace what is on this device.', 'err'); setTimeout(() => { if (replaceArmed === 1) { replaceArmed = 0; $('bkReplace').textContent = 'REPLACE EVERYTHING'; } }, 6000); return; }
    finish(Profile.replace(pending));
  }

  async function copy() {
    const box = $('bkCode'), b = $('bkCopy'), done = text => { b.textContent = text; setTimeout(() => { b.textContent = 'COPY CODE'; }, 1600); };
    box.focus(); box.select();
    const cb = clipboard();
    if (cb && cb.writeText) { try { await cb.writeText(box.value); done('COPIED'); return; } catch (_) { /* fall through: the code is selected, so the player can copy it by hand */ } }
    done('SELECTED: COPY IT');
  }

  function save() {
    if (!urlApi || !$('bkCode').value) return;
    const d = now(), pad = n => String(n).padStart(2, '0');
    const a = doc.createElement('a'), url = urlApi.createObjectURL(new Blob([$('bkCode').value + '\n'], { type: 'text/plain' }));
    a.href = url; a.download = `micro-mayhem-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.txt`;
    doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => urlApi.revokeObjectURL(url), 1000);
  }

  async function load(file) {
    if (!file) return;
    if (file.size > 4000000) { clearPreview(); status('That file is too big to be a backup.', 'err'); return; }
    let text; try { text = await file.text(); } catch (_) { clearPreview(); status('That file could not be read.', 'err'); return; }
    $('bkInput').value = text; await check();
  }

  $('histBackup').addEventListener('click', () => { router.push('backup'); prepare(); });
  $('bkBack').addEventListener('click', () => router.back());
  $('bkCopy').addEventListener('click', copy); $('bkSave').addEventListener('click', save);
  $('bkCheck').addEventListener('click', check);
  $('bkInput').addEventListener('input', () => { clearPreview(); status(''); });   // a preview belongs to the code that was checked, not to what is in the box now
  $('bkPick').addEventListener('click', () => $('bkFile').click());
  $('bkFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; load(f); });
  $('bkMerge').addEventListener('click', merge); $('bkReplace').addEventListener('click', replace);
  router.subscribe(cur => { if (cur !== 'backup' && ($('bkInput').value || pending)) { clearPreview(); $('bkInput').value = ''; status(''); } });   // leaving the screen forgets what was pasted

  return { prepare, check };
}
