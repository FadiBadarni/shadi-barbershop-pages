// The shop's TV. It draws the board that public.display_board() returns (supabase/migrations/
// 20261107100000_shop_displays.sql in the app's repo): the shop, each barber's earliest free time and
// today's bookings that have not ended. For now it draws sample data; linking a screen and reading
// the shop's real board come next.
//
// Order, never minutes: a cut runs a few minutes early or late, so the board shows whose appointment
// it is by the schedule and the time each client booked, and never counts down.
//
// Written for TV browsers, which can be years old: no optional chaining, no newer syntax.
(function () {
  'use strict';

  var MINUTE = 60 * 1000;

  var COPY = {
    nowLabel: 'موعده الآن',
    nobodyNow: 'لا موعد الآن',
    next: 'التالي',
    noMore: 'لا مواعيد أخرى اليوم',
    more: function (n) { return 'و' + n + ' آخرون'; },
    freeNow: 'متاح الآن',
    freeAt: 'أقرب موعد',
    noFree: 'لا مواعيد متاحة اليوم',
    updated: 'آخر تحديث',
    creditMade: 'تطبيق الحجز وهذه الشاشة من تطوير',
    creditName: 'برايم سيستمز',
    creditLine: 'نبني المواقع والتطبيقات التي يقوم عليها عملك',
    creditSite: 'prime-systems.co.il'
  };

  // The board, the server's clock minus this screen's (screen clocks drift), and when it was read.
  var board = null;
  var offset = 0;
  var readAt = 0;

  // What the last drawing showed: each barber's appointment now, and each client's place in line.
  var shownNow = null;
  var shownPlace = null;

  // The page's lasting parts, built once (and the columns once per set of barbers), so the pole and
  // the credits strip keep moving instead of starting over at every drawing.
  var ui = null;

  function now() {
    return Date.now() + offset;
  }

  // ---------------------------------------------------------------------------------------------
  // Times, in the shop's time zone, 24-hour, Western digits
  // ---------------------------------------------------------------------------------------------

  var formats = {};

  function format(kind, timeZone) {
    var key = kind + '|' + timeZone;
    if (!formats[key]) {
      if (kind === 'time') {
        formats[key] = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      } else if (kind === 'weekday') {
        formats[key] = new Intl.DateTimeFormat('ar', { timeZone: timeZone, weekday: 'long' });
      } else {
        formats[key] = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, day: 'numeric', month: 'numeric' });
      }
    }
    return formats[key];
  }

  function time(ms) {
    return format('time', board.shop.time_zone).format(new Date(ms));
  }

  // «السبت 7/11»: day/month, as the app writes dates.
  function day(ms) {
    var date = new Date(ms);
    var parts = {};
    format('date', board.shop.time_zone).formatToParts(date).forEach(function (p) {
      parts[p.type] = String(Number(p.value));
    });
    return format('weekday', board.shop.time_zone).format(date) + ' ' + parts.day + '/' + parts.month;
  }

  // ---------------------------------------------------------------------------------------------
  // The page's lasting parts
  // ---------------------------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function image(src, className) {
    var node = el('img', className);
    node.src = src;
    node.alt = '';
    return node;
  }

  function build() {
    var root = document.getElementById('board');
    root.textContent = '';

    var top = el('header', 'top');
    var brand = el('div', 'brand');
    brand.appendChild(image('shop-mark.png'));
    var shop = el('h1', 'shop');
    brand.appendChild(shop);
    top.appendChild(brand);
    var when = el('div', 'when');
    var stale = el('span', 'stale num');
    var dayNode = el('span', 'day num');
    var clock = el('span', 'clock num');
    when.appendChild(stale);
    when.appendChild(dayNode);
    when.appendChild(clock);
    top.appendChild(when);
    root.appendChild(top);

    var cols = el('div', 'cols');
    root.appendChild(cols);

    var band = el('footer', 'credits');
    var track = el('div', 'credits-track');
    band.appendChild(track);
    root.appendChild(band);

    ui = {
      shop: shop, stale: stale, day: dayNode, clock: clock, cols: cols, band: band, track: track,
      pole: pole(), columns: {}, barbers: null
    };
    fillCredits();
  }

  function pole() {
    var node = el('div', 'pole');
    // The shop's mark crowns it: the engraved bearded man from the app, in the middle of the top.
    node.appendChild(image('skull.png', 'pole-crown'));
    node.appendChild(el('div', 'pole-cap'));
    var glass = el('div', 'pole-glass');
    glass.appendChild(el('div', 'pole-bands'));
    node.appendChild(glass);
    node.appendChild(el('div', 'pole-cap'));
    return node;
  }

  // One column per barber, the pole standing after the first half of them: between the two when
  // there are two.
  function layColumns() {
    var key = board.barbers.map(function (b) { return b.id; }).join('|');
    if (key === ui.barbers) return;
    ui.barbers = key;
    ui.cols.textContent = '';
    ui.columns = {};
    var poleAfter = Math.ceil(board.barbers.length / 2) - 1;
    board.barbers.forEach(function (barber, i) {
      var col = el('section', 'col');
      ui.columns[barber.id] = col;
      ui.cols.appendChild(col);
      if (i === poleAfter) ui.cols.appendChild(ui.pole);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // The credits strip: the same line over and over, drifting right as an Arabic news ticker does
  // ---------------------------------------------------------------------------------------------

  function credit() {
    var item = el('span', 'credit');
    item.appendChild(image('prime-logo.svg'));
    item.appendChild(el('span', '', COPY.creditMade));
    item.appendChild(el('strong', '', COPY.creditName));
    item.appendChild(el('span', 'sep', '·'));
    item.appendChild(el('span', '', COPY.creditLine));
    item.appendChild(el('span', 'sep', '·'));
    item.appendChild(el('span', 'site', COPY.creditSite));
    return item;
  }

  // Two identical halves, each at least as wide as the screen; the strip slides by one half and
  // starts over, so the seam never shows.
  function fillCredits() {
    var track = ui.track;
    track.textContent = '';
    track.style.animation = 'none';
    var first = credit();
    track.appendChild(first);
    var width = first.offsetWidth || 1;
    var copies = Math.max(1, Math.ceil(ui.band.clientWidth / width));
    var i;
    for (i = 1; i < copies * 2; i += 1) track.appendChild(credit());
    var pixelsPerSecond = window.innerHeight * 0.07;
    track.style.animation = 'credits ' + (width * copies / pixelsPerSecond) + 's linear infinite';
  }

  // ---------------------------------------------------------------------------------------------
  // Each barber
  // ---------------------------------------------------------------------------------------------

  function byStart(a, b) {
    return Date.parse(a.starts_at) - Date.parse(b.starts_at);
  }

  function keyOf(b) {
    return b.barber_id + '|' + b.starts_at;
  }

  // The first name, and the rest; «عبد» and «أبو» stay with the word after.
  function splitName(name) {
    var words = String(name).trim().split(/\s+/);
    var take = words.length > 1 && /^(عبد|أبو|ابو)$/.test(words[0]) ? 2 : 1;
    return { first: words.slice(0, take).join(' '), rest: words.slice(take).join(' ') };
  }

  function freeLine(barber, t) {
    var free = barber.next_free ? Date.parse(barber.next_free) : null;
    if (free === null) return el('span', 'free', COPY.noFree);
    if (free <= t) return el('span', 'free open', COPY.freeNow);
    var line = el('span', 'free', COPY.freeAt + ' ');
    line.appendChild(el('span', 'num', time(free)));
    return line;
  }

  function fillColumn(col, barber, t, nowShown, placeShown) {
    var mine = board.bookings.filter(function (b) {
      return b.barber_id === barber.id && Date.parse(b.ends_at) > t;
    }).sort(byStart);
    var current = null;
    var waiting = [];
    mine.forEach(function (b) {
      if (Date.parse(b.starts_at) <= t) current = b;
      else waiting.push(b);
    });

    col.textContent = '';

    var head = el('div', 'barber');
    head.appendChild(el('h2', 'barber-name', barber.name));
    head.appendChild(freeLine(barber, t));
    col.appendChild(head);

    // Whose appointment it is now. Rises into place when the schedule moves on to someone new.
    var nowKey = current ? keyOf(current) : '';
    nowShown[barber.id] = nowKey;
    var moved = shownNow && current && shownNow[barber.id] !== nowKey;
    var nowRow = el('div', moved ? 'now arrive' : 'now');
    nowRow.appendChild(el('span', 'now-label', COPY.nowLabel));
    nowRow.appendChild(current ? el('span', 'now-name', current.name) : el('span', 'now-name quiet', COPY.nobodyNow));
    col.appendChild(nowRow);

    // The line: the next client as a poster, then each place a step smaller. A client who moved up
    // a place since the last drawing rises into it.
    var line = el('ol', 'line');
    waiting.forEach(function (b, i) {
      var place = i + 1;
      var key = keyOf(b);
      placeShown[key] = place;
      var stepped = shownPlace && shownPlace[key] && shownPlace[key] > place ? ' advance' : '';
      var booked = time(Date.parse(b.starts_at));
      var row;
      if (place === 1) {
        var name = splitName(b.name);
        row = el('li', 'poster' + stepped);
        var posterHead = el('div', 'poster-head');
        posterHead.appendChild(el('span', 'poster-tag', COPY.next));
        posterHead.appendChild(el('span', 'poster-time num', booked));
        row.appendChild(posterHead);
        row.appendChild(el('div', 'poster-first', name.first));
        if (name.rest) row.appendChild(el('div', 'poster-rest', name.rest));
      } else {
        row = el('li', 'place place-' + Math.min(place, 5) + stepped);
        row.appendChild(el('span', 'place-no num', String(place)));
        row.appendChild(el('span', 'place-name', b.name));
        row.appendChild(el('span', 'place-time num', booked));
      }
      line.appendChild(row);
    });
    if (!waiting.length) line.appendChild(el('li', 'done', COPY.noMore));
    col.appendChild(line);

    return Boolean(current || waiting.length || barber.next_free);
  }

  // Long names shrink, down to a little over half size, before they are cut.
  function shrink(node) {
    var size = parseFloat(window.getComputedStyle(node).fontSize);
    var least = size * 0.55;
    while (node.scrollWidth > node.clientWidth && size > least) {
      size -= 1;
      node.style.fontSize = size + 'px';
    }
  }

  // Drop the last places that do not fit, and count them instead.
  function fit(line) {
    var hidden = 0;
    var more = null;
    while (line.scrollHeight > line.clientHeight + 1) {
      var rows = line.querySelectorAll('.place');
      if (!rows.length) break;
      line.removeChild(rows[rows.length - 1]);
      hidden += 1;
      if (!more) {
        more = el('li', 'more');
        line.appendChild(more);
      }
      more.textContent = COPY.more(hidden);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------

  function draw() {
    if (!board) return;
    if (!ui) build();
    var t = now();

    var count = board.barbers.length;
    document.documentElement.style.setProperty('--k', count <= 2 ? '1' : count === 3 ? '0.8' : '0.66');

    ui.shop.textContent = board.shop.name;
    ui.day.textContent = day(t);
    ui.clock.textContent = time(t);
    // A board more than three minutes old says so, rather than pass old news off as current.
    ui.stale.textContent = t - readAt > 3 * MINUTE ? COPY.updated + ' ' + time(readAt) : '';

    layColumns();
    var nowShown = {};
    var placeShown = {};
    var open = false;
    board.barbers.forEach(function (barber) {
      if (fillColumn(ui.columns[barber.id], barber, t, nowShown, placeShown)) open = true;
    });
    shownNow = nowShown;
    shownPlace = placeShown;

    // The pole turns while anyone still has an appointment or a free time today.
    ui.pole.className = open ? 'pole' : 'pole still';

    Array.prototype.forEach.call(ui.cols.querySelectorAll('.now-name, .poster-first, .poster-rest, .place-name'), shrink);
    Array.prototype.forEach.call(ui.cols.querySelectorAll('.line'), fit);
  }

  // ---------------------------------------------------------------------------------------------
  // Sample data, laid on the 20-minute grid around the time the page opened
  // ---------------------------------------------------------------------------------------------

  var sampleStart = Math.floor(Date.now() / (20 * MINUTE)) * 20 * MINUTE;

  function sampleBoard() {
    function at(k) { return new Date(sampleStart + k * 20 * MINUTE).toISOString(); }
    function booking(barber, k, name) {
      return { barber_id: barber, starts_at: at(k), ends_at: at(k + 1), name: name };
    }
    return {
      now: new Date().toISOString(),
      shop: { name: 'محلقة شادي', time_zone: 'Asia/Jerusalem' },
      barbers: [
        { id: 'shadi', name: 'شادي', next_free: at(9) },
        { id: 'amir', name: 'أمير', next_free: at(0) }
      ],
      bookings: [
        booking('shadi', 0, 'محمد خطيب'),
        booking('shadi', 1, 'يوسف حداد'),
        booking('shadi', 2, 'كريم منصور'),
        booking('shadi', 3, 'عبد الرحمن عودة'),
        booking('shadi', 4, 'باسل نصار'),
        booking('shadi', 5, 'علي حسن'),
        booking('shadi', 6, 'عمر سليمان'),
        booking('shadi', 7, 'طارق عيسى'),
        booking('shadi', 8, 'رامي خوري'),
        booking('amir', 2, 'أحمد زعبي'),
        booking('amir', 4, 'وسيم شحادة'),
        booking('amir', 5, 'نزار عمري')
      ]
    };
  }

  function show(next) {
    board = next;
    offset = Date.parse(next.now) - Date.now();
    readAt = now();
    draw();
  }

  // ---------------------------------------------------------------------------------------------
  // The screen: awake, full screen on OK, redrawn every few seconds
  // ---------------------------------------------------------------------------------------------

  function keepAwake() {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').catch(function () {});
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') keepAwake();
  });

  function fullScreen() {
    var page = document.documentElement;
    if (!document.fullscreenElement && page.requestFullscreen) page.requestFullscreen().catch(function () {});
  }

  document.addEventListener('click', fullScreen);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') fullScreen();
  });

  function relayout() {
    if (ui) fillCredits();
    draw();
  }

  window.addEventListener('resize', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

  show(sampleBoard());
  keepAwake();
  setInterval(draw, 10 * 1000);
  setInterval(function () { show(sampleBoard()); }, 60 * 1000);
})();
