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
    creditMade: 'تطبيق الحجز من تطوير',
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
    var body = el('div', 'pole-body');
    var win = el('div', 'pole-window');
    var drum = el('canvas', 'pole-drum');
    win.appendChild(drum);
    body.appendChild(win);
    var frame = el('canvas', 'pole-frame');
    body.appendChild(frame);
    node.appendChild(body);
    return { node: node, body: body, win: win, drum: drum, frame: frame, painted: '', turn: null };
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
      if (i === poleAfter) ui.cols.appendChild(ui.pole.node);
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
  // The pole, painted as a real one is built: a drum wound with red, white and blue turning inside a
  // glass tube, lit from the left, between chrome caps. The drum is painted once, a stripe set
  // taller than its window, and slides up by that length on a loop: turning a helix looks exactly
  // like that. The glass and the chrome are painted over it and stay still.
  // ---------------------------------------------------------------------------------------------

  function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toByte(v) {
    v = v <= 0 ? 0 : v >= 1 ? 1 : v;
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }

  // The drum's bands going up: red, white, blue, white (the app's red, chalk and blue).
  var BANDS = [[0xc0, 0x36, 0x2c], [0xf3, 0xf1, 0xec], [0x24, 0x45, 0x6e], [0xf3, 0xf1, 0xec]].map(function (c) {
    return [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
  });

  // The drum's face, w x h device pixels, band height b CSS pixels, two stripe sets around the
  // drum. Each pixel column is a slice of the cylinder at angle a; the bands there are shifted by
  // how far the helix has risen at a, so they bend and crowd toward the edges as on a real drum.
  // Light: a key from the front left, a weak fill from the right, a soft sheen on the paint.
  function paintDrum(canvas, w, h, b, dpr) {
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(w, h);
    var data = img.data;
    var rise = 8 * b / (2 * Math.PI); // the helix rises two sets (8 bands) per turn
    var lit = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var x, y, k;
    for (x = 0; x < w; x += 1) {
      var s = ((x + 0.5) / w) * 2 - 1;
      var a = Math.asin(s);
      var key = Math.max(0, Math.cos(a + 0.55));
      var fill = Math.max(0, Math.cos(a - 1.15));
      var shade = 0.08 + 0.95 * key + 0.12 * fill;
      var sheen = 0.22 * Math.pow(Math.max(0, Math.cos(a + 0.32)), 30);
      for (k = 0; k < 4; k += 1) {
        lit[k][0] = toByte(BANDS[k][0] * shade + sheen);
        lit[k][1] = toByte(BANDS[k][1] * shade + sheen);
        lit[k][2] = toByte(BANDS[k][2] * shade + sheen);
      }
      // How many bands one pixel spans here, so edges blend instead of stepping.
      var slope = (rise / b) / Math.sqrt(Math.max(1 - s * s, 1e-4)) * (2 / w);
      var span = Math.min(4, Math.abs(slope) + 1 / (b * dpr));
      var shift = rise * a / b;
      for (y = 0; y < h; y += 1) {
        var u = (y + 0.5) / (dpr * b) + shift;
        var u1 = u + span / 2;
        var r = 0;
        var g = 0;
        var bl = 0;
        var at = u - span / 2;
        while (at < u1) {
          var n = Math.floor(at);
          var end = Math.min(n + 1, u1);
          var c = lit[((n % 4) + 4) % 4];
          var part = end - at;
          r += c[0] * part;
          g += c[1] * part;
          bl += c[2] * part;
          at = end;
        }
        var i = (y * w + x) * 4;
        data[i] = r / span;
        data[i + 1] = g / span;
        data[i + 2] = bl / span;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function gradient(grad, stops) {
    stops.forEach(function (st) { grad.addColorStop(st[0], st[1]); });
    return grad;
  }

  function across(ctx, x0, x1, stops) {
    return gradient(ctx.createLinearGradient(x0, 0, x1, 0), stops);
  }

  function down(ctx, y0, y1, stops) {
    return gradient(ctx.createLinearGradient(0, y0, 0, y1), stops);
  }

  // Chrome across a cylinder: the dark room, the bright window it faces on the left, the far wall.
  function chrome(ctx, x0, x1) {
    return across(ctx, x0, x1, [
      [0, '#121211'], [0.06, '#3a3936'], [0.14, '#a9a59c'], [0.19, '#f3f1ec'], [0.24, '#e4e1da'],
      [0.31, '#8a867e'], [0.43, '#353431'], [0.56, '#222120'], [0.68, '#4a4844'], [0.79, '#9a968e'],
      [0.86, '#5c5a55'], [0.94, '#2b2a28'], [1, '#121211']
    ]);
  }

  // Half an ellipse, above or below the line y; drawn with arc for older browsers.
  function halfEllipse(ctx, cx, y, rx, ry, up) {
    ctx.save();
    ctx.beginPath();
    ctx.translate(cx, y);
    ctx.scale(1, ry / rx);
    if (up) ctx.arc(0, 0, rx, Math.PI, 2 * Math.PI);
    else ctx.arc(0, 0, rx, 0, Math.PI);
    ctx.closePath();
    ctx.restore();
  }

  // A chrome collar: a short cylinder lit from above, a line of light on its top edge.
  function collar(ctx, cx, y, w, h) {
    var x0 = cx - w / 2;
    ctx.fillStyle = chrome(ctx, x0, x0 + w);
    ctx.fillRect(x0, y, w, h);
    ctx.fillStyle = down(ctx, y, y + h, [[0, 'rgba(243,241,236,0.18)'], [0.35, 'rgba(243,241,236,0)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']]);
    ctx.fillRect(x0, y, w, h);
    ctx.fillStyle = 'rgba(243,241,236,0.45)';
    ctx.fillRect(x0 + w * 0.08, y, w * 0.84, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y + h - 1, w, 1);
  }

  // The rolled lip that holds the glass: round, so bright on top and dark under.
  function lip(ctx, cx, y, w, h) {
    var x0 = cx - w / 2;
    ctx.fillStyle = chrome(ctx, x0, x0 + w);
    ctx.fillRect(x0, y, w, h);
    ctx.fillStyle = down(ctx, y, y + h, [[0, 'rgba(243,241,236,0.5)'], [0.4, 'rgba(243,241,236,0.05)'], [1, 'rgba(0,0,0,0.6)']]);
    ctx.fillRect(x0, y, w, h);
  }

  function dome(ctx, cx, y, rx, ry, up) {
    halfEllipse(ctx, cx, y, rx, ry, up);
    ctx.fillStyle = chrome(ctx, cx - rx, cx + rx);
    ctx.fill();
    halfEllipse(ctx, cx, y, rx, ry, up);
    ctx.fillStyle = up
      ? down(ctx, y - ry, y, [[0, 'rgba(0,0,0,0.5)'], [0.55, 'rgba(0,0,0,0.05)'], [1, 'rgba(0,0,0,0)']])
      : down(ctx, y, y + ry, [[0, 'rgba(0,0,0,0)'], [0.4, 'rgba(0,0,0,0.15)'], [1, 'rgba(0,0,0,0.7)']]);
    ctx.fill();
    // The window, reflected on the curve.
    var hx = cx - rx * 0.42;
    var hy = up ? y - ry * 0.42 : y + ry * 0.3;
    halfEllipse(ctx, cx, y, rx, ry, up);
    ctx.fillStyle = gradient(ctx.createRadialGradient(hx, hy, 0, hx, hy, rx * 0.34), [[0, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fill();
  }

  function ball(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = gradient(ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r), [
      [0, '#f3f1ec'], [0.3, '#a9a59c'], [0.7, '#353431'], [1, '#121211']
    ]);
    ctx.fill();
  }

  // Paints the pole to its current size; does nothing while the size is unchanged.
  function paintPole(p) {
    var W = p.body.clientWidth;
    var H = p.body.clientHeight;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var size = W + 'x' + H + '@' + dpr;
    if (!W || !H || size === p.painted) return;
    p.painted = size;

    var cx = W / 2;
    var glassR = W * 0.4;
    var drumR = glassR * 0.84;
    var domeH = W * 0.2;
    var collarH = W * 0.32;
    var lipH = W * 0.07;
    var lipW = glassR * 2 + W * 0.1;
    var ballR = W * 0.1;
    var glassTop = domeH + collarH + lipH;
    var bottomDome = H - ballR * 1.6 - domeH;
    var glassBottom = bottomDome - collarH - lipH;

    // The drum: a band a fixed share of its radius, a stripe set rounded to whole device pixels so
    // the loop closes without a seam.
    var set = Math.max(8, Math.round(drumR * 0.72 * 4 * dpr)) / dpr;
    var winTop = glassTop - 2;
    var winH = glassBottom - glassTop + 4;
    p.win.style.left = (cx - drumR) + 'px';
    p.win.style.top = winTop + 'px';
    p.win.style.width = (2 * drumR) + 'px';
    p.win.style.height = winH + 'px';
    p.drum.style.width = (2 * drumR) + 'px';
    p.drum.style.height = (winH + set) + 'px';
    paintDrum(p.drum, Math.round(2 * drumR * dpr), Math.round((winH + set) * dpr), set / 4, dpr);
    if (!p.turn) {
      p.turn = document.createElement('style');
      document.head.appendChild(p.turn);
    }
    p.turn.textContent = '@keyframes pole-turn { from { transform: translateY(0); } to { transform: translateY(-' + set + 'px); } }';

    var canvas = p.frame;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var gx0 = cx - glassR;
    var gx1 = cx + glassR;
    var gH = glassBottom - glassTop;

    // Through the glass beside the drum: the wall behind, a little lit by the tube.
    ctx.fillStyle = '#121211';
    ctx.fillRect(gx0, glassTop, glassR - drumR, gH);
    ctx.fillRect(cx + drumR, glassTop, glassR - drumR, gH);
    ctx.fillStyle = across(ctx, gx0, gx1, [[0, 'rgba(243,241,236,0.14)'], [0.12, 'rgba(243,241,236,0)'], [0.88, 'rgba(0,0,0,0)'], [1, 'rgba(243,241,236,0.06)']]);
    ctx.fillRect(gx0, glassTop, glassR * 2, gH);

    // The tube's reflections: a soft band and a hard line of the window on the left, a thin one on
    // the right, the far edge in shadow.
    ctx.fillStyle = across(ctx, gx0, gx1, [
      [0.1, 'rgba(255,255,255,0)'], [0.24, 'rgba(255,255,255,0.16)'], [0.36, 'rgba(255,255,255,0)'],
      [0.78, 'rgba(255,255,255,0)'], [0.83, 'rgba(255,255,255,0.16)'], [0.87, 'rgba(255,255,255,0)'],
      [0.92, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']
    ]);
    ctx.fillRect(gx0, glassTop, glassR * 2, gH);
    var line = gx0 + glassR * 2 * 0.22;
    var half = W * 0.025;
    ctx.fillStyle = across(ctx, line - half, line + half, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.62)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(line - half, glassTop, half * 2, gH);

    // The glass wall seen edge-on at both sides.
    ctx.fillStyle = 'rgba(243,241,236,0.55)';
    ctx.fillRect(gx0, glassTop, 1.2, gH);
    ctx.fillStyle = 'rgba(243,241,236,0.2)';
    ctx.fillRect(gx1 - 1.2, glassTop, 1.2, gH);

    // The caps' shadow inside the tube.
    var shadow = W * 0.14;
    ctx.fillStyle = down(ctx, glassTop, glassTop + shadow, [[0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(gx0, glassTop, glassR * 2, shadow);
    ctx.fillStyle = down(ctx, glassBottom - shadow, glassBottom, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']]);
    ctx.fillRect(gx0, glassBottom - shadow, glassR * 2, shadow);

    // The caps.
    dome(ctx, cx, domeH, W / 2, domeH, true);
    collar(ctx, cx, domeH, W, collarH);
    lip(ctx, cx, domeH + collarH, lipW, lipH);
    lip(ctx, cx, glassBottom, lipW, lipH);
    collar(ctx, cx, glassBottom + lipH, W, collarH);
    ball(ctx, cx, H - ballR, ballR);
    dome(ctx, cx, bottomDome, W / 2, domeH, false);
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
        row = el('li', 'poster' + stepped);
        var posterHead = el('div', 'poster-head');
        posterHead.appendChild(el('span', 'poster-tag', COPY.next));
        posterHead.appendChild(el('span', 'poster-time num', booked));
        row.appendChild(posterHead);
        row.appendChild(el('div', 'poster-name', b.name));
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
    ui.pole.node.className = open ? 'pole' : 'pole still';
    paintPole(ui.pole);

    Array.prototype.forEach.call(ui.cols.querySelectorAll('.now-name, .poster-name, .place-name'), shrink);
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
