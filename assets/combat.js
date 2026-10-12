/* 戰鬥公式模組（純函式、無 DOM）。公式出自 1.15.3 客戶端 CalcDamage（研究筆記第三十四節），
 * 玩家物理／魔法／命中、怪打玩家物理／魔法／閃避都已用 unicorn 實跑的客戶端輸出對拍過。
 * rng：可注入的函式，每呼叫一次回傳一個 0～9999999 的整數（等同客戶端 CRand32 的 r % 10^7）；
 * 不給就用 Math.random。每個「擲骰」各呼叫一次（傷害、防禦、暴擊、命中各一次）。
 * 標「推定」的地方客戶端查不到，照研究筆記的推定做。 */
(function (root) {
  'use strict';

  var RNG_RANGE = 10000000;

  function defaultRng() { return Math.floor(Math.random() * RNG_RANGE); }
  function roll(rng) { return ((rng || defaultRng)() % RNG_RANGE) / RNG_RANGE; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  // 客戶端結果夾 1～199999 後取整（已 >= 1，floor 與截斷同義）
  function finalize(v) { return Math.floor(Math.max(1, Math.min(199999, v))); }

  /* ---- 屬性倍率 ----
   * 怪 elemAttr 字串如 "F2I3"：字母 = 屬性、數字 = 1 免疫／2 抗性／3 弱點。
   * 免疫：倍率 0，最後夾到最低傷害 1（推定：筆記寫「1 免疫 → 1」）。 */
  var ELEM_MULT = { 1: 0, 2: 0.5, 3: 1.5 };

  function elemLevel(mobElemAttr, skillElem) {
    if (!mobElemAttr || !skillElem) return 0;
    var re = /([A-Za-z])(\d)/g, m;
    while ((m = re.exec(String(mobElemAttr)))) {
      if (m[1].toUpperCase() === String(skillElem).toUpperCase()) return +m[2];
    }
    return 0;
  }
  function elemMultiplier(mobElemAttr, skillElem) {
    var lv = typeof mobElemAttr === 'number' ? mobElemAttr : elemLevel(mobElemAttr, skillElem);
    return ELEM_MULT.hasOwnProperty(lv) ? ELEM_MULT[lv] : 1;
  }

  /* ---- 玩家打怪 ---- */

  // 攻擊力範圍（第三十節，單手劍系的 4.0 係數；weaponMul 可換）
  function physRange(pad, str, dex, mastery, weaponMul) {
    var k = weaponMul == null ? 4.0 : weaponMul;
    var mx = pad * (str * k + dex) / 100;
    var mn = pad * (dex + (5 * mastery + 10) / 100 * 0.9 * k * str) / 100;
    return { min: mn, max: mx };
  }

  /* playerPhysDamage(攻擊最小, 攻擊最大, 玩家等級, 怪等級, 怪PDD, 技能%, 怪elemAttr, 技能屬性, 暴擊技能%, rng, opt)
   * opt.critProp：暴擊率 %（預設 0）；opt.totalPct：總傷害 %（+100 → ×2）。
   * 回傳 { dmg, crit }。 */
  function playerPhysDamage(atkMin, atkMax, playerLv, mobLv, mobPdd, skillPct, mobElem, skillElem, critPct, rng, opt) {
    opt = opt || {};
    var f = roll(rng);
    var base = atkMin + (atkMax - atkMin) * f;
    base *= (1 - 0.01 * Math.max(0, mobLv - playerLv));
    var f2 = roll(rng);
    var v = base - mobPdd * (0.5 + 0.1 * f2);
    v = v * skillPct / 100;
    v *= elemMultiplier(mobElem, skillElem);
    var crit = false;
    if (critPct && opt.critProp > 0 && roll(rng) * 100 < opt.critProp) { crit = true; v *= critPct / 100; }
    if (opt.totalPct) v *= 1 + opt.totalPct / 100;
    return { dmg: finalize(v), crit: crit };
  }

  /* playerMagicDamage(魔攻, 熟練, INT, 技能mad, 怪MDD, 怪elemAttr, 技能屬性, rng, opt) → { dmg, crit:false }
   * 熟練 = 技能等級資料的 mastery（0～20）。LUK 不影響傷害；怪等級不扣傷害。 */
  function playerMagicDamage(mad, mastery, intStat, skillMad, mobMdd, mobElem, skillElem, rng, opt) {
    opt = opt || {};
    var lo = mad * (5 * mastery + 10) / 100 * 0.9, hi = mad;
    var f = roll(rng);
    var u = lo + (hi - lo) * f;
    var v = (3.3 * u + Math.pow(0.058 * mad, 2) + 0.5 * intStat) * skillMad / 100;
    var f2 = roll(rng);
    v = v - mobMdd * (0.5 + 0.1 * f2);
    v *= elemMultiplier(mobElem, skillElem);
    if (opt.totalPct) v *= 1 + opt.totalPct / 100;
    return { dmg: finalize(v), crit: false };
  }

  // 物理命中：ACC × U(0.7,1.3) ≥ 怪迴避 × (2.55 + 0.1 × max(0, 等級差))；等級差 = 怪等級 − 角色等級
  function playerHit(acc, mobEva, levelDiff, rng) {
    var t = mobEva * (2.55 + 0.1 * Math.max(0, levelDiff));
    var v = acc * (0.7 + 0.6 * roll(rng));
    return v >= t;
  }
  // 物理命中率（0～1），給 UI 顯示用
  function playerHitRate(acc, mobEva, levelDiff) {
    var t = mobEva * (2.55 + 0.1 * Math.max(0, levelDiff));
    if (acc <= 0) return 0;
    return clamp((1.3 * acc - t) / (0.6 * acc), 0, 1);
  }

  // 魔法命中：怪迴避 ≤ (INT+LUK)/2 × 100 / (255 + 10×等級差) × U(0.5,1.2)
  // 等級差只算怪比角色高的部分（跟物理一樣 max(0, 差)；負的沒驗，推定）。不夾的話怪低 26 級以上分母變負、必 MISS。
  function playerMagicHit(intStat, luk, mobEva, levelDiff, rng) {
    var lim = (intStat + luk) / 2 * 100 / (255 + 10 * Math.max(0, levelDiff)) * (0.5 + 0.7 * roll(rng));
    return mobEva <= lim;
  }

  /* ---- 怪打玩家 ---- */

  // StandardPDD：table[職業群][等級]（稀疏），取最近的較低等級值（插值方式沒追，推定）；比最低等級還低就用最低級
  function standardPdd(table, jobGroup, level) {
    var row = table && (table[jobGroup] || table[String(jobGroup)]);
    if (!row) return 0;
    var best = null, lowest = null;
    Object.keys(row).forEach(function (k) {
      var lv = +k;
      if (lowest === null || lv < lowest) lowest = lv;
      if (lv <= level && (best === null || lv > best)) best = lv;
    });
    if (best === null) best = lowest;
    return best === null ? 0 : row[best];
  }

  /* mobPhysDamage(怪PAD, 玩家PDD, StandardPDD, {str,dex,int,luk}, 玩家等級, 等級差(怪−玩家), 是否劍士, rng)
   * 碰撞（bodyAttack）走同一支，PAD 傳 info/PADamage。 */
  function mobPhysDamage(mobPad, playerPdd, std, stats, playerLv, levelDiff, isWarrior, rng) {
    var w = !!isWarrior;
    var st = Math.trunc(stats.str / (w ? 3.5 : 2.5) + stats.dex / (w ? 4.0 : 3.5) + stats.int / 9 + stats.luk * 0.25);
    var lo = 0.80 * mobPad, hi = 0.85 * mobPad;
    var u = lo + (hi - lo) * roll(rng);
    var base = mobPad * u / 100;
    var b = 0.28 + st / 800;
    var D;
    if (playerPdd >= std) {
      var a = 0.28 + st / 900 + playerLv / 1300;
      D = playerPdd * b + 0.7 * (playerPdd - std) * a;
    } else {
      var c = 0.28 + st / 800 + playerLv / 550;
      var x = 1.3 * (playerPdd - std) * c;
      if (levelDiff <= 0) x = x * 10 / (13 - levelDiff);   // 角色等級 ≥ 怪等級
      D = playerPdd * b + x;
    }
    return finalize(base - D);
  }

  // mobMagicDamage(怪MAD, 玩家MDD, STR, DEX, LUK, 職業(id，法師群 2xx 用 0.3), rng)
  function mobMagicDamage(mobMad, playerMdd, str, dex, luk, job, rng) {
    var lo = 0.75 * mobMad, hi = 0.80 * mobMad;
    var u = lo + (hi - lo) * roll(rng);
    var base = mobMad * u / 100;
    var isMage = Math.floor(job / 100) % 10 === 2;
    var D = (playerMdd + str / 7 + dex / 6 + luk / 5) * (isMage ? 0.3 : 0.25);
    return finalize(base - D);
  }

  // 玩家閃避率（%）：clamp((EVA − max(0,等級差)/2) / (怪ACC×4.5) × 100, 2, 80)；盜賊 5～95
  function playerDodgeRate(eva, mobAcc, levelDiff, isThief) {
    var r = (eva - Math.max(0, levelDiff) / 2) / (mobAcc * 4.5) * 100;
    return isThief ? clamp(r, 5, 95) : clamp(r, 2, 80);
  }
  // mobHitChance：怪打中玩家的機率（%）= 100 − 閃避率
  function mobHitChance(eva, mobAcc, levelDiff, isThief) {
    return 100 - playerDodgeRate(eva, mobAcc, levelDiff, isThief);
  }
  // 單次判定：true = 被玩家閃掉（客戶端 be0ea63c 回 1）。擲骰 % < 閃避率
  function mobAttackDodged(eva, mobAcc, levelDiff, isThief, rng) {
    return roll(rng) * 100 < playerDodgeRate(eva, mobAcc, levelDiff, isThief);
  }

  /* ---- 怪走速（像素／秒）---- */
  // 走速 = 1.25 × (speed+100)（乘法推定；下限 0）。客戶端模板另有 clamp(speed+100, 0, 140) 上限，
  // 但筆記的驗算例（speed 60 → 200）沒套上限，這裡照驗算例；要套上限傳 capped = true
  function mobWalkSpeed(speed, capped) { return 1.25 * Math.min(Math.max(speed + 100, 0), capped ? 140 : Infinity); }
  // 飛行怪：(flySpeed+100)/100 × 物理 flySpeed 200（推定）
  function mobFlySpeed(flySpeed, capped) { return 2.0 * Math.min(Math.max(flySpeed + 100, 0), capped ? 140 : Infinity); }

  var api = {
    ELEM_MULT: ELEM_MULT, elemLevel: elemLevel, elemMultiplier: elemMultiplier,
    physRange: physRange,
    playerPhysDamage: playerPhysDamage, playerMagicDamage: playerMagicDamage,
    playerHit: playerHit, playerHitRate: playerHitRate, playerMagicHit: playerMagicHit,
    standardPdd: standardPdd, mobPhysDamage: mobPhysDamage, mobMagicDamage: mobMagicDamage,
    playerDodgeRate: playerDodgeRate, mobHitChance: mobHitChance, mobAttackDodged: mobAttackDodged,
    mobWalkSpeed: mobWalkSpeed, mobFlySpeed: mobFlySpeed
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Combat = api;
})(typeof self !== 'undefined' ? self : this);
