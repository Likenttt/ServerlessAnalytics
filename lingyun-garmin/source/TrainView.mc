import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// One training session or breakthrough trial: instructions, a 3 s
// countdown, the exercise, then the result. The type is the attribute it
// trains: punch (body), leap (qinggong), stance (qi) or breath (mind).
class TrainView extends WatchUi.View {
  const READY = 0;
  const COUNTDOWN = 1;
  const RUN = 2;
  const DONE = 3;

  const BURST_MS = 30000; // punch and leap rounds
  const CYCLE_MS = 10000; // one breath: 4 s in, 6 s out
  const INHALE_MS = 4000;

  hidden var _type;
  hidden var _trial;
  hidden var _goal;
  hidden var _state;
  hidden var _t0 = 0;
  hidden var _elapsed = 0;
  hidden var _timer;
  hidden var _impacts = null;
  hidden var _still = null;
  hidden var _listening = false;
  hidden var _cue = 0;
  hidden var _hr0 = null;
  hidden var _hr = null;
  hidden var _score = 0;
  hidden var _gained = 0;
  hidden var _capped = false;
  hidden var _passed = false;
  hidden var _stage = null;
  hidden var _lastCount = 0;
  hidden var _flash = 0; // ticks to show the strike / jump frame

  // Texts loaded once; the view redraws ten times a second while running.
  hidden var _title;
  hidden var _hint;
  hidden var _goalText;
  hidden var _labels;

  function initialize(type as Number, trial as Boolean) {
    View.initialize();
    _type = type;
    _trial = trial;
    _state = READY;
    _timer = new Timer.Timer();
    var g = game();
    _goal = trial ? Rules.TRIAL_GOAL[g.realm + 1] : 0;
    _title = trial
      ? Ui.s(Rez.Strings.MenuBreak) + " · " + Ui.trainName(type)
      : Ui.trainName(type);
    var hints = [
      Rez.Strings.TrainHint0,
      Rez.Strings.TrainHint1,
      Rez.Strings.TrainHint2,
      Rez.Strings.TrainHint3,
    ];
    _hint = Ui.s(hints[type]);
    if (trial) {
      var goals = [
        Rez.Strings.TrialGoalCount,
        Rez.Strings.TrialGoalCount,
        Rez.Strings.TrialGoalStill,
        Rez.Strings.TrialGoalBreath,
      ];
      _goalText = Lang.format(Ui.s(goals[type]), [_goal]);
    } else {
      var lengths = [
        Rez.Strings.DurBurst,
        Rez.Strings.DurBurst,
        Rez.Strings.DurStance,
        Rez.Strings.DurBreath,
      ];
      _goalText = Ui.s(lengths[type]);
    }
    _labels = {
      :start => Ui.s(Rez.Strings.StartHint),
      :back => Ui.s(Rez.Strings.BackHint),
      :steady => Ui.s(Rez.Strings.Steady),
      :shaky => Ui.s(Rez.Strings.Shaky),
      :inhale => Ui.s(Rez.Strings.Inhale),
      :exhale => Ui.s(Rez.Strings.Exhale),
      :sec => Ui.s(Rez.Strings.SecFmt),
    };
  }

  // Leaving mid-exercise (back button, or the view is covered) abandons it.
  function onHide() as Void {
    stopSensors();
    _timer.stop();
    if (_stage != null) {
      _stage.release();
      _stage = null;
    }
    if (_state == COUNTDOWN || _state == RUN) {
      _state = READY;
    }
  }

  // Select: start; while running a debug build counts a rep; when done, leave.
  function press() as Boolean {
    if (_state == READY) {
      _state = COUNTDOWN;
      _t0 = System.getTimer();
      _timer.start(method(:onTick), 100, true);
    } else if (_state == RUN) {
      debugRep();
    } else if (_state == DONE) {
      WatchUi.popView(WatchUi.SLIDE_RIGHT);
      return true;
    }
    WatchUi.requestUpdate();
    return true;
  }

  function onTick() as Void {
    var now = System.getTimer();
    if (_state == COUNTDOWN) {
      if (now - _t0 >= 3000) {
        begin(now);
      }
    } else if (_state == RUN) {
      _elapsed = now - _t0;
      if (_type == Rules.MIND) {
        breathCue();
      }
      if (_flash > 0) {
        _flash -= 1;
      }
      if (_impacts != null && _impacts.count != _lastCount) {
        _lastCount = _impacts.count;
        _flash = 3;
      }
      var early = _trial && _still != null && _still.steady >= _goal;
      if (_elapsed >= duration() || early) {
        finish();
      }
    }
    WatchUi.requestUpdate();
  }

