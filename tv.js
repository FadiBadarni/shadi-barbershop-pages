// The shop's TV. It draws the board that public.display_board() returns (supabase/migrations/
// 20261107100000_shop_displays.sql in the app's repo): the shop, each barber's earliest free time and
// today's bookings that have not ended. For now it draws sample data; linking a screen and reading
// the shop's real board come next.
//
// Written for TV browsers, which can be years old: no optional chaining, no newer syntax.
(function () {
  'use strict';

  var COPY = {
    now: 'الآن',
    until: 'حتى',
    chairEmpty: 'الكرسي فارغ',
    next: 'التالي',
    nobodyWaiting: 'لا أحد في الانتظار',
    freeNow: 'متاح الآن',
    freeAt: 'أقرب موعد',
    noFree: 'لا مواعيد متاحة اليوم',
    more: function (n) { return 'و' + n + ' آخرون'; },
    updated: 'آخر تحديث'
  };

  // The board, the server's clock minus this screen's (screen clocks drift), and when it was read.
  var board = null;
  var offset = 0;
  var readAt = 0;
  var drawnKey = '';

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
  // Drawing
  // ---------------------------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function byStart(a, b) {
    return Date.parse(a.starts_at) - Date.parse(b.starts_at);
  }

  function freeLine(barber, t) {
    var free = barber.next_free ? Date.parse(barber.next_free) : null;
    if (free === null) return el('div', 'free', COPY.noFree);
    if (free <= t) return el('div', 'free open', COPY.freeNow);
    var line = el('div', 'free', COPY.freeAt + ' ');
    line.appendChild(el('span', 'num', time(free)));
    return line;
  }

  function column(barber, t) {
    var mine = board.bookings.filter(function (b) {
      return b.barber_id === barber.id && Date.parse(b.ends_at) > t;
    }).sort(byStart);
    var current = null;
    var upcoming = [];
    mine.forEach(function (b) {
      if (Date.parse(b.starts_at) <= t) current = b;
      else upcoming.push(b);
    });

    var col = el('section', 'col');

    var head = el('div', 'barber');
    head.appendChild(el('h2', 'barber-name', barber.name));
    head.appendChild(freeLine(barber, t));
    col.appendChild(head);

    var chair = el('div', 'chair');
    chair.appendChild(el('span', 'chair-label', COPY.now));
    if (current) {
      chair.appendChild(el('span', 'chair-name', current.name));
      chair.appendChild(el('span', 'chair-until num', COPY.until + ' ' + time(Date.parse(current.ends_at))));
    } else {
      chair.appendChild(el('span', 'chair-name quiet', COPY.chairEmpty));
    }
    col.appendChild(chair);

    var next = upcoming[0];
    var nextBox = el('div', next ? 'next' : 'next none');
    var nextHead = el('div', 'next-head');
    nextHead.appendChild(el('span', 'next-tag', COPY.next));
    if (next) nextHead.appendChild(el('span', 'next-time num', time(Date.parse(next.starts_at))));
    nextBox.appendChild(nextHead);
    nextBox.appendChild(el('div', 'next-name', next ? next.name : COPY.nobodyWaiting));
    col.appendChild(nextBox);

    var later = el('ol', 'later');
    upcoming.slice(1).forEach(function (b) {
      var row = el('li');
      row.appendChild(el('span', 'later-time num', time(Date.parse(b.starts_at))));
      row.appendChild(el('span', 'later-name', b.name));
      later.appendChild(row);
    });
    col.appendChild(later);

    return col;
  }

  // Drop the last rows that do not fit, and count them instead.
  function fit(later) {
    var hidden = 0;
    var more = null;
    while (later.scrollHeight > later.clientHeight + 1) {
      var rows = later.querySelectorAll('li:not(.more)');
      if (!rows.length) break;
      later.removeChild(rows[rows.length - 1]);
      hidden += 1;
      if (!more) {
        more = el('li', 'more');
        later.appendChild(more);
      }
      more.textContent = COPY.more(hidden);
    }
  }

  function draw(force) {
    if (!board) return;
    var t = now();
    var key = time(t) + '|' + readAt + '|' + window.innerWidth + 'x' + window.innerHeight;
    if (!force && key === drawnKey) return;
    drawnKey = key;

    var count = board.barbers.length;
    document.documentElement.style.setProperty('--k', count <= 2 ? '1' : count === 3 ? '0.82' : '0.7');

    var root = document.getElementById('board');
    root.textContent = '';

    var top = el('header', 'top');
    top.appendChild(el('h1', 'shop', board.shop.name));
    var when = el('div', 'when');
    when.appendChild(el('span', 'day num', day(t)));
    when.appendChild(el('span', 'clock num', time(t)));
    top.appendChild(when);
    root.appendChild(top);

    var cols = el('div', 'cols');
    board.barbers.forEach(function (barber) {
      cols.appendChild(column(barber, t));
    });
    root.appendChild(cols);

    // A board more than three minutes old says so, rather than pass old news off as current.
    if (t - readAt > 3 * 60 * 1000) {
      root.appendChild(el('div', 'stale num', COPY.updated + ' ' + time(readAt)));
    }

    Array.prototype.forEach.call(root.querySelectorAll('.later'), fit);
  }

  // ---------------------------------------------------------------------------------------------
  // Sample data, laid on the 20-minute grid around the current time
  // ---------------------------------------------------------------------------------------------

  function sampleBoard() {
    var slot = 20 * 60 * 1000;
    var start = Math.floor(Date.now() / slot) * slot;
    function at(k) { return new Date(start + k * slot).toISOString(); }
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
        booking('shadi', 3, 'سامي عودة'),
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
    readAt = Date.now();
    offset = Date.parse(next.now) - readAt;
    readAt += offset;
    draw(true);
  }

  // ---------------------------------------------------------------------------------------------
  // The screen: awake, full screen on OK, redrawn as the minute turns
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

  window.addEventListener('resize', function () { draw(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(true); });

  show(sampleBoard());
  keepAwake();
  setInterval(function () { draw(false); }, 1000);
})();
