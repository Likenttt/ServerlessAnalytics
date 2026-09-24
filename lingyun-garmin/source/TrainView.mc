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
      :heart => Ui.s(Rez.Strings.HeartFmt),
      :sub => Ui.trainSub(g, type),
    };
  }

  // Leaving mid-exercise (back button, or the view is covered) abandons it.
  function onHide() as Void {
    stopSensors();
    _timer.stop();
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
    dc.drawText(
      w / 2,
      (h * 15) / 100,
      Graphics.FONT_SMALL,
      _title,
      Ui.center()
    );
    if (_state == READY) {
      drawReady(dc, w, h);
    } else if (_state == COUNTDOWN) {
      var left = 3 - (System.getTimer() - _t0) / 1000;
      dc.drawText(
        w / 2,
        h / 2,
        Graphics.FONT_NUMBER_HOT,
        (left < 1 ? 1 : left).toString(),
        Ui.center()
      );
    } else if (_state == RUN) {
      drawRun(dc, w, h);
    } else {
      drawDone(dc, w, h);
    }
  }

  hidden function drawReady(
    dc as Graphics.Dc,
    w as Number,
    h as Number
  ) as Void {
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 38) / 100, Graphics.FONT_XTINY, _hint, Ui.center());
    dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 57) / 100,
      Graphics.FONT_SMALL,
      _goalText,
      Ui.center()
    );
    if (!_trial) {
      dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        w / 2,
        (h * 68) / 100,
        Graphics.FONT_XTINY,
        _labels[:sub],
        Ui.center()
      );
    }
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 82) / 100,
      Graphics.FONT_XTINY,
      _labels[:start],
      Ui.center()
    );
  }

  hidden function drawRun(dc as Graphics.Dc, w as Number, h as Number) as Void {
    var total = duration();
    var left = total - _elapsed;
    if (left < 0) {
      left = 0;
    }
    ring(dc, w, h, (left * 100) / total);
    var secs = Lang.format(_labels[:sec], [(left + 999) / 1000]);

    if (_type == Rules.MIND) {
      drawBreath(dc, w, h, secs);
      return;
    }
    var big = _impacts != null ? _impacts.count : _still.steady;
    var color = Graphics.COLOR_WHITE;
    if (_still != null) {
      color = _still.shaky ? Graphics.COLOR_RED : Graphics.COLOR_GREEN;
    }
    dc.setColor(color, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 47) / 100,
      Graphics.FONT_NUMBER_HOT,
      big.toString(),
      Ui.center()
    );
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    var under = secs;
    if (_trial) {
      under = "/ " + _goal + "   " + secs;
    }
    if (_still != null) {
      under =
        (_still.shaky ? _labels[:shaky] : _labels[:steady]) + "   " + under;
    }
    dc.drawText(w / 2, (h * 72) / 100, Graphics.FONT_XTINY, under, Ui.center());
  }

  // A circle that swells while breathing in and shrinks while breathing out.
  hidden function drawBreath(
    dc as Graphics.Dc,
    w as Number,
    h as Number,
    secs as String
  ) as Void {
    var t = _elapsed % CYCLE_MS;
    var inhale = t < INHALE_MS;
    var k = inhale
      ? (t * 100) / INHALE_MS
      : 100 - ((t - INHALE_MS) * 100) / (CYCLE_MS - INHALE_MS);
    var rMin = h / 12;
    var rMax = h / 4;
    var r = rMin + ((rMax - rMin) * k) / 100;
    dc.setColor(0x0055aa, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(w / 2, h / 2, r);
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      h / 2,
      Graphics.FONT_MEDIUM,
      inhale ? _labels[:inhale] : _labels[:exhale],
      Ui.center()
    );
    var planned = duration() / CYCLE_MS;
    var line =
      (_elapsed / CYCLE_MS + 1).toString() + "/" + planned + "   " + secs;
    if (_hr != null) {
      line = line + "   " + Lang.format(_labels[:heart], [_hr]);
    }
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 82) / 100, Graphics.FONT_XTINY, line, Ui.center());
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
    if (_trial) {
      dc.setColor(
        _passed ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY,
        Graphics.COLOR_TRANSPARENT
      );
      dc.drawText(
        w / 2,
        (h * 36) / 100,
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
        (h * 52) / 100,
        Graphics.FONT_SMALL,
        detail,
        Ui.center()
      );
      var extra = null;
      if (!_passed) {
        extra = Ui.s(Rez.Strings.RetryHint);
      } else if (g.realm == Rules.REALM_MAX) {
        extra = Ui.s(Rez.Strings.Soar);
      } else if (g.realm == 3) {
        extra = Lang.format(Ui.s(Rez.Strings.JoinSect), [Ui.sectName(g.sect)]);
      }
      if (extra != null) {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
          w / 2,
          (h * 65) / 100,
          Graphics.FONT_XTINY,
          extra,
          Ui.center()
        );
      }
    } else {
      dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        w / 2,
        (h * 38) / 100,
        Graphics.FONT_MEDIUM,
        Ui.attrName(_type) + " +" + _gained,
        Ui.center()
      );
      dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        w / 2,
        (h * 53) / 100,
        Graphics.FONT_SMALL,
        Lang.format(Ui.s(counts[_type]), [_score]),
        Ui.center()
      );
      if (_capped) {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
          w / 2,
          (h * 65) / 100,
          Graphics.FONT_XTINY,
          Ui.s(Rez.Strings.Capped),
          Ui.center()
        );
      }
    }
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 82) / 100,
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