  function onAccel(data) as Void {
    var a = data.accelerometerData;
    if (a == null || _state != RUN) {
      return;
    }
    if (_impacts != null) {
      _impacts.feed(a.x, a.y, a.z);
    }
    if (_still != null) {
      _still.feed(a.x, a.y, a.z);
    }
  }

  function onSensor(info) as Void {
    var hr = info.heartRate;
    if (hr != null && _state == RUN) {
      if (_hr0 == null) {
        _hr0 = hr;
      }
      _hr = hr;
    }
  }

  hidden function begin(now as Number) as Void {
    _state = RUN;
    _t0 = now;
    _elapsed = 0;
    _cue = 0;
    if (_type == Rules.BODY) {
      _impacts = new ImpactCounter(2200, 1400, 6);
    } else if (_type == Rules.AGILITY) {
      _impacts = new ImpactCounter(2000, 1300, 8);
    } else if (_type == Rules.QI) {
      _still = new Stillness(160);
    }
    startSensors();
    Ui.buzz(300);
  }

  hidden function duration() as Number {
    if (_type == Rules.QI) {
      return _trial ? (_goal + 20) * 1000 : 60000;
    }
    if (_type == Rules.MIND) {
      return (_trial ? _goal : 6) * CYCLE_MS;
    }
    return BURST_MS;
  }

  hidden function finish() as Void {
    stopSensors();
    _timer.stop();
    _state = DONE;
    _score = score();
    var g = game();
    g.sync();
    if (_trial) {
      _passed = _score >= _goal;
      if (_passed) {
        g.advance();
      }
      Ui.buzz(_passed ? 1000 : 400);
    } else {
      var earned = points();
      if (_type == Rules.AGILITY) {
        g.addLeaps(_score);
      }
      _gained = g.awardTraining(_type, earned);
      _capped = _gained < earned;
      Ui.buzz(500);
    }
    g.save();
  }

  hidden function score() as Number {
    if (_impacts != null) {
      return _impacts.count;
    }
    if (_still != null) {
      return _still.steady;
    }
    var cycles = _elapsed / CYCLE_MS;
    var planned = duration() / CYCLE_MS;
    return cycles < planned ? cycles : planned;
  }

  // About 20 points for a good session.
  hidden function points() as Number {
    if (_type == Rules.QI) {
      return _score / 3;
    }
    if (_type == Rules.MIND) {
      var calmer = _hr0 != null && _hr != null && _hr <= _hr0 - 3;
      return _score * 3 + (calmer ? 2 : 0);
    }
    return _score / 2;
  }

  // A long buzz starts each inhale, a short one each exhale.
  hidden function breathCue() as Void {
    var inhale = _elapsed % CYCLE_MS < INHALE_MS;
    var cue = (_elapsed / CYCLE_MS) * 2 + (inhale ? 0 : 1);
    if (cue != _cue) {
      _cue = cue;
      Ui.buzz(inhale ? 200 : 80);
    }
  }

  hidden function startSensors() as Void {
    try {
      if (_type == Rules.MIND) {
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
      } else {
        Sensor.registerSensorDataListener(method(:onAccel), {
          :period => 1,
          :accelerometer => {
            :enabled => true,
            :sampleRate => 25,
          },
        });
      }
      _listening = true;
    } catch (e) {
      _listening = false;
    }
  }

  hidden function stopSensors() as Void {
    if (!_listening) {
      return;
    }
    _listening = false;
    if (_type == Rules.MIND) {
      Sensor.enableSensorEvents(null);
      Sensor.setEnabledSensors([]);
    } else {
      Sensor.unregisterSensorDataListener();
    }
  }

  (:debug)
  hidden function debugRep() as Void {
    if (_impacts != null) {
      _impacts.count += 1;
    }
    if (_still != null) {
      _still.steady += 1;
    }
  }

  (:release)
  hidden function debugRep() as Void {}

