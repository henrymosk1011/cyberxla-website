// cyberx.la/proposal/?k=TOKEN: one page renders every quote from cyberxLA.
//
// The quote comes from the database by its link token (public.proposal_view,
// which only answers for quotes that were sent). Accepting and requesting
// changes go through the quote-public Edge Function, protected by Turnstile.
// The admin dashboard shows this same page in its preview (?preview=1) and
// sends the draft over postMessage; only admin.cyberx.la may do that.
//
// totals() below is a copy of totals() in cyberxla-admin
// supabase/functions/_shared/proposal.ts. Keep the two in step: the server
// recomputes every total and refuses an acceptance that doesn't match.
(function () {
  'use strict';

  var API = 'https://onpdkqzcgnoepwiqcgtv.supabase.co';
  var KEY = 'sb_publishable_lKWjP561VJoxmAebZAIidA_lPYiNck3';
  var FN = API + '/functions/v1/quote-public';
  var TURNSTILE_KEY = '0x4AAAAAAFO5CkJ0fDH8vdiE';
  var CONTACT = 'henry@cyberx.la';
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var ADMIN_ORIGINS = ['https://admin.cyberx.la'];

  var params = new URLSearchParams(location.search);
  var token = params.get('k') || '';
  var previewMode = params.get('preview') === '1';
  var countView = location.hash !== '#nocount';

  var app = document.getElementById('app');
  var model = null;
  var sel = { tier: null, addons: [] };
  var CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
  var INFO = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><path d="M10 6.2v.1"/></svg>';
  var DOC = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z"/><path d="M11.5 2.5V6H15"/><path d="M8 10h5M8 13h5"/></svg>';
  var TICK = '<svg class="tick" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8.5 14.5 15.5 6"/></svg>';

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(c) {
    var neg = c < 0, a = Math.abs(Math.round(c));
    var rest = a % 100;
    return (neg ? '−' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + (rest ? '.' + (rest < 10 ? '0' : '') + rest : '');
  }
  function dollars(n) { return money(Math.round(Number(n) * 100)); }
  function longDate(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
    if (!m) return '';
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function dateOf(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }); }

  // ---------------------------------------------------------------------------
  // Totals (a copy of _shared/proposal.ts, in cents)
  // ---------------------------------------------------------------------------
  function cents(n) { return Math.round(Number(n) * 100); }
  function discountCents(base, d) {
    if (!d || base <= 0) return 0;
    var off = d.kind === 'percent' ? Math.round(base * Math.min(100, Math.max(0, d.value)) / 100) : cents(d.value);
    return Math.max(0, Math.min(base, off));
  }
  function addonState(a, tier) { return (a.tiers && a.tiers[tier]) || 'available'; }
  function totals(doc, tierKey, addonKeys) {
    var tier = find(doc.tiers, tierKey) || find(doc.tiers, doc.default_tier) || doc.tiers[0];
    var picked = doc.addons.filter(function (a) { return addonState(a, tier.key) === 'available' && addonKeys.indexOf(a.key) > -1; });
    var lines = [];
    function push(l) { l.net = l.price; lines.push(l); }
    var tl = cents(tier.price);
    // A monthly tier (monthly price, no one time price) has no $0 one time line. Same as tierBilling in proposal.ts.
    var monthlyOnly = tier.monthly !== null && tier.monthly > 0 && tl === 0;
    if (!monthlyOnly) push({ key: tier.key, name: doc.tiers.length > 1 ? tier.name + ' tier' : tier.name, billing: 'once', list: tl, price: tl - discountCents(tl, tier.discount), kind: 'tier' });
    if (tier.monthly !== null && tier.monthly > 0) {
      var ml = cents(tier.monthly);
      push({ key: tier.key + ':monthly', name: tier.name + ', monthly', billing: 'monthly', list: ml, price: ml - discountCents(ml, tier.monthly_discount), kind: 'tier' });
    }
    picked.forEach(function (a) {
      var al = cents(a.price);
      push({ key: a.key, name: a.name, billing: a.billing, list: al, price: al - discountCents(al, a.discount), kind: 'addon' });
    });
    function sum(b, f) { return lines.filter(function (l) { return l.billing === b; }).reduce(function (s, l) { return s + l[f]; }, 0); }
    var onceList = sum('once', 'list'), onceSub = sum('once', 'price'), moList = sum('monthly', 'list'), moSub = sum('monthly', 'price');
    var w = doc.discount;
    var dOnce = w && w.applies_to === 'once' ? discountCents(onceSub, w) : 0;
    var dMo = w && w.applies_to === 'monthly' ? discountCents(moSub, w) : 0;
    [['once', dOnce], ['monthly', dMo]].forEach(function (p) {
      var left = p[1];
      lines.forEach(function (l) {
        if (l.billing !== p[0] || left <= 0) return;
        var take = Math.min(l.net, left);
        l.net -= take; left -= take;
      });
    });
    var onceTotal = onceSub - dOnce, moTotal = moSub - dMo, pay = doc.payment;
    var due = pay.mode === 'full' ? onceTotal
      : pay.mode === 'deposit' ? (pay.deposit_kind === 'percent' ? Math.round(onceTotal * Math.min(100, pay.deposit_value) / 100) : Math.min(onceTotal, cents(pay.deposit_value)))
      : 0;
    return {
      tier: tier.key, addons: picked.map(function (a) { return a.key; }), lines: lines,
      once_list: onceList, once_subtotal: onceSub, monthly_list: moList, monthly_subtotal: moSub,
      discount_once: dOnce, discount_monthly: dMo, once_total: onceTotal, monthly_total: moTotal,
      savings_once: onceList - onceTotal, savings_monthly: moList - moTotal, due_now: due
    };
  }
  function find(list, key) { for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i]; return null; }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------
  /** A price, with the regular price struck through above it when it's discounted. */
  function priceHtml(list, price, suffix, cls) {
    var now = money(price) + (suffix ? ' <small>' + suffix + '</small>' : '');
    if (price >= list) return '<span class="' + cls + '">' + now + '</span>';
    return '<span class="was"><span class="sr-only">Regular price </span><del>' + money(list) + '</del><span class="save">Save ' + money(list - price) + '</span></span>' +
      '<span class="' + cls + '"><span class="sr-only">Now </span>' + now + '</span>';
  }
  function inlinePrice(list, price, prefix) {
    if (price >= list) return (prefix || '') + money(price);
    return '<span class="sr-only">Regular price </span><del>' + money(list) + '</del> <span class="sr-only">now </span>' + (prefix || '') + money(price);
  }
  function tierPrices(t) {
    var once = cents(t.price), onceNow = once - discountCents(once, t.discount);
    var mo = t.monthly ? cents(t.monthly) : 0, moNow = mo - discountCents(mo, t.monthly_discount);
    return { once: once, onceNow: onceNow, mo: mo, moNow: moNow, monthlyOnly: mo > 0 && once === 0 };
  }
  // A tier's price: per month for a monthly tier, one time (plus monthly) otherwise.
  function tierPriceHtml(p) {
    if (p.monthlyOnly) return priceHtml(p.mo, p.moNow, 'per month', 't-price');
    return priceHtml(p.once, p.onceNow, 'one time', 't-price') + (p.mo ? '<span class="t-mo">plus ' + inlinePrice(p.mo, p.moNow) + ' per month</span>' : '');
  }
  function addonPrice(a) { var l = cents(a.price); return { list: l, now: l - discountCents(l, a.discount) }; }
  function chipTitle(title) {
    var t = String(title || '').trim();
    var i = t.lastIndexOf(' ');
    var last = i > -1 ? t.slice(i + 1) : t, head = i > -1 ? t.slice(0, i + 1) : '';
    if (!/[.!?]$/.test(last)) last += '.';
    return esc(head) + '<span class="chip">' + esc(last) + '</span>';
  }
  function visibleNotes(doc, t) {
    var included = doc.addons.filter(function (a) { return addonState(a, t.tier) === 'included'; }).map(function (a) { return a.key; });
    return doc.fine_print.filter(function (n) {
      if (n.tiers.length && n.tiers.indexOf(t.tier) === -1) return false;
      return !n.addon || t.addons.indexOf(n.addon) > -1 || included.indexOf(n.addon) > -1;
    });
  }
  function payState(m) {
    if (m.preview) return m.payments;
    return m.payments;
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------
  function setTitle(t) { document.title = t + ' | cyberxLA'; }

  function showMessage(title, body, extra) {
    setTitle(title);
    app.innerHTML = '<section class="intro msg"><div class="wrap"><h1 tabindex="-1">' + esc(title) + '</h1>' + body + (extra || '') + '</div></section>';
    $('h1', app).focus();
  }
  function showUnavailable(contact) {
    contact = contact || CONTACT;
    showMessage('This quote isn’t available',
      '<p class="lede">The link may have been replaced or turned off. Email <a href="mailto:' + esc(contact) + '">' + esc(contact) + '</a> and we’ll send you a current one.</p>');
  }
  function showExpired(r) {
    var contact = r.contact_email || CONTACT;
    showMessage('This quote has expired',
      '<p class="lede">' + esc(r.number || 'This quote') + (r.title ? ', ' + esc(r.title) + ',' : '') + (r.prepared_for ? ' for ' + esc(r.prepared_for) : '') +
      ' was valid until ' + esc(longDate(r.valid_until)) + '. Prices and availability may have changed, so ask us for an updated quote.</p>',
      '<div class="msg-acts"><button type="button" class="btn btn-lime inline" id="ask-update">Request an updated quote</button>' +
      '<p class="fine2">Or email <a href="mailto:' + esc(contact) + '">' + esc(contact) + '</a>.</p></div>');
    $('#ask-update').addEventListener('click', function () { openChanges(true); });
  }

  function render(m) {
    model = m;
    var doc = m.doc, single = doc.tiers.length === 1, accepted = m.state === 'accepted' && m.accepted;
    if (accepted) { sel.tier = m.accepted.tier; sel.addons = m.accepted.addons.slice(); }
    else if (!sel.tier || !find(doc.tiers, sel.tier)) { sel.tier = doc.default_tier; sel.addons = []; }
    setTitle(m.title + (m.prepared_for ? ' for ' + m.prepared_for : ''));

    var html = '<section class="intro"><div class="wrap">' +
      '<p class="mono mute">Quote ' + esc(m.number) + ' <span aria-hidden="true">&middot;</span> ' + esc(longDate(m.prepared_on)) + '</p>' +
      '<h1 tabindex="-1">' + chipTitle(m.title) + '</h1>' +
      (m.prepared_for ? '<p class="for">Prepared for ' + esc(m.prepared_for) + '</p>' : '') +
      '<p class="valid mute">' + (accepted ? 'Accepted ' + esc(dateOf(m.accepted.at)) : 'Valid until ' + esc(longDate(m.valid_until))) + '</p>' +
      (doc.intro && !accepted ? '<p class="lede no-print">' + esc(doc.intro) + '</p>' : '') +
      '</div></section>';

    html += '<div class="wrap" id="banners">' + banners(m) + '</div>';
    html += '<div class="wrap layout"><div>';

    if (single) {
      html += included(doc, doc.tiers[0]);
    } else {
      html += '<section class="block" aria-labelledby="tiers-h"><p class="mono mute">' + (accepted ? 'Your tier' : 'Step 1') + '</p><h2 id="tiers-h">' + (accepted ? 'Accepted tier' : 'Choose a tier') + '</h2>' +
        '<fieldset' + (accepted || m.preview_locked ? ' disabled' : '') + '><legend class="sr-only">Choose a tier</legend><div class="tiers" style="--n:' + doc.tiers.length + '">';
      doc.tiers.forEach(function (t) {
        var p = tierPrices(t);
        html += '<label class="tier"><input type="radio" name="tier" value="' + esc(t.key) + '"' + (t.key === sel.tier ? ' checked' : '') + '>' +
          '<span class="t-name">' + esc(t.name) + (doc.recommended === t.key ? ' <span class="badge">Recommended</span>' : '') + '</span>' +
          tierPriceHtml(p) +
          (t.summary ? '<span class="t-sum">' + esc(t.summary) + '</span>' : '') +
          '<span class="t-pick no-print"><span class="dot" aria-hidden="true"></span><span class="off">Select</span><span class="on">Selected</span></span></label>';
      });
      html += '</div></fieldset></section>';
      if (doc.rows.length) html += compare(doc);
    }
    html += addonsBlock(doc, single, accepted);
    html += '</div>' + summaryShell(m) + '</div>';

    app.innerHTML = html;
    wire();
    update();
  }

  function banners(m) {
    var out = '';
    if (m.preview) out += '<p class="banner info no-print" role="note"><strong>Preview.</strong> This is how ' + esc(m.number) + ' looks to the client. Buttons work only on the client’s page.</p>';
    if (m.state === 'accepted' && m.accepted) {
      out += '<p class="banner ok" role="status"><strong>Accepted, thank you.</strong> ' + esc(m.accepted.by) + ' accepted this quote on ' + esc(dateOf(m.accepted.at)) + '. We’ll be in touch to schedule the work.</p>';
      if (params.get('paid') === '1') out += '<p class="banner ok" role="status"><strong>Payment received.</strong> Thank you. Stripe is emailing you a receipt.</p>';
    } else if (m.state === 'changes_requested') {
      out += '<p class="banner info" role="note"><strong>Changes requested.</strong> Thanks for your note. We’ll send an updated quote soon. You can still accept this one as it is.</p>';
    }
    return out;
  }

  // A row's explanation, easier to scan. A sentence about a tier (or about one
  // of the row's values, like Standard or Plus) starts its own line, and those
  // names are bold; the general description stays first. Line breaks typed in
  // the editor are kept. Text is escaped piece by piece.
  function explainHtml(text, doc, row) {
    var names = doc.tiers.map(function (t) { return t.name; });
    Object.keys(row.values || {}).forEach(function (k) {
      var v = row.values[k];
      if (typeof v === 'string' && v.trim().length > 1 && v.length <= 40) names.push(v.trim());
    });
    names = names.filter(function (n, i) { return n && names.indexOf(n) === i; }).sort(function (a, b) { return b.length - a.length; });
    var re = names.length ? new RegExp('(^|[^0-9A-Za-z])(' + names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![0-9A-Za-z])', 'g') : null;
    function mentions(s) { if (!re) return false; re.lastIndex = 0; return re.test(s); }
    function bold(s) {
      if (!re) return esc(s);
      var out = '', last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        var at = m.index + m[1].length;
        out += esc(s.slice(last, at)) + '<b>' + esc(m[2]) + '</b>';
        last = at + m[2].length;
        re.lastIndex = last;
      }
      return out + esc(s.slice(last));
    }
    var lines = [];
    String(text || '').split(/\n+/).forEach(function (para) {
      para.trim().replace(/([.;!?])\s+(?=[A-Z0-9\u201C"(])/g, '$1\u0001').split('\u0001').forEach(function (s, i) {
        s = s.trim();
        if (!s) return;
        var tier = mentions(s), prev = lines[lines.length - 1];
        if (prev && i > 0 && !tier) { prev.text += ' ' + s; return; }
        // A clause split off at a semicolon reads as its own sentence.
        if (prev && i > 0) prev.text = prev.text.replace(/;$/, '.');
        lines.push({ text: s, tier: tier });
      });
    });
    var h = '', list = false;
    lines.forEach(function (l) {
      if (l.tier !== list) { h += l.tier ? '<ul class="ex-list">' : '</ul>'; list = l.tier; }
      h += l.tier ? '<li>' + bold(l.text) + '</li>' : '<p>' + bold(l.text) + '</p>';
    });
    return h + (list ? '</ul>' : '');
  }

  function cellHtml(v, tierName) {
    var label = '<span class="sr-only">' + esc(tierName) + ': </span>';
    if (v === true) return label + TICK + '<span class="sr-only">Included</span>';
    if (v === false || v === undefined) return label + '<span class="sr-only">Not included</span>';
    return label + esc(v);
  }

  function compare(doc) {
    var n = doc.tiers.length;
    var h = '<section class="block" aria-labelledby="cmp-h"><p class="mono mute">What’s included</p><h2 id="cmp-h">Compare the tiers</h2>' +
      '<div class="cmp-tools no-print"><p class="mute">Tap a service to see what it means.</p><button type="button" class="linkbtn" id="toggle-all" aria-pressed="false">Show all details</button></div>' +
      '<table class="cmp" id="cmp" style="--n:' + n + '"><caption class="sr-only">Services included in each tier. Each service name is a button that shows its description.</caption>' +
      '<colgroup><col class="c-label">' + new Array(n + 1).join('<col>') + '</colgroup><thead><tr><th scope="col">Service</th>';
    doc.tiers.forEach(function (t) {
      var p = tierPrices(t);
      h += '<th scope="col" data-tier="' + esc(t.key) + '">' + esc(t.name) + '<small>' + (p.monthlyOnly ? inlinePrice(p.mo, p.moNow) + '/mo' : inlinePrice(p.once, p.onceNow)) + '</small></th>';
    });
    h += '</tr></thead><tbody>';
    doc.rows.forEach(function (r, i) {
      var id = 'd' + i;
      h += '<tr class="item"><th scope="row"><button type="button" class="row-btn" aria-expanded="false" aria-controls="' + id + '"' + (r.explain ? '' : ' disabled') + '><span>' + esc(r.label) + '</span>' + (r.explain ? '<span class="chev">' + CHEV + '</span>' : '') + '</button></th>';
      doc.tiers.forEach(function (t) { h += '<td data-tier="' + esc(t.key) + '">' + cellHtml(r.values[t.key], t.name) + '</td>'; });
      h += '</tr><tr class="detail" id="' + id + '" hidden><td colspan="' + (n + 1) + '"><div class="explain">' + explainHtml(r.explain, doc, r) + '</div></td></tr>';
    });
    return h + '</tbody></table></section>';
  }

  function included(doc, t) {
    var rows = doc.rows.filter(function (r) { return r.values[t.key] !== false && r.values[t.key] !== undefined; });
    var p = tierPrices(t);
    var h = '<section class="block" aria-labelledby="inc-h"><p class="mono mute">What’s included</p><h2 id="inc-h">' + esc(t.name) + '</h2>' +
      '<div class="single"><div class="single-price">' + tierPriceHtml(p) + (t.summary ? '<p class="t-sum">' + esc(t.summary) + '</p>' : '') + '</div>';
    if (rows.length) {
      h += '<div class="cmp-tools no-print"><p class="mute">Tap an item to see what it means.</p><button type="button" class="linkbtn" id="toggle-all" aria-pressed="false">Show all details</button></div><ul class="inc-list">';
      rows.forEach(function (r, i) {
        var id = 'd' + i, v = r.values[t.key];
        h += '<li><button type="button" class="row-btn" aria-expanded="false" aria-controls="' + id + '"' + (r.explain ? '' : ' disabled') + '><span class="inc-label">' + TICK + '<span>' + esc(r.label) + (typeof v === 'string' ? ': <span class="inc-val">' + esc(v) + '</span>' : '') + '</span></span>' +
          (r.explain ? '<span class="chev">' + CHEV + '</span>' : '') + '</button><div class="inc-detail explain" id="' + id + '" hidden>' + explainHtml(r.explain, doc, r) + '</div></li>';
      });
      h += '</ul>';
    }
    return h + '</div></section>';
  }

  function addonsBlock(doc, single, accepted) {
    if (!doc.addons.length) return '';
    return '<section class="block" id="addons-block" aria-labelledby="addons-h"><p class="mono mute">' + (accepted ? 'Your add ons' : single ? 'Optional' : 'Step 2') + '</p><h2 id="addons-h">Add ons</h2>' +
      '<p class="addons-note" id="addons-note" hidden></p><fieldset id="addons-set"' + (accepted ? ' disabled' : '') + '><legend class="sr-only">Optional add ons</legend><div class="addons" id="addons"></div></fieldset>' +
      '<div class="addons inc-addons" id="addons-inc"></div></section>';
  }

  function summaryShell(m) {
    var accepted = m.state === 'accepted' && m.accepted;
    return '<aside class="summary" aria-labelledby="sum-h"><h2 id="sum-h">' + (accepted ? 'Accepted selection' : 'Your selection') + '</h2>' +
      '<ul id="sum-lines"></ul><div id="sum-totals"></div><div id="sum-pay"></div><div id="sum-notes"></div>' +
      '<div id="sum-acts" class="no-print"></div>' +
      '<p class="fine">Questions? Email <a href="mailto:' + esc(m.contact_email || CONTACT) + '">' + esc(m.contact_email || CONTACT) + '</a>.</p></aside>';
  }

  // ---------------------------------------------------------------------------
  // Live parts: the add ons for the tier, and the summary
  // ---------------------------------------------------------------------------
  function update() {
    var m = model, doc = m.doc, accepted = m.state === 'accepted' && m.accepted;
    var tier = find(doc.tiers, sel.tier) || doc.tiers[0];
    var cmp = $('#cmp');
    if (cmp) {
      $$('[data-tier]', cmp).forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-tier') === tier.key); });
    }

    // Add ons: checkboxes for the ones you can add, a list of what's already included.
    var set = $('#addons'), incEl = $('#addons-inc');
    if (set) {
      var avail = doc.addons.filter(function (a) { return addonState(a, tier.key) === 'available'; });
      var inc = doc.addons.filter(function (a) { return addonState(a, tier.key) === 'included'; });
      set.innerHTML = avail.map(function (a) {
        var p = addonPrice(a), id = 'ad-' + esc(a.key);
        var on = sel.addons.indexOf(a.key) > -1;
        return '<label class="addon"><input type="checkbox" value="' + esc(a.key) + '" aria-describedby="' + id + '"' + (on ? ' checked' : '') + '>' +
          '<span class="a-name">' + esc(a.name) + '</span><span class="a-price">' + inlinePrice(p.list, p.now, '+') + (a.billing === 'monthly' ? '<small>/mo</small>' : '') + '</span>' +
          '<span class="a-desc" id="' + id + '">' + esc(a.description) + '</span></label>';
      }).join('');
      $('#addons-set').hidden = !avail.length;
      var note = $('#addons-note');
      if (!avail.length && inc.length) {
        note.textContent = inc.length === doc.addons.length ? tier.name + ' already includes every add on.' : tier.name + ' already includes the add ons below.';
        note.hidden = false;
      } else if (!avail.length) {
        note.textContent = 'No add ons are available for ' + tier.name + '.';
        note.hidden = false;
      } else note.hidden = true;
      incEl.innerHTML = inc.length && (avail.length || inc.length < doc.addons.length) ? '<p class="mono mute inc-h">Included in ' + esc(tier.name) + '</p>' + inc.map(function (a) {
        return '<div class="addon done"><span class="a-check">' + TICK + '</span><span class="a-name">' + esc(a.name) + '</span><span class="a-price">Included</span><span class="a-desc">' + esc(a.description) + '</span></div>';
      }).join('') : '';
    }

    var t = totals(doc, tier.key, sel.addons);
    var lines = '';
    t.lines.forEach(function (l) {
      lines += '<li><span>' + esc(l.name) + '</span><span>' + (l.kind === 'addon' ? inlinePrice(l.list, l.price, '+') : inlinePrice(l.list, l.price)) + (l.billing === 'monthly' ? '/mo' : '') + '</span></li>';
    });
    if (doc.discount) {
      var dv = doc.discount.applies_to === 'monthly' ? t.discount_monthly : t.discount_once;
      if (dv > 0) lines += '<li class="disc"><span>' + esc(doc.discount.label || 'Discount') + (doc.discount.kind === 'percent' ? ' (' + esc(doc.discount.value) + '%)' : '') + '</span><span>−' + money(dv) + (doc.discount.applies_to === 'monthly' ? '/mo' : '') + '</span></li>';
    }
    $('#sum-lines').innerHTML = lines;

    var tot = '';
    if (t.once_list > 0 || t.monthly_list === 0) {
      tot += '<div class="total"><span>One time total</span><span class="tv">' + (t.savings_once > 0 ? '<del><span class="sr-only">Regular total </span>' + money(t.once_list) + '</del>' : '') + '<b aria-live="polite" id="sum-total">' + money(t.once_total) + '</b></span></div>';
    }
    if (t.monthly_list > 0) {
      tot += '<div class="total mo"><span>Monthly</span><span class="tv">' + (t.savings_monthly > 0 ? '<del><span class="sr-only">Regular </span>' + money(t.monthly_list) + '</del>' : '') + '<b aria-live="polite">' + money(t.monthly_total) + '<small>/mo</small></b></span></div>';
    }
    if (t.savings_once + t.savings_monthly > 0) {
      tot += '<p class="fine save-line">You save ' + (t.savings_once ? money(t.savings_once) : '') + (t.savings_once && t.savings_monthly ? ' plus ' : '') + (t.savings_monthly ? money(t.savings_monthly) + ' per month' : '') + '.</p>';
    }
    $('#sum-totals').innerHTML = tot;

    $('#sum-pay').innerHTML = payHtml(m, t, accepted);
    var notes = visibleNotes(doc, t).map(function (n) { return '<li>' + INFO + '<span>' + esc(n.text) + '</span></li>'; }).join('');
    if (doc.terms) notes += '<li>' + DOC + '<span>' + (accepted ? 'Accepted under our' : 'Accepting means you agree to our') + ' <a href="/terms/#quotes">Terms and Conditions</a>.</span></li>';
    $('#sum-notes').innerHTML = notes ? '<h3 class="notes-h">Good to know</h3><ul class="notes">' + notes + '</ul>' : '';
    $('#sum-acts').innerHTML = actsHtml(m, accepted);
    wireActs();
  }

  function payHtml(m, t, accepted) {
    var p = m.doc.payment;
    if (accepted) {
      var due = cents(m.accepted.due_now), paid = cents(m.accepted.paid);
      if (due <= 0) return '';
      if (paid >= due) return '<p class="pay paid"><b>' + (p.mode === 'full' ? 'Paid in full' : 'Deposit paid') + ':</b> ' + money(paid) + '. Thank you.</p>';
      return '<p class="pay"><b>' + (p.mode === 'full' ? 'Due now' : 'Deposit due') + ':</b> ' + money(due - paid) + '</p>' +
        (m.payments === 'off' ? '<p class="fine">We’ll send you an invoice.</p>' : '');
    }
    if (p.mode === 'none' || t.due_now <= 0) return '';
    var what = p.mode === 'full' ? 'Due at acceptance' : 'Deposit at acceptance' + (p.deposit_kind === 'percent' ? ' (' + esc(p.deposit_value) + '%)' : '');
    return '<p class="pay"><b>' + what + ':</b> ' + money(t.due_now) + '</p>' +
      '<p class="fine">' + (m.payments === 'off' ? 'We’ll send you an invoice.' : 'You can pay securely by card right after you accept.') + '</p>';
  }

  function actsHtml(m, accepted) {
    var h = '';
    if (accepted) {
      var due = cents(m.accepted.due_now) - cents(m.accepted.paid);
      if (due > 0 && m.payments !== 'off') h += '<button type="button" class="btn btn-lime" id="pay"' + (m.preview ? ' disabled' : '') + '>' + (m.doc.payment.mode === 'full' ? 'Pay now' : 'Pay deposit') + ', ' + money(due) + '</button>';
    } else {
      h += '<button type="button" class="btn btn-lime" id="accept"' + (m.preview ? ' aria-disabled="true"' : '') + '>Accept this quote</button>';
      h += '<button type="button" class="btn btn-line" id="changes"' + (m.preview ? ' aria-disabled="true"' : '') + '>Request changes</button>';
    }
    h += '<button type="button" class="btn btn-line" id="print">Print or save as PDF</button>';
    return h;
  }

  function wire() {
    $$('input[name="tier"]').forEach(function (r) {
      r.addEventListener('change', function () { sel.tier = r.value; update(); });
    });
    var set = $('#addons');
    if (set) set.addEventListener('change', function (e) {
      var k = e.target.value;
      sel.addons = sel.addons.filter(function (x) { return x !== k; });
      if (e.target.checked) sel.addons.push(k);
      update();
    });
    var btns = $$('.row-btn[aria-controls]').filter(function (b) { return !b.disabled; });
    var all = $('#toggle-all');
    function setRow(b, open) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); document.getElementById(b.getAttribute('aria-controls')).hidden = !open; }
    function sync() {
      if (!all) return;
      var every = btns.length && btns.every(function (b) { return b.getAttribute('aria-expanded') === 'true'; });
      all.setAttribute('aria-pressed', every ? 'true' : 'false');
      all.textContent = every ? 'Hide all details' : 'Show all details';
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { setRow(b, b.getAttribute('aria-expanded') !== 'true'); sync(); }); });
    if (all) {
      if (!btns.length) all.hidden = true;
      all.addEventListener('click', function () { var open = all.getAttribute('aria-pressed') !== 'true'; btns.forEach(function (b) { setRow(b, open); }); sync(); });
    }
  }
  function wireActs() {
    var p = $('#print'); if (p) p.addEventListener('click', function () { window.print(); });
    var a = $('#accept'); if (a) a.addEventListener('click', function () { if (!model.preview) openAccept(); });
    var c = $('#changes'); if (c) c.addEventListener('click', function () { if (!model.preview) openChanges(false); });
    var pay = $('#pay'); if (pay) pay.addEventListener('click', function () { startPayment(pay); });
  }

  // ---------------------------------------------------------------------------
  // Turnstile (loaded only when a dialog that needs it opens)
  // ---------------------------------------------------------------------------
  var ts = { loading: null, widgets: {} };
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (ts.loading) return ts.loading;
    ts.loading = new Promise(function (resolve, reject) {
      window.cxTurnstileReady = function () { resolve(); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=cxTurnstileReady';
      s.async = true;
      s.onerror = function () { ts.loading = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    return ts.loading;
  }
  function mountTurnstile(el, action) {
    var state = { token: '' };
    loadTurnstile().then(function () {
      if (ts.widgets[action] !== undefined) { window.turnstile.reset(ts.widgets[action]); }
      else {
        ts.widgets[action] = window.turnstile.render(el, {
          sitekey: TURNSTILE_KEY, action: action, theme: 'auto',
          callback: function (t) { state.token = t; },
          'expired-callback': function () { state.token = ''; },
          'error-callback': function () { state.token = ''; }
        });
      }
    }, function () { state.failed = true; });
    return state;
  }
  function resetTurnstile(action) { if (window.turnstile && ts.widgets[action] !== undefined) window.turnstile.reset(ts.widgets[action]); }

  function post(body) {
    return fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  // ---------------------------------------------------------------------------
  // Accept
  // ---------------------------------------------------------------------------
  var lastFocus = null;
  function openDialog(d) { lastFocus = document.activeElement; d.showModal(); }
  function closeDialog(d) { d.close(); }
  $$('dialog').forEach(function (d) {
    d.addEventListener('close', function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    $$('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { closeDialog(d); }); });
  });

  var acc = $('#accept-dlg'), accForm = $('#accept-form'), accErr = $('#accept-err'), accTs = null;
  function openAccept() {
    var t = totals(model.doc, sel.tier, sel.addons), tier = find(model.doc.tiers, t.tier);
    var rows = t.lines.map(function (l) { return '<li><span>' + esc(l.name) + '</span><span>' + money(l.price) + (l.billing === 'monthly' ? '/mo' : '') + '</span></li>'; }).join('');
    if (t.discount_once) rows += '<li><span>' + esc(model.doc.discount.label || 'Discount') + '</span><span>−' + money(t.discount_once) + '</span></li>';
    if (t.discount_monthly) rows += '<li><span>' + esc(model.doc.discount.label || 'Discount') + '</span><span>−' + money(t.discount_monthly) + '/mo</span></li>';
    if (t.once_list > 0 || t.monthly_list === 0) rows += '<li class="t"><span>One time total</span><span>' + money(t.once_total) + '</span></li>';
    if (t.monthly_list > 0) rows += '<li class="t"><span>Monthly</span><span>' + money(t.monthly_total) + '/mo</span></li>';
    if (t.due_now > 0) rows += '<li><span>' + (model.doc.payment.mode === 'full' ? 'Due at acceptance' : 'Deposit at acceptance') + '</span><span>' + money(t.due_now) + '</span></li>';
    $('#accept-sel').innerHTML = '<p class="mute">' + esc(model.number) + ', ' + esc(model.title) + ': <strong>' + esc(tier.name) + '</strong></p><ul class="confirm">' + rows + '</ul>';
    $('#accept-form-view').hidden = false; $('#accept-done-view').hidden = true;
    acc.setAttribute('aria-labelledby', 'accept-title');
    accErr.hidden = true;
    openDialog(acc);
    accTs = mountTurnstile($('#accept-ts'), 'accept');
    setTimeout(function () { accForm.elements.name.focus(); }, 30);
  }
  function fieldErr(form, errEl, field, msg) {
    if (field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', errEl.id); field.focus(); }
    errEl.textContent = msg; errEl.hidden = false;
  }
  function clearErrs(form) { $$('[aria-invalid="true"]', form).forEach(function (f) { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); }); }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  accForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrs(accForm); accErr.hidden = true;
    var f = accForm.elements;
    if (!f.name.value.trim()) return fieldErr(accForm, accErr, f.name, 'Please add your full name.');
    if (!EMAIL.test(f.email.value.trim())) return fieldErr(accForm, accErr, f.email, 'Please check your email address.');
    if (!f.agree.checked) return fieldErr(accForm, accErr, f.agree, 'Please agree to the Terms and Conditions.');
    if (!f.signature.value.trim()) return fieldErr(accForm, accErr, f.signature, 'Please type your name to sign.');
    if (accTs && accTs.failed) return fieldErr(accForm, accErr, null, 'Our verification service didn’t load. Email ' + (model.contact_email || CONTACT) + ' to accept instead.');
    if (!accTs || !accTs.token) return fieldErr(accForm, accErr, null, 'One moment, we’re still checking you’re not a bot. Try again in a second.');
    var t = totals(model.doc, sel.tier, sel.addons);
    var btn = $('#accept-submit');
    btn.disabled = true; btn.textContent = 'Accepting…';
    post({
      action: 'accept', token: token, version: model.version, turnstileToken: accTs.token, website: f.website.value,
      tier: t.tier, addons: t.addons, expected_once: t.once_total, expected_monthly: t.monthly_total,
      name: f.name.value.trim(), title: f.title.value.trim(), email: f.email.value.trim(), agree: f.agree.checked, signature: f.signature.value.trim()
    }).then(function (res) {
      if (res.status === 200 && res.body.ok) {
        $('#accept-form-view').hidden = true; $('#accept-done-view').hidden = false;
        acc.setAttribute('aria-labelledby', 'accept-done-title');
        var due = res.body.due_now || 0;
        // Only say the confirmation went if the server says it did.
        $('#accept-done-text').textContent = (res.body.emailed ? 'We emailed a confirmation to ' + f.email.value.trim() + '.' : 'We’ll be in touch to schedule the work.') + (due > 0 && !res.body.pay ? ' We’ll send you an invoice for the ' + (model.doc.payment.mode === 'full' ? 'payment' : 'deposit') + ' of ' + money(due) + '.' : '');
        var payBtn = $('#accept-pay');
        payBtn.hidden = !(res.body.pay && due > 0);
        payBtn.textContent = (model.doc.payment.mode === 'full' ? 'Pay now' : 'Pay deposit') + ', ' + money(due);
        $('#accept-done-title').focus();
        accForm.reset();
        load(false);
        return;
      }
      var b = res.body || {};
      if (res.status === 400 && b.field && f[b.field]) return fieldErr(accForm, accErr, f[b.field], 'Please check this field.');
      if (res.status === 409 && b.error === 'changed') return fieldErr(accForm, accErr, null, 'This quote was just updated. Reload the page to see the latest version, then accept it.');
      if (res.status === 409 && b.error === 'total') return fieldErr(accForm, accErr, null, 'The total didn’t match ours. Reload the page and try again.');
      if (res.status === 409 && b.error === 'accepted') return fieldErr(accForm, accErr, null, 'This quote was already accepted. Reload the page to see it.');
      if (res.status === 410) return fieldErr(accForm, accErr, null, 'This quote has expired. Reload the page to request an updated one.');
      if (res.status === 429) return fieldErr(accForm, accErr, null, 'Too many tries from your network. Please wait a bit, or email ' + (model.contact_email || CONTACT) + '.');
      if (res.status === 403) return fieldErr(accForm, accErr, null, 'We couldn’t verify the request. Please try again.');
      fieldErr(accForm, accErr, null, 'Something went wrong on our end. Please try again, or email ' + (model.contact_email || CONTACT) + '.');
    }, function () {
      fieldErr(accForm, accErr, null, 'We couldn’t reach our server. Check your connection and try again.');
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Accept and sign';
      if (accTs) accTs.token = '';
      resetTurnstile('accept');
    });
  });
  $('#accept-pay').addEventListener('click', function (e) { startPayment(e.currentTarget); });

  // ---------------------------------------------------------------------------
  // Request changes (also "Request an updated quote" on an expired one)
  // ---------------------------------------------------------------------------
  var chg = $('#changes-dlg'), chgForm = $('#changes-form'), chgErr = $('#changes-err'), chgTs = null;
  function openChanges(expired) {
    $('#changes-title').textContent = expired ? 'Request an updated quote' : 'Request changes';
    $('#changes-form-view').hidden = false; $('#changes-done-view').hidden = true;
    chg.setAttribute('aria-labelledby', 'changes-title');
    chgErr.hidden = true;
    if (expired && !chgForm.elements.message.value) chgForm.elements.message.value = 'Please send me an updated quote.';
    openDialog(chg);
    chgTs = mountTurnstile($('#changes-ts'), 'changes');
    setTimeout(function () { chgForm.elements.name.focus(); }, 30);
  }
  chgForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrs(chgForm); chgErr.hidden = true;
    var f = chgForm.elements;
    if (!f.name.value.trim()) return fieldErr(chgForm, chgErr, f.name, 'Please add your name.');
    if (!EMAIL.test(f.email.value.trim())) return fieldErr(chgForm, chgErr, f.email, 'Please check your email address.');
    if (!f.message.value.trim()) return fieldErr(chgForm, chgErr, f.message, 'Please tell us what you’d like changed.');
    if (chgTs && chgTs.failed) return fieldErr(chgForm, chgErr, null, 'Our verification service didn’t load. Email ' + CONTACT + ' instead.');
    if (!chgTs || !chgTs.token) return fieldErr(chgForm, chgErr, null, 'One moment, we’re still checking you’re not a bot. Try again in a second.');
    var btn = $('#changes-submit');
    btn.disabled = true; btn.textContent = 'Sending…';
    post({ action: 'changes', token: token, turnstileToken: chgTs.token, website: f.website.value, name: f.name.value.trim(), email: f.email.value.trim(), message: f.message.value.trim() })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          $('#changes-form-view').hidden = true; $('#changes-done-view').hidden = false;
          chg.setAttribute('aria-labelledby', 'changes-done-title');
          $('#changes-done-title').focus();
          chgForm.reset();
          if (model) load(false);
          return;
        }
        var b = res.body || {};
        if (res.status === 400 && b.field && f[b.field]) return fieldErr(chgForm, chgErr, f[b.field], 'Please check this field.');
        if (res.status === 429) return fieldErr(chgForm, chgErr, null, 'Too many messages from your network. Please email ' + CONTACT + '.');
        if (res.status === 403) return fieldErr(chgForm, chgErr, null, 'We couldn’t verify the request. Please try again.');
        fieldErr(chgForm, chgErr, null, 'Something went wrong on our end. Please email ' + CONTACT + '.');
      }, function () { fieldErr(chgForm, chgErr, null, 'We couldn’t reach our server. Check your connection and try again.'); })
      .then(function () {
        btn.disabled = false; btn.textContent = 'Send';
        if (chgTs) chgTs.token = '';
        resetTurnstile('changes');
      });
  });

  // ---------------------------------------------------------------------------
  // Pay (Stripe Checkout, made on the server for the accepted amount)
  // ---------------------------------------------------------------------------
  function startPayment(btn) {
    if (!model || model.preview) return;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    post({ action: 'pay', token: token }).then(function (res) {
      if (res.status === 200 && res.body.url && /^https:\/\/checkout\.stripe\.com\//.test(res.body.url)) { location.href = res.body.url; return; }
      btn.disabled = false; btn.textContent = label;
      var msg = res.body && res.body.error === 'off' ? 'Card payments aren’t available right now. We’ll send you an invoice.' : res.body && res.body.error === 'paid' ? 'This is already paid. Thank you.' : 'We couldn’t open checkout. Please try again, or email ' + CONTACT + '.';
      var p = document.createElement('p'); p.className = 'fine'; p.setAttribute('role', 'alert'); p.textContent = msg;
      btn.parentNode.insertBefore(p, btn.nextSibling);
    }, function () { btn.disabled = false; btn.textContent = label; });
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  function load(first) {
    return fetch(API + '/rest/v1/rpc/proposal_view', {
      method: 'POST',
      headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_count: first && countView })
    }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) return r && r.reason === 'expired' ? showExpired(r) : showUnavailable(r && r.contact_email);
        var keepFocus = !first && document.activeElement && document.activeElement.closest && document.activeElement.closest('dialog');
        render(r);
        if (first) $('h1', app).focus({ preventScroll: true });
        if (first && params.get('pay') === '1' && r.state === 'accepted' && $('#pay')) startPayment($('#pay'));
        return keepFocus;
      })
      .catch(function () {
        if (first) showMessage('We couldn’t load this quote', '<p class="lede">Check your connection and reload the page. If it keeps happening, email <a href="mailto:' + CONTACT + '">' + CONTACT + '</a>.</p>');
      });
  }

  if (previewMode) {
    // The dashboard's preview: wait for the draft from admin.cyberx.la.
    var allowed = ADMIN_ORIGINS.slice();
    if (local) allowed.push(location.origin, 'http://localhost:5173', 'http://127.0.0.1:5173');
    window.addEventListener('message', function (e) {
      if (allowed.indexOf(e.origin) === -1 || !e.data || e.data.type !== 'cyberxla:quote-preview' || !e.data.model) return;
      var keepY = window.scrollY;
      try { render(e.data.model); } catch (err) { showMessage('Preview error', '<p class="lede">' + esc(err.message) + '</p>'); }
      window.scrollTo(0, keepY);
    });
    if (window.parent !== window) allowed.forEach(function (o) { try { window.parent.postMessage({ type: 'cyberxla:quote-ready' }, o); } catch (err) { /* another origin */ } });
    app.innerHTML = '<section class="intro msg"><div class="wrap"><p class="lede">Waiting for the preview…</p></div></section>';
  } else if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    showUnavailable();
  } else {
    load(true);
  }
})();
