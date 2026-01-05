'use strict';

  // Continuous detrend + oscillation scan (UI only): dial widgets
  // Ported from osc demo, but intentionally NOT wired into analysis yet.
  (function(){
    function clamp01(v){ return Math.max(0, Math.min(1, v)); }
    function getCSS(name){
      try{ return String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim(); }
      catch(_e){ return ''; }
    }
    function fmtLookbackShort(min){
      var m = Math.max(0, Math.round(Number(min) || 0));
      if(m < 60) return String(m) + 'm';
      if(m % 60 === 0){
        var h = m/60;
        if(h < 24) return String(h) + 'h';
        var d = h/24;
        return (Number.isInteger(d) ? d : d.toFixed(1)) + 'd';
      }
      return (m/60).toFixed(1) + 'h';
    }

    // Minimal dial implementation (canvas knob + pointer interactions)
    function createDial(opts){
      var canvas = opts.canvas;
      if(!canvas) return null;
      var min = Number(opts.min);
      var max = Number(opts.max);
      var step = Number(opts.step || 1);
      var format = opts.format || function(v){ return String(v); };
      var onChange = opts.onChange || function(){};
      var colorVar = opts.colorVar || '';
      var color = opts.color || '';

      // 270° sweep centered at bottom (like many audio knobs)
      var TWO_PI = Math.PI * 2;
      // Work in an "unwrapped" [0, 2π) space so pointer angles from atan2() can cover the full sweep.
      // Note: atan2 returns [-π, π], so any sweep starting below -π would be unreachable without this normalization.
      var START0 = (-225) * Math.PI/180;
      var END0   = (  45) * Math.PI/180;
      var START = ((START0 % TWO_PI) + TWO_PI) % TWO_PI; // 135°
      var END   = ((END0 % TWO_PI) + TWO_PI) % TWO_PI;   // 45°
      if(END <= START) END += TWO_PI; // unwrap across 0°
      var SWEEP = END - START;
      var ctx = canvas.getContext('2d');

      function snap(v){
        var s = step > 0 ? step : 1;
        return Math.round(v / s) * s;
      }
      function valueToAngle(v){
        var t = (clamp(v, min, max) - min) / (max - min || 1);
        return START + t * SWEEP;
      }
      function angleToValue(a){
        var aa = a;
        // Normalize atan2() output to [0, 2π).
        if(aa < 0) aa += TWO_PI;

        // This dial has a 270° sweep with a 90° "dead zone" (no values).
        // If the pointer lands in the dead zone, clamp to the nearest endpoint instead of wrapping,
        // otherwise values can jump from min to max when crossing the gap.
        var endMod = END % TWO_PI;   // END folded into [0, 2π)
        var startMod = START;        // START is already in [0, 2π)
        if(endMod < startMod){
          // Sweep crosses 0°, so the dead zone is (endMod, startMod).
          if(aa > endMod && aa < startMod){
            var dToEnd = aa - endMod;
            var dToStart = startMod - aa;
            return (dToStart <= dToEnd) ? snap(min) : snap(max);
          }
        }

        // Unwrap into the [START, END] interval when the sweep crosses 0°.
        if(aa < START) aa += TWO_PI;
        // Hard clamp to sweep endpoints (safety).
        if(aa < START) aa = START;
        if(aa > END) aa = END;
        var t = (aa - START) / (SWEEP || 1);
        t = clamp01(t);
        return snap(min + t * (max - min));
      }

      function dialColor(){
        if(color) return color;
        if(colorVar) return getCSS(colorVar) || 'rgba(90,150,255,.95)';
        return 'rgba(90,150,255,.95)';
      }

      function draw(v){
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        // If the section is collapsed, the canvas can be 0×0; skip until visible.
        if(!(rect.width > 0 && rect.height > 0)) return;

        var size = Math.max(1, Math.floor(rect.width * dpr));
        if(canvas.width !== size || canvas.height !== size){
          canvas.width = size;
          canvas.height = size;
        }
        ctx.setTransform(1,0,0,1,0,0);
        ctx.scale(dpr, dpr);

        var w = rect.width, h = rect.height;
        var cx = w/2, cy = h/2;
        var r = Math.min(w,h)*0.42;

        ctx.clearRect(0,0,w,h);

        // base ring
        ctx.save();
        ctx.lineWidth = Math.max(10, r*0.14);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, START, END, false);
        ctx.stroke();

        // value ring
        var a = valueToAngle(v);
        ctx.strokeStyle = dialColor();
        ctx.beginPath();
        ctx.arc(cx, cy, r, START, a, false);
        ctx.stroke();

        // tick dots
        var ticks = 9;
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        for(var i=0; i<=ticks; i++){
          var tt = i / ticks;
          var ang = START + tt*SWEEP;
          var tx = cx + Math.cos(ang) * (r + ctx.lineWidth*0.25);
          var ty = cy + Math.sin(ang) * (r + ctx.lineWidth*0.25);
          ctx.beginPath();
          ctx.arc(tx, ty, 1.5, 0, Math.PI*2);
          ctx.fill();
        }

        // knob center
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, r*0.78, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // pointer
        ctx.strokeStyle = dialColor();
        ctx.lineWidth = 3;
        var px = cx + Math.cos(a) * (r*0.90);
        var py = cy + Math.sin(a) * (r*0.90);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // value text
        ctx.fillStyle = getCSS('--text') || 'rgba(215,224,234,.92)';
        ctx.font = '800 18px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(format(v), cx, cy + r*0.55);

        ctx.restore();
      }

      var value = snap(clamp(Number(opts.value), min, max));
      function setValue(v, fire){
        if(fire === undefined) fire = true;
        var nv = snap(clamp(Number(v), min, max));
        if(nv === value) return;
        value = nv;
        draw(value);
        if(fire) onChange(value);
      }

      function pointerToAngle(ev){
        var rect = canvas.getBoundingClientRect();
        var x = (ev.clientX - rect.left) - rect.width/2;
        var y = (ev.clientY - rect.top)  - rect.height/2;
        return Math.atan2(y, x);
      }

      var dragging = false;
      function onPointerDown(ev){
        dragging = true;
        canvas.setPointerCapture(ev.pointerId);
        setValue(angleToValue(pointerToAngle(ev)), true);
      }
      function onPointerMove(ev){
        if(!dragging) return;
        setValue(angleToValue(pointerToAngle(ev)), true);
      }
      function onPointerUp(ev){
        dragging = false;
        try{ canvas.releasePointerCapture(ev.pointerId); } catch(_e){}
      }

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);

      canvas.addEventListener('wheel', function(ev){
        ev.preventDefault();
        var dir = ev.deltaY > 0 ? -1 : 1;
        setValue(value + dir*step, true);
      }, {passive:false});

      // initial draw (may be skipped if collapsed)
      draw(value);

      return {
        get value(){ return value; },
        setValue: setValue,
        redraw: function(){ draw(value); }
      };
    }

    var details = document.querySelector('details.sideCard[aria-label="Continuous detrend + oscillation scan"]');
    var detrendCanvas = document.getElementById('detrendDial');
    var scanCanvas = document.getElementById('scanDial');
    var detrendInput = document.getElementById('detrendHours');
    var scanInput = document.getElementById('scanWindow');
    var detrendLabel = document.getElementById('detrendLabel');
    var scanLabel = document.getElementById('scanLabel');
    if(!detrendCanvas || !scanCanvas || !detrendInput || !scanInput) return;

    function updateLabels(){
      var dh = Number(detrendInput.value);
      if(!Number.isFinite(dh)) dh = 2.0;
      var sw = Math.round(Number(scanInput.value) || 780);
      if(detrendLabel) detrendLabel.textContent = (dh).toFixed(1) + 'h';
      if(scanLabel) scanLabel.textContent = fmtLookbackShort(sw);
    }

    // Create dials (UI-only: update labels/hidden inputs)
    var detrendDial = createDial({
      canvas: detrendCanvas,
      min: 0.0,
      max: 8.0,
      step: 0.25,
      value: (function(){
        var v = Number(detrendInput.value);
        return Number.isFinite(v) ? v : 2.0;
      })(),
      color: 'rgba(122,227,255,0.95)',
      format: function(v){ return Number(v).toFixed(1) + 'h'; },
      onChange: function(v){
        detrendInput.value = Number(v).toFixed(2);
        updateLabels();
        try{ requestDraw('detrend'); } catch(_e){ try{ draw(); } catch(_e2){} }
      }
    });

    var scanDial = createDial({
      canvas: scanCanvas,
      min: 120,
      max: 14400, // MINUTES_PER_DAY*10 (UI-only mirror)
      step: 30,
      value: Math.round(Number(scanInput.value) || 780),
      color: 'rgba(255,209,102,0.95)',
      format: function(v){ return fmtLookbackShort(v); },
      onChange: function(v){
        scanInput.value = String(Math.round(Number(v)));
        updateLabels();
      }
    });

    // If the section starts collapsed, redraw on open so canvases have real sizes.
    function redrawIfVisible(){
      try{ if(detrendDial) detrendDial.redraw(); } catch(_e){}
      try{ if(scanDial) scanDial.redraw(); } catch(_e){}
    }
    if(details){
      details.addEventListener('toggle', function(){
        if(details.open) redrawIfVisible();
      });
    }
    window.addEventListener('resize', redrawIfVisible);
    updateLabels();
  })();

  window.addEventListener('resize', resize);
  requestAnimationFrame(resize);
