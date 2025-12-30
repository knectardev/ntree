/**
 * synth.js
 * Exports:
 *  - OSC.synth.mulberry32(seed)
 *  - OSC.synth.genSeries(days, seed)
 *  - OSC.synth.resampleCandles(dayCandles1m, tfMin)
 *  - OSC.synth.flattenDays(daysTf)
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});
  OSC.synth = OSC.synth || {};

  const { MINUTES_PER_DAY } = OSC.config;

  function mulberry32(seed){
    let t = seed >>> 0;
    return function(){
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function genDayCandles1m(seed, startPrice=100){
    const rnd = mulberry32(seed);
    let p = startPrice;
    const out = [];
    for(let i=0;i<MINUTES_PER_DAY;i++){
      const dir = rnd() < 0.5 ? -1 : 1;
      const step = (0.04 + rnd()*0.12) * dir; // small random walk
      const o = p;
      const c = p + step;
      const hi = Math.max(o,c) + rnd()*0.10;
      const lo = Math.min(o,c) - rnd()*0.10;
      out.push({o,h:hi,l:lo,c});
      p = c;
    }
    return {candles: out, endPrice: p};
  }

  function genSeries(days, seed){
    const daysArr = [];
    let p = 100;
    for(let d=0; d<days; d++){
      const day = genDayCandles1m(seed + d*97, p);
      daysArr.push(day.candles);
      p = day.endPrice;
    }
    return daysArr;
  }

  function resampleCandles(dayCandles1m, tfMin){
    if (tfMin <= 1) return dayCandles1m.map(c=>({...c}));
    const out = [];
    for(let i=0;i<dayCandles1m.length;i+=tfMin){
      const chunk = dayCandles1m.slice(i, i+tfMin);
      if (!chunk.length) continue;
      const o = chunk[0].o;
      const c = chunk[chunk.length-1].c;
      let h = -Infinity, l = Infinity;
      for (const k of chunk){ h = Math.max(h, k.h); l = Math.min(l, k.l); }
      out.push({o,h,l,c});
    }
    return out;
  }

  function flattenDays(daysTf){
    const flat = [];
    const dayStartIdx = [];
    let idx = 0;
    for (let d=0; d<daysTf.length; d++){
      dayStartIdx.push(idx);
      for (const c of daysTf[d]){ flat.push(c); idx++; }
    }
    return {flat, dayStartIdx};
  }

  OSC.synth.mulberry32 = mulberry32;
  OSC.synth.genSeries = genSeries;
  OSC.synth.resampleCandles = resampleCandles;
  OSC.synth.flattenDays = flattenDays;
})();