  function onUpdate(dc as Graphics.Dc) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
    if (_stage == null) {
      _stage = new Stage();
    }
    if (_state == RUN) {
      var left = duration() - _elapsed;
      ring(dc, w, h, ((left < 0 ? 0 : left) * 100) / duration());
    }
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 14) / 100,
      Graphics.FONT_SMALL,
      _title,
      Ui.center()
    );
    if (_state == READY) {
      drawReady(dc, w, h);
    } else if (_state == COUNTDOWN) {
      var n = 3 - (System.getTimer() - _t0) / 1000;
      dc.drawText(
        w / 2,
        (h * 34) / 100,
        Graphics.FONT_NUMBER_MEDIUM,
        (n < 1 ? 1 : n).toString(),
        Ui.center()
      );
      hero(dc, w, h, readyPose(), 0);
    } else if (_state == RUN) {
      if (_type == Rules.MIND) {
        drawBreath(dc, w, h);
      } else {
        drawRun(dc, w, h);
      }
    } else {
      drawDone(dc, w, h);
    }
  }

  // The hero stands at the bottom centre, raised by lift art pixels.
  hidden function hero(
    dc as Graphics.Dc,
    w as Number,
    h as Number,
    pose as Number,
    lift as Number
  ) as Void {
    var g = game();
    var p = _stage.scale;
    _stage.drawHero(dc, w / 2, (h * 86) / 100 - lift * p, g.sect + 1, pose);
  }

  hidden function readyPose() as Number {
    var poses = [Art.STRIKE0, Art.JUMP0, Art.HORSE, Art.MEDITATE];
    return poses[_type];
  }

  hidden function drawReady(
    dc as Graphics.Dc,
    w as Number,
    h as Number
  ) as Void {
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 29) / 100, Graphics.FONT_XTINY, _hint, Ui.center());
    dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 43) / 100,
      Graphics.FONT_SMALL,
      _goalText,
      Ui.center()
    );
    hero(dc, w, h, readyPose(), 0);
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 93) / 100,
      Graphics.FONT_XTINY,
      _labels[:start],
      Ui.center()
    );
  }

  // Punch, leap and stance: the count on top, the hero acting it out below.
  hidden function drawRun(dc as Graphics.Dc, w as Number, h as Number) as Void {
    var left = duration() - _elapsed;
    var secs = Lang.format(_labels[:sec], [
      ((left < 0 ? 0 : left) + 999) / 1000,
    ]);
    var big = _impacts != null ? _impacts.count : _still.steady;
    var color = Graphics.COLOR_WHITE;
    if (_still != null) {
      color = _still.shaky ? Graphics.COLOR_RED : Graphics.COLOR_GREEN;
    }
    dc.setColor(color, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 30) / 100,
      Graphics.FONT_NUMBER_MEDIUM,
      big.toString(),
      Ui.center()
    );
    var under = secs;
    if (_trial) {
      under = "/ " + _goal + "   " + secs;
    }
    if (_still != null) {
      under =
        (_still.shaky ? _labels[:shaky] : _labels[:steady]) + "   " + under;
    }
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 43) / 100, Graphics.FONT_XTINY, under, Ui.center());

    var p = _stage.scale;
    if (_type == Rules.BODY) {
      hero(dc, w, h, _flash > 0 ? Art.STRIKE1 : Art.STRIKE0, 0);
      if (_flash > 0) {
        _stage.drawCentered(
          dc,
          w / 2 + 13 * p,
          (h * 86) / 100 - 14 * p,
          Rez.Drawables.spark
        );
      }
    } else if (_type == Rules.AGILITY) {
      hero(dc, w, h, _flash > 0 ? Art.JUMP1 : Art.JUMP0, _flash > 0 ? 4 : 0);
    } else {
      var shake = _still.shaky ? ((_elapsed / 100) % 2) * 2 - 1 : 0;
      _stage.drawHero(
        dc,
        w / 2 + shake * p,
        (h * 86) / 100,
        game().sect + 1,
        Art.HORSE
      );
    }
  }

  // The meditating hero under a qi orb that swells on the in-breath.
  hidden function drawBreath(
    dc as Graphics.Dc,
    w as Number,
    h as Number
  ) as Void {
    var t = _elapsed % CYCLE_MS;
    var inhale = t < INHALE_MS;
    var k = inhale
      ? (t * 100) / INHALE_MS
      : 100 - ((t - INHALE_MS) * 100) / (CYCLE_MS - INHALE_MS);
    var size = (k * 4) / 101;
    dc.setColor(inhale ? 0x55aaff : 0xaaaaff, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 25) / 100,
      Graphics.FONT_SMALL,
      inhale ? _labels[:inhale] : _labels[:exhale],
      Ui.center()
    );
    var orbs = [
      Rez.Drawables.orb_0,
      Rez.Drawables.orb_1,
      Rez.Drawables.orb_2,
      Rez.Drawables.orb_3,
    ];
    var orb = _stage.art(orbs[size]);
    dc.drawBitmap(
      w / 2 - orb.getWidth() / 2,
      (h * 42) / 100 - orb.getHeight() / 2,
      orb
    );
    hero(dc, w, h, Art.MEDITATE, 0);

    var planned = duration() / CYCLE_MS;
    var line = (_elapsed / CYCLE_MS + 1).toString() + "/" + planned;
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 92) / 100, Graphics.FONT_XTINY, line, Ui.center());
    if (_hr != null) {
      var x = (w * 20) / 100;
      _stage.drawCentered(dc, x, (h * 42) / 100, Rez.Drawables.icon_heart);
      dc.drawText(
        x,
        (h * 51) / 100,
        Graphics.FONT_XTINY,
        _hr.toString(),
        Ui.center()
      );
    }
  }

  // Remaining time as a ring along the screen edge, starting at 12 o'clock.
  hidden function ring(
    dc as Graphics.Dc,
    w as Number,
    h as Number,
    pct as Number
  ) as Void {
    var r = (h < w ? h : w) / 2 - h / 40;
    var pen = h / 60 > 2 ? h / 60 : 2;
    dc.setPenWidth(pen);
    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawCircle(w / 2, h / 2, r);
    if (pct > 0) {
      dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
      if (pct >= 100) {
        dc.drawCircle(w / 2, h / 2, r);
      } else {
        var end = (((90 - (pct * 360) / 100) % 360) + 360) % 360;
        dc.drawArc(w / 2, h / 2, r, Graphics.ARC_CLOCKWISE, 90, end);
      }
    }
    dc.setPenWidth(1);
  }

  hidden function drawDone(
    dc as Graphics.Dc,
    w as Number,
    h as Number
  ) as Void {
    var g = game();
    var counts = [
      Rez.Strings.CountFmt0,
      Rez.Strings.CountFmt1,
      Rez.Strings.CountFmt2,
      Rez.Strings.CountFmt3,
    ];
    var pose = Art.SALUTE;
    if (_trial) {
      dc.setColor(
        _passed ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY,
        Graphics.COLOR_TRANSPARENT
      );
      dc.drawText(
        w / 2,
        (h * 28) / 100,
        Graphics.FONT_MEDIUM,
        Ui.s(_passed ? Rez.Strings.TrialOk : Rez.Strings.TrialFail),
        Ui.center()
      );
      dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
      var detail = _passed
        ? Lang.format(Ui.s(Rez.Strings.NewRealmFmt), [Ui.realmName(g.realm)])
        : _score.toString() + " / " + _goal;
      dc.drawText(
        w / 2,
        (h * 39) / 100,
        Graphics.FONT_SMALL,
        detail,
        Ui.center()
      );
      var extra = null;
      if (!_passed) {
        extra = Ui.s(Rez.Strings.RetryHint);
        pose = Art.SLEEP;
      } else if (g.realm == Rules.REALM_MAX) {
        extra = Ui.s(Rez.Strings.Soar);
        pose = Art.FLY0;
      } else if (g.realm == 3) {
        extra = Lang.format(Ui.s(Rez.Strings.JoinSect), [Ui.sectName(g.sect)]);
      }
      if (extra != null) {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
          w / 2,
          (h * 48) / 100,
          Graphics.FONT_XTINY,
          extra,
          Ui.center()
        );
      }
    } else {
      dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        w / 2,
        (h * 28) / 100,
        Graphics.FONT_MEDIUM,
        Ui.attrName(_type) + " +" + _gained,
        Ui.center()
      );
      dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        w / 2,
        (h * 39) / 100,
        Graphics.FONT_SMALL,
        Lang.format(Ui.s(counts[_type]), [_score]),
        Ui.center()
      );
      if (_capped) {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
          w / 2,
          (h * 48) / 100,
          Graphics.FONT_XTINY,
          Ui.s(Rez.Strings.Capped),
          Ui.center()
        );
      }
    }
    hero(dc, w, h, pose, 0);
    if (_trial && _passed) {
      var p = _stage.scale;
      _stage.drawQi(dc, w / 2, (h * 86) / 100 - 14 * p, 6, 0);
    }
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 93) / 100,
      Graphics.FONT_XTINY,
      _labels[:back],
      Ui.center()
    );
  }
}

class TrainDelegate extends WatchUi.BehaviorDelegate {
  hidden var _view;

  function initialize(view as TrainView) {
    BehaviorDelegate.initialize();
    _view = view;
  }

  function onSelect() as Boolean {
    return _view.press();
  }
}
