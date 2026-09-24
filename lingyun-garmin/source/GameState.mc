import Toybox.ActivityMonitor;
import Toybox.Application;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

var gGame as GameState? = null;

// The loaded game, created on first use.
function game() as GameState {
  if (gGame == null) {
    gGame = new GameState();
  }
  return gGame as GameState;
}

// Day number of a moment. Rounds to the nearest midnight so local and
// UTC-based day starts (history entries vary by device) share a key.
function dayKey(m as Time.Moment) as Number {
  return (m.value() + 43200) / 86400;
}

// Player progress plus the bookkeeping that turns the watch's all-day
// activity counters into cultivation exactly once.
class GameState {
  const KEY = "game";

  var realm; // 0..Rules.REALM_MAX
  var attr; // cultivation per attribute
  var gain; // today's gain per attribute
  var sect; // -1 until realm 3, then the attribute that was strongest
  var day; // day key of the day being tracked
  var start; // day key of the first day
  var cred; // today's activity already credited: steps, floors, moderate, vigorous minutes
  var quest; // today's rewarded quests: bits 0..2, bit 3 = all-done bonus
  var train; // today's training points per type
  var leaps; // today's leaps, the floors quest on watches without a barometer
  var streak; // consecutive all-quest days, ending at fullDay
  var fullDay; // last day key with all quests done
  var best; // single-day records: steps, floors, intensity minutes
  var total; // lifetime steps, floors, intensity minutes
  var hasFloors; // the watch counts floors

  // Not saved.
  var isNew; // no saved game yet
  var awayGain; // cultivation credited for days the game was closed

  function initialize() {
    load();
  }

  function load() as Void {
    var raw = Application.Storage.getValue(KEY);
    var d = {};
    isNew = true;
    if (raw instanceof Dictionary) {
      d = raw;
      isNew = false;
    }
    realm = num(d, "r", 0);
    attr = arr(d, "a", 4);
    gain = arr(d, "g", 4);
    sect = num(d, "s", -1);
    day = num(d, "d", 0);
    start = num(d, "st", 0);
    cred = arr(d, "c", 4);
    quest = num(d, "q", 0);
    train = arr(d, "t", 4);
    leaps = num(d, "l", 0);
    streak = num(d, "k", 0);
    fullDay = num(d, "f", -2);
    best = arr(d, "b", 3);
    total = arr(d, "to", 3);
    hasFloors = d.get("hf") != false;
    awayGain = 0;
  }

  function save() as Void {
    Application.Storage.setValue(KEY, {
      "r" => realm,
      "a" => attr,
      "g" => gain,
      "s" => sect,
      "d" => day,
      "st" => start,
      "c" => cred,
      "q" => quest,
      "t" => train,
      "l" => leaps,
      "k" => streak,
      "f" => fullDay,
      "b" => best,
      "to" => total,
      "hf" => hasFloors
    });
    Application.Storage.setValue("glance", [
      Ui.title(self),
      progressPct(),
      Lang.format(Ui.s(Rez.Strings.GlanceDetail), [questsDone(), sum()])
    ]);
  }

  // Credits activity since the last sync. Days the game was not opened are
  // recovered from the watch's activity history (about 7 days).
  function sync() as Void {
    var today = dayKey(Time.today());
    var now = totalsOf(ActivityMonitor.getInfo(), true);
    if (isNew) {
      isNew = false;
      day = today;
      start = today;
      add(Rules.MIND, Rules.CHECKIN);
    } else if (today > day) {
      var before = sum();
      catchUp(today);
      awayGain = sum() - before;
      day = today;
      cred = [0, 0, 0, 0];
      quest = 0;
      train = [0, 0, 0, 0];
      leaps = 0;
      gain = [0, 0, 0, 0];
      add(Rules.MIND, Rules.CHECKIN);
    }
    credit(now, cred);
    cred = now;
    quest = checkQuests(day, now, quest, true);
    record(now);
  }

  // Adds training points, capped per type per day. Returns the points added.
  function awardTraining(type as Number, points as Number) as Number {
    var room = Rules.TRAIN_CAP - train[type];
    if (points > room) {
      points = room;
    }
    if (points <= 0) {
      return 0;
    }
    train[type] += points;
    add(type, points);
    return points;
  }

