// The shop's TV. It draws the board that public.display_board() returns (supabase/migrations/
// 20261107100000_shop_displays.sql in the app's repo): the shop, each barber's earliest free time and
// today's bookings that have not ended. For now it draws sample data; linking a screen and reading
// the shop's real board come next.
//
// Each barber is a lane: the chair on the right, and a track running off to the left on which every
// client sits as far from the chair as they are minutes away. The track's right edge is now.
//
// Written for TV browsers, which can be years old: no optional chaining, no newer syntax.
(function () {
  'use strict';

  // How far ahead the track looks, in minutes.
  var WINDOW_MINUTES = 100;
  var TICK_MINUTES = 20;
  var MINUTE = 60 * 1000;

  var COPY = {
    inChair: 'على الكرسي',
    chairEmpty: 'الكرسي فارغ',
    until: 'حتى',
    freeNow: 'متاح الآن',
    freeAt: 'أقرب موعد',
    noFree: 'لا مواعيد متاحة اليوم',
    nobodyWaiting: 'لا أحد في الانتظار',
    startsNow: 'الآن',
    inMinutes: function (n) { return 'بعد ' + minutesAr(n); },
    later: function (n) { return 'و' + n + ' آخرون لاحقًا'; },
    updated: 'آخر تحديث',
    maker: 'برايم سيستمز',
    makerLine: 'نبني المواقع والتطبيقات التي يقوم عليها عملك',
    makerSite: 'prime-systems.co.il'
  };

  // As the app counts minutes (private.minutes_ar): دقيقة, دقيقتين, 3–10 دقائق, 11 and up دقيقة.
  function minutesAr(n) {
    if (n === 1) return 'دقيقة';
    if (n === 2) return 'دقيقتين';
    if (n >= 3 && n <= 10) return n + ' دقائق';
    return n + ' دقيقة';
  }

  // The board, the server's clock minus this screen's (screen clocks drift), when it was read, and
  // who sat in each chair at the last drawing.
  var board = null;
  var offset = 0;
  var readAt = 0;
  var seated = null;

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

  // The first name on its own line, the rest under it; «عبد» and «أبو» stay with the word after.
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

  // A block on the track, placed later by place(): from its start to its end, in minutes from now.
  function block(className, startMs, endMs) {
    var node = el('div', 'block ' + className);
    node.setAttribute('data-start', String(startMs));
    node.setAttribute('data-end', String(endMs));
    return node;
  }

  function lane(barber, t, arrivals) {
    var mine = board.bookings.filter(function (b) {
      return b.barber_id === barber.id && Date.parse(b.ends_at) > t;
    }).sort(byStart);
    var current = null;
    var upcoming = [];
    mine.forEach(function (b) {
      if (Date.parse(b.starts_at) <= t) current = b;
      else upcoming.push(b);
    });

    var row = el('section', 'lane');

    // The chair.
    var chair = el('div', 'chair');
    chair.appendChild(el('h2', 'barber-name', barber.name));
    var status = el('div', 'status');
    status.appendChild(freeLine(barber, t));
    chair.appendChild(status);

    var seatKey = current ? current.starts_at + '|' + current.name : '';
    var seat = el('div', arrivals && seated && seated[barber.id] !== seatKey && current ? 'seat arrive' : 'seat');
    arrivals[barber.id] = seatKey;
    if (current) {
      seat.appendChild(el('div', 'seat-label', COPY.inChair));
      seat.appendChild(el('div', 'seat-name', current.name));
      seat.appendChild(el('div', 'seat-until num', COPY.until + ' ' + time(Date.parse(current.ends_at))));
    } else {
      seat.appendChild(el('div', 'seat-name quiet', COPY.chairEmpty));
    }
    chair.appendChild(seat);
    row.appendChild(chair);

    // The track.
    var track = el('div', 'track');
    if (current) track.appendChild(block('busy', t, Date.parse(current.ends_at)));
    upcoming.forEach(function (b, i) {
      var start = Date.parse(b.starts_at);
      var node = block(i === 0 ? 'next' : '', start, Date.parse(b.ends_at));
      // The next one counts down; the rest are timed by the clock under the track.
      if (i === 0) {
        var minutes = Math.ceil((start - t) / MINUTE);
        node.appendChild(el('div', 'block-when num', minutes <= 0 ? COPY.startsNow : COPY.inMinutes(minutes)));
      }
      var name = splitName(b.name);
      node.appendChild(el('div', 'block-first', name.first));
      if (name.rest) node.appendChild(el('div', 'block-rest', name.rest));
      track.appendChild(node);
    });

    var tick = Math.ceil(t / (TICK_MINUTES * MINUTE)) * TICK_MINUTES * MINUTE;
    for (; tick <= t + WINDOW_MINUTES * MINUTE; tick += TICK_MINUTES * MINUTE) {
      var mark = el('div', 'tick');
      mark.setAttribute('data-at', String(tick));
      mark.appendChild(el('span', 'tick-time num', time(tick)));
      track.appendChild(mark);
    }

    track.appendChild(el('div', 'now-label', COPY.startsNow));
    if (!current && !upcoming.length) track.appendChild(el('div', 'track-empty', COPY.nobodyWaiting));
    row.appendChild(track);
    return row;
  }

  // Lay each block and tick at its distance from the chair, now that the track has a width.
  function place(track, t) {
    var width = track.clientWidth;
    var perMinute = width / WINDOW_MINUTES;
    var gap = window.innerHeight * 0.008;
    var beyond = 0;

    Array.prototype.forEach.call(track.querySelectorAll('.block'), function (node) {
      var from = (Number(node.getAttribute('data-start')) - t) / MINUTE * perMinute;
      var to = (Number(node.getAttribute('data-end')) - t) / MINUTE * perMinute;
      if (from >= width) {
        track.removeChild(node);
        beyond += 1;
        return;
      }
      node.style.right = from + 'px';
      node.style.width = Math.max(to - from - gap, 0) + 'px';
    });

    // A tick too close to the chair would sit on the «الآن» under it.
    Array.prototype.forEach.call(track.querySelectorAll('.tick'), function (node) {
      var at = (Number(node.getAttribute('data-at')) - t) / MINUTE;
      if (at < 8) track.removeChild(node);
      else node.style.right = at * perMinute + 'px';
    });

    // The count of those past the end takes the far end of the clock, and the ticks under it go.
    if (beyond) {
      var tag = el('div', 'later-tag', COPY.later(beyond));
      track.appendChild(tag);
      var clear = width - tag.offsetWidth - window.innerHeight * 0.08;
      Array.prototype.forEach.call(track.querySelectorAll('.tick'), function (node) {
        if (parseFloat(node.style.right) > clear) track.removeChild(node);
      });
    }

    // Long names shrink, down to a little over half size, before they are cut.
    Array.prototype.forEach.call(track.querySelectorAll('.block-first, .block-rest'), shrink);
  }

  function shrink(node) {
    var size = parseFloat(window.getComputedStyle(node).fontSize);
    var least = size * 0.55;
    while (node.scrollWidth > node.clientWidth && size > least) {
      size -= 1;
      node.style.fontSize = size + 'px';
    }
  }

  function signature() {
    var sig = el('div', 'sig');
    var mark = el('img');
    mark.src = 'prime-logo.svg';
    mark.alt = '';
    sig.appendChild(mark);
    sig.appendChild(el('span', 'sig-name', COPY.maker));
    sig.appendChild(el('span', 'sig-line', COPY.makerLine));
    sig.appendChild(el('span', 'sig-site', COPY.makerSite));
    return sig;
  }

  function draw() {
    if (!board) return;
    var t = now();

    var count = board.barbers.length;
    document.documentElement.style.setProperty('--k', count <= 2 ? '1' : count === 3 ? '0.8' : '0.66');

    var root = document.getElementById('board');
    root.textContent = '';

    var top = el('header', 'top');
    top.appendChild(el('h1', 'shop', board.shop.name));
    var when = el('div', 'when');
    when.appendChild(el('span', 'day num', day(t)));
    when.appendChild(el('span', 'clock num', time(t)));
    top.appendChild(when);
    root.appendChild(top);

    var arrivals = {};
    var lanes = el('div', 'lanes');
    board.barbers.forEach(function (barber) {
      lanes.appendChild(lane(barber, t, arrivals));
    });
    root.appendChild(lanes);
    seated = arrivals;

    var foot = el('footer', 'foot');
    // A board more than three minutes old says so, rather than pass old news off as current.
    if (t - readAt > 3 * MINUTE) foot.appendChild(el('span', 'stale num', COPY.updated + ' ' + time(readAt)));
    foot.appendChild(signature());
    root.appendChild(foot);

    Array.prototype.forEach.call(root.querySelectorAll('.track'), function (track) {
      place(track, t);
    });
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
  // The screen: awake, full screen on OK, redrawn every few seconds as the queue moves
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

  window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  show(sampleBoard());
  keepAwake();
  setInterval(draw, 10 * 1000);
  setInterval(function () { show(sampleBoard()); }, 60 * 1000);
})();
