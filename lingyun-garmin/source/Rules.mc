import Toybox.Lang;

// Game balance. See README.md for how the numbers were chosen.
module Rules {
  const REALM_MAX = 8;

  // Attribute indices. Training type i trains attribute i.
  const BODY = 0; // 体魄: steps, punches
  const AGILITY = 1; // 轻功: floors climbed, leaps
  const QI = 2; // 内力: intensity minutes, standing stance
  const MIND = 3; // 心境: daily check-in, daily quests, breathing

  // Total cultivation needed to reach each realm.
  const REALM_XP = [0, 150, 600, 1500, 3500, 7000, 12000, 20000, 32000];

  // Every attribute must hold this share of the next realm's cultivation,
  // so one-sided training stalls the breakthrough.
  const MIN_ATTR_PCT = 12;

  // Breakthrough trial for each target realm: training type and goal.
  // Punch / leap: count within 30 s. Stance: steady seconds. Breath: cycles.
  const TRIAL_TYPE = [0, 2, 0, 3, 1, 2, 0, 1, 3];
  const TRIAL_GOAL = [0, 20, 20, 3, 20, 60, 50, 40, 6];

  // Real-world feats required for the last three realms.
  const PREREQ_STEPS = 12000; // realm 6: steps in one day
  const PREREQ_FLOORS = 15; // realm 7: floors in one day (with a barometer)
  const PREREQ_IM = 45; // realm 7: intensity minutes in one day (without)
  const PREREQ_STREAK = 7; // realm 8: consecutive days with all quests done

  const CHECKIN = 5; // mind for opening the game on a new day
  const QUEST_REWARD = 10; // mind per quest, and again for finishing all three
  const TRAIN_CAP = 60; // training points per type per day

  // Why the next realm is out of reach.
  const BLOCK_NONE = 0;
  const BLOCK_MAX = 1;
  const BLOCK_XP = 2;
  const BLOCK_ATTR = 3;
  const BLOCK_STEPS = 4;
  const BLOCK_FLOORS = 5;
  const BLOCK_STREAK = 6;

  // Daily quest goals grow slowly with the realm: 0 steps, 1 floors (or
  // leaps on watches without a barometer), 2 intensity minutes.
  function questTarget(q as Number, realm as Number, hasFloors as Boolean) as Number {
    if (q == 0) {
      return 5000 + 500 * realm;
    }
    if (q == 1) {
      return hasFloors ? 3 + realm / 2 : 20 + 5 * realm;
    }
    return 10 + 3 * realm;
  }
}
