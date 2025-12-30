/**
 * detrend.js
 * Exports:
 *  - OSC.detrend.detrendRollingLinear(closes, win)
 *  - OSC.detrend.smaRolling(closes, win)
 *  - OSC.detrend.computeSlopeSigmaPerHr(closes, detrendHours)
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});
  OSC.detrend = OSC.detrend || {};

  const { clamp } = OSC.utils;

  function detrendRollingLinear(closes, win){
    const N = closes.length;
    const w = clamp(Math.floor(win), 5, N);
    const out = new Array(N).fill(0);

    for (let i=0; i<N; i++){
      const start = clamp(i - w + 1, 0, N-1);
      const end = i;
      const nn = end - start + 1;

      const sX = (nn-1)*nn/2;
      const sX2 = (nn-1)*nn*(2*nn-1)/6;

      let sY = 0, sXY = 0;
      for (let j=0; j<nn; j++){
        const y = closes[start + j];
        sY += y;
        sXY += j * y;
      }

      const denom = (nn * sX2 - sX*sX) || 1e-9;
      const a = (nn*sXY - sX*sY) / denom;
      const b = (sY - a*sX) / nn;
      const yhat = a*(nn-1) + b;
      out[i] = closes[i] - yhat;
    }
    return out;
  }

  function smaRolling(closes, win){
    const N = closes.length;
    const w = clamp(Math.floor(win), 1, N);
    const out = new Array(N).fill(0);
    let sum = 0;
    for (let i=0; i<N; i++){
      sum += closes[i];
      if (i >= w) sum -= closes[i-w];
      const denom = Math.min(i+1, w);
      out[i] = sum/denom;
    }
    return out;
  }

  function computeSlopeSigmaPerHr(closes, detrendHours){
    const L = clamp(Math.floor(detrendHours*60), 30, closes.length);
    const tail = closes.slice(closes.length - L);
    const N = tail.length;
    if (N < 2) return null;

    let sX=0,sY=0,sXY=0,sX2=0;
    for (let i=0; i<N; i++){
      const x=i;
      const y=tail[i];
      sX+=x; sY+=y; sXY+=x*y; sX2+=x*x;
    }
    const denom = (N*sX2 - sX*sX) || 1e-9;
    const slopePerMin = (N*sXY - sX*sY)/denom;

    const b = (sY - slopePerMin*sX)/N;
    let ss=0;
    for (let i=0; i<N; i++){
      const yhat = slopePerMin*i + b;
      const e = tail[i]-yhat;
      ss += e*e;
    }
    const sigma = Math.sqrt(ss / Math.max(1, N));
    const sigmaPerHr = sigma * Math.sqrt(60);
    const slopePerHr = slopePerMin * 60;

    const sigmaSafe = sigmaPerHr || 1e-9;
    return (slopePerHr / sigmaSafe);
  }

  OSC.detrend.detrendRollingLinear = detrendRollingLinear;
  OSC.detrend.smaRolling = smaRolling;
  OSC.detrend.computeSlopeSigmaPerHr = computeSlopeSigmaPerHr;
})();