  function addLeaps(n as Number) as Void {
    leaps += n;
    quest = checkQuests(day, cred, quest, true);
  }

  // Moves to the next realm after a passed trial. The sect is fixed by the
  // strongest attribute on reaching realm 3.
  function advance() as Void {
    if (realm >= Rules.REALM_MAX) {
      return;
    }
    realm += 1;
    if (realm == 3 && sect < 0) {
      sect = strongest();
    }
    save();
  }

  // Rules.BLOCK_NONE when the breakthrough trial may start.
  function blocker() as Number {
    if (realm >= Rules.REALM_MAX) {
      return Rules.BLOCK_MAX;
    }
    var next = realm + 1;
    var need = Rules.REALM_XP[next];
    if (sum() < need) {
      return Rules.BLOCK_XP;
    }
    if (attr[weakest()] < (need * Rules.MIN_ATTR_PCT) / 100) {
      return Rules.BLOCK_ATTR;
    }
    if (next == 6 && best[0] < Rules.PREREQ_STEPS) {
      return Rules.BLOCK_STEPS;
    }
    if (next == 7) {
      var lacking = hasFloors
        ? best[1] < Rules.PREREQ_FLOORS
        : best[2] < Rules.PREREQ_IM;
      if (lacking) {
        return Rules.BLOCK_FLOORS;
      }
    }
    if (next == 8 && currentStreak() < Rules.PREREQ_STREAK) {
      return Rules.BLOCK_STREAK;
    }
    return Rules.BLOCK_NONE;
  }

  function sum() as Number {
    return attr[0] + attr[1] + attr[2] + attr[3];
  }

  // Percent of the way from the current realm to the next.
  function progressPct() as Number {
    if (realm >= Rules.REALM_MAX) {
      return 100;
    }
    var lo = Rules.REALM_XP[realm];
    var hi = Rules.REALM_XP[realm + 1];
    var pct = ((sum() - lo) * 100) / (hi - lo);
    if (pct < 0) {
      return 0;
    }
    return pct > 100 ? 100 : pct;
  }

  function strongest() as Number {
    var k = 0;
    for (var i = 1; i < 4; i++) {
      if (attr[i] > attr[k]) {
        k = i;
      }
    }
    return k;
  }

  function weakest() as Number {
    var k = 0;
    for (var i = 1; i < 4; i++) {
      if (attr[i] < attr[k]) {
        k = i;
      }
    }
    return k;
  }

  // The streak still counts while yesterday was complete.
  function currentStreak() as Number {
    return fullDay >= day - 1 ? streak : 0;
  }

  function questsDone() as Number {
    return (quest & 1) + ((quest >> 1) & 1) + ((quest >> 2) & 1);
  }

  // Today's progress towards quest q.
  function questValue(q as Number) as Number {
    return valueOf(q, cred, true);
  }

  // 0 listless, 1 calm, 2 in high spirits: drives the figure's pose.
  function mood() as Number {
    if ((quest & 8) != 0) {
      return 2;
    }
    var idle = cred[0] < Rules.questTarget(0, realm, hasFloors) / 4;
    var trained = train[0] + train[1] + train[2] + train[3] > 0;
    return idle && !trained ? 0 : 1;
  }

  // Days since the first launch, counting today.
  function daysPlayed() as Number {
    return day - start + 1;
  }

  function add(i as Number, p as Number) as Void {
    if (p <= 0) {
      return;
    }
    attr[i] += p;
    gain[i] += p;
  }

  hidden function catchUp(today as Number) as Void {
    var hist = ActivityMonitor.getHistory();
    if (hist == null) {
      return;
    }
    var from = day > today - 31 ? day : today - 31;
    for (var k = from; k < today; k++) {
      var h = null;
      for (var i = 0; i < hist.size(); i++) {
        var e = hist[i];
        if (e != null && e.startOfDay != null && dayKey(e.startOfDay) == k) {
          h = e;
          break;
        }
      }
      if (h == null) {
        continue;
      }
      var t = totalsOf(h, false);
      if (k == day) {
        credit(t, cred);
        checkQuests(k, t, quest, false);
      } else {
        credit(t, [0, 0, 0, 0]);
        checkQuests(k, t, 0, false);
      }
      record(t);
    }
  }

