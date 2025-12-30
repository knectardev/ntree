/**
 * ui/dials.js
 * Exports:
 *  - OSC.ui.createDial(opts)
 * No dependencies on app state; calls provided onChange(value).
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});
  OSC.ui = OSC.ui || {};

  const { clamp, clamp01, getCSS } = OSC.utils;

  // Renders a circular "hardware knob" dial on a canvas and wires pointer + wheel interactions.
  function createDial(opts){
    const canvas = opts.canvas;
    const min = Number(opts.min);
    const max = Number(opts.max);
    const step = Number(opts.step || 1);
    const format = opts.format || (v => String(v));
    const onChange = opts.onChange || (()=>{});
    const colorVar = opts.colorVar || "--accent";

    // 270° sweep centered at bottom (like many audio knobs)
    const START = (-225) * Math.PI/180; // radians
    const END   = (  45) * Math.PI/180; // radians
    const SWEEP = END - START;

    const ctx = canvas.getContext("2d");

    function snap(v){
      const s = step > 0 ? step : 1;
      return Math.round(v / s) * s;
    }

    function valueToAngle(v){
      const t = (clamp(v, min, max) - min) / (max - min || 1);
      return START + t * SWEEP;
    }

    function angleToValue(a){
      // `Math.atan2` returns [-π..π], but our sweep START is -225° (equivalent to +135°).
      // Normalize the pointer angle into the same continuous range as the sweep so we don't
      // "jump to max" when the pointer angle crosses the +π/-π boundary.
      const TWO_PI = Math.PI * 2;
      let aa = a;
      while (aa > END) aa -= TWO_PI;
      while (aa < START) aa += TWO_PI;

      let t = (aa - START) / (SWEEP || 1);
      t = clamp01(t);
      const v = min + t * (max - min);
      return snap(v);
    }

    function draw(v){
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const size = Math.max(1, Math.floor(rect.width * dpr));
      if (canvas.width !== size || canvas.height !== size){
        canvas.width = size;
        canvas.height = size;
      }
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const cx = w/2, cy = h/2;
      const r = Math.min(w,h)*0.42;

      ctx.clearRect(0,0,w,h);

      // base ring
      ctx.save();
      ctx.lineWidth = Math.max(10, r*0.14);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, START, END, false);
      ctx.stroke();

      // value ring
      const a = valueToAngle(v);
      ctx.strokeStyle = getCSS(colorVar);
      ctx.beginPath();
      ctx.arc(cx, cy, r, START, a, false);
      ctx.stroke();

      // tick dots (subtle)
      const ticks = 9;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      for (let i=0; i<=ticks; i++){
        const tt = i / ticks;
        const ang = START + tt*SWEEP;
        const tx = cx + Math.cos(ang) * (r + ctx.lineWidth*0.25);
        const ty = cy + Math.sin(ang) * (r + ctx.lineWidth*0.25);
        ctx.beginPath();
        ctx.arc(tx, ty, 1.5, 0, Math.PI*2);
        ctx.fill();
      }

      // knob center
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, r*0.78, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // pointer
      ctx.strokeStyle = getCSS(colorVar);
      ctx.lineWidth = 3;
      const px = cx + Math.cos(a) * (r*0.90);
      const py = cy + Math.sin(a) * (r*0.90);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();

      // value text
      ctx.fillStyle = getCSS("--fg");
      ctx.font = "800 18px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(format(v), cx, cy + r*0.55);

      ctx.restore();
    }

    let value = snap(clamp(Number(opts.value), min, max));

    function setValue(v, fire=true){
      const nv = snap(clamp(Number(v), min, max));
      if (nv === value) return;
      value = nv;
      draw(value);
      if (fire) onChange(value);
    }

    function pointerToAngle(ev){
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) - rect.width/2;
      const y = (ev.clientY - rect.top)  - rect.height/2;
      return Math.atan2(y, x);
    }

    let dragging = false;

    function onPointerDown(ev){
      dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      setValue(angleToValue(pointerToAngle(ev)), true);
    }

    function onPointerMove(ev){
      if (!dragging) return;
      setValue(angleToValue(pointerToAngle(ev)), true);
    }

    function onPointerUp(ev){
      dragging = false;
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // scroll wheel nudge
    canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const dir = ev.deltaY > 0 ? -1 : 1;
      setValue(value + dir*step, true);
    }, {passive:false});

    // initial draw
    draw(value);

    return {
      get value(){ return value; },
      setValue,
      redraw(){ draw(value); }
    };
  }

  OSC.ui.createDial = createDial;
})();


