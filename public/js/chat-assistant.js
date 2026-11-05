// Shared front end for the PreCheckd assistant: the panel on /ask and the pop-out widget.
// Usage: PreCheckdChat.init({ root: element, persist: true|false })
// The root holds .chat-body, .chat-chips (optional), form.chat-input-row with .chat-input and .chat-send.
(function () {
  var LINKS = /(hello@precheckd\.com|\/(?:skills-explained|privacy|terms|safety|candidate-signup|recruiter-landing|jobs|ask)\b)/g;
  var STORE_KEY = 'precheckd-chat-v1';

  function newId() { return 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

  function load() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      var s = raw && JSON.parse(raw);
      if (s && typeof s.convId === 'string' && Array.isArray(s.log)) return s;
    } catch (e) { /* storage blocked: start fresh */ }
    return null;
  }
  function save(state) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function init(opts) {
    var root = opts.root;
    if (!root) return;
    var body = root.querySelector('.chat-body');
    var form = root.querySelector('.chat-input-row');
    var input = root.querySelector('.chat-input');
    var send = root.querySelector('.chat-send');
    var chips = root.querySelector('.chat-chips');
    var state = (opts.persist && load()) || { convId: newId(), log: [] };
    var busy = false;

    function addBubble(text, who, remember) {
      var el = document.createElement('div');
      el.className = 'bubble ' + (who === 'user' ? 'bubble-user' : 'bubble-bot');
      if (who === 'user') {
        el.textContent = text;
      } else {
        text.split(LINKS).forEach(function (part, i) {
          if (i % 2 === 1) {
            var a = document.createElement('a');
            a.textContent = part;
            a.href = part.indexOf('@') > -1 ? 'mailto:' + part : part;
            el.appendChild(a);
          } else if (part) {
            el.appendChild(document.createTextNode(part));
          }
        });
      }
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      if (remember) { state.log.push({ who: who, text: text }); if (opts.persist) save(state); }
      return el;
    }

    function history() {
      return state.log.map(function (m) { return { role: m.who === 'user' ? 'user' : 'assistant', content: m.text }; });
    }

    // Bring back an earlier conversation when the visitor moves to another page.
    if (state.log.length) {
      if (chips) { chips.remove(); chips = null; }
      state.log.forEach(function (m) { addBubble(m.text, m.who, false); });
    }

    function ask(question) {
      question = (question || '').trim();
      if (!question || busy) return;
      busy = true;
      send.disabled = true;
      if (chips) { chips.remove(); chips = null; }
      addBubble(question, 'user', true);
      var sent = history().slice(-11);
      input.value = '';
      var typing = addBubble('Typing...', 'bot', false);
      typing.classList.add('bubble-typing');

      fetch('/api/ask-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: state.convId, messages: sent })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, reply: j.reply }; });
      }).catch(function () {
        return { ok: false, reply: null };
      }).then(function (res) {
        typing.remove();
        var reply = res.reply || "Sorry, something went wrong. Please try again, or email hello@precheckd.com.";
        if (res.ok) {
          addBubble(reply, 'bot', true);
        } else {
          // A failed turn is not kept, so the next question is not sent with it.
          addBubble(reply, 'bot', false);
          state.log.pop();
          if (opts.persist) save(state);
        }
        busy = false;
        send.disabled = false;
        input.focus();
      });
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
    if (chips) {
      chips.querySelectorAll('.chip').forEach(function (c) {
        c.addEventListener('click', function () { ask(c.textContent); });
      });
    }
    return { ask: ask, focus: function () { input.focus(); } };
  }

  window.PreCheckdChat = { init: init };
})();
