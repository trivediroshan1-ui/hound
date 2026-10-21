// The page behind "Unsubscribe" in Hound's emails. The link carries the
// address and its signature (e and t); the email-unsubscribe function
// checks them and records the choice (0122_email_unsubscribe.sql).
(function () {
  var params = new URLSearchParams(window.location.search);
  var e = params.get('e');
  var t = params.get('t');
  var button = document.getElementById('unsub-button');
  var note = document.getElementById('unsub-note');
  var sub = document.getElementById('unsub-sub');
  var config = window.HOUND_CONFIG || {};

  if (!e || !t || !config.supabaseUrl) {
    button.disabled = true;
    sub.textContent = 'This link is not complete. Use the Unsubscribe link at the bottom of a Hound email.';
    return;
  }

  button.addEventListener('click', function () {
    button.disabled = true;
    note.textContent = 'One moment…';
    fetch(config.supabaseUrl + '/functions/v1/email-unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e: e, t: t }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.ok) {
          sub.textContent = "Done. Hound won't email this address again.";
          button.style.display = 'none';
          note.textContent = '';
        } else {
          note.textContent = (result.body && result.body.error) || 'That didn’t work. Please try again.';
          button.disabled = false;
        }
      })
      .catch(function () {
        note.textContent = 'Couldn’t reach Hound. Check your connection and try again.';
        button.disabled = false;
      });
  });
})();