  // Steps, floors, moderate and vigorous minutes from an
  // ActivityMonitor.Info (today) or ActivityMonitor.History (a past day).
  hidden function totalsOf(src, isToday as Boolean) as Array<Number> {
    var t = [0, 0, 0, 0];
    if (src == null) {
      return t;
    }
    if (src.steps != null) {
      t[0] = src.steps;
    }
    var floors = null;
    if (src has :floorsClimbed) {
      floors = src.floorsClimbed;
    }
    if (floors != null) {
      t[1] = floors;
    }
    if (isToday) {
      hasFloors = floors != null;
    }
    var am = null;
    if (src has :activeMinutesDay) {
      am = src.activeMinutesDay;
    } else if (src has :activeMinutes) {
      am = src.activeMinutes;
    }
    if (am != null) {
      if (am.moderate != null) {
        t[2] = am.moderate;
      }
      if (am.vigorous != null) {
        t[3] = am.vigorous;
      }
    }
    return t;
  }

  // Credits the move of the counters from c to t. Points are counted on
  // whole units of the running totals so no remainder is lost between syncs.
  // A counter that went backwards (device reset) credits nothing.
  hidden function credit(t as Array<Number>, c as Array<Number>) as Void {
    add(Rules.BODY, unitsGained(t[0], c[0], 100));
    if (hasFloors) {
      add(Rules.AGILITY, more(t[1], c[1]) * 5);
    } else {
      add(Rules.AGILITY, unitsGained(t[0], c[0], 200));
    }
    add(Rules.QI, more(t[2], c[2]) * 2 + more(t[3], c[3]) * 4);
    total[0] += more(t[0], c[0]);
    total[1] += more(t[1], c[1]);
    total[2] += more(t[2], c[2]) + 2 * more(t[3], c[3]);
  }

  hidden function unitsGained(t as Number, c as Number, per as Number) as Number {
    return t >= c ? t / per - c / per : 0;
  }

  hidden function more(t as Number, c as Number) as Number {
    return t > c ? t - c : 0;
  }

  // Rewards newly completed quests of day k; returns the updated bit mask.
  hidden function checkQuests(k as Number, t as Array<Number>, mask as Number, isToday as Boolean) as Number {
    var all = true;
    for (var q = 0; q < 3; q++) {
      if (valueOf(q, t, isToday) >= Rules.questTarget(q, realm, hasFloors)) {
        if ((mask & (1 << q)) == 0) {
          mask |= 1 << q;
          add(Rules.MIND, Rules.QUEST_REWARD);
        }
      } else {
        all = false;
      }
    }
    if (all && (mask & 8) == 0) {
      mask |= 8;
      add(Rules.MIND, Rules.QUEST_REWARD);
      if (fullDay == k - 1) {
        streak += 1;
      } else if (fullDay != k) {
        streak = 1;
      }
      fullDay = k;
    }
    return mask;
  }

  // Leaps only exist for today; past days can't complete the leap quest.
  hidden function valueOf(q as Number, t as Array<Number>, isToday as Boolean) as Number {
    if (q == 0) {
      return t[0];
    }
    if (q == 1) {
      if (hasFloors) {
        return t[1];
      }
      return isToday ? leaps : 0;
    }
    return t[2] + 2 * t[3];
  }

  hidden function record(t as Array<Number>) as Void {
    if (t[0] > best[0]) {
      best[0] = t[0];
    }
    if (t[1] > best[1]) {
      best[1] = t[1];
    }
    var im = t[2] + 2 * t[3];
    if (im > best[2]) {
      best[2] = im;
    }
  }

  hidden function num(d, k as String, def as Number) {
    var v = d.get(k);
    return v instanceof Number ? v : def;
  }

  hidden function arr(d, k as String, n as Number) {
    var v = d.get(k);
    if (v instanceof Array && v.size() == n) {
      return v;
    }
    var a = new [n];
    for (var i = 0; i < n; i++) {
      a[i] = 0;
    }
    return a;
  }
}
