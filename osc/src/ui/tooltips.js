/**
 * ui/tooltips.js
 * Exports:
 *  - OSC.ui.setHoverTip(on, clientX, clientY, text)
 */
(function(){
  const OSC = (window.OSC = window.OSC || {});
  OSC.ui = OSC.ui || {};

  function setHoverTip(on, clientX, clientY, text){
    const el = (OSC.dom && OSC.dom.elHoverTip) ? OSC.dom.elHoverTip : document.getElementById("hoverTip");
    if (!el) return;
    if (!on){
      el.classList.remove("on");
      return;
    }
    el.textContent = text || "";
    el.style.left = `${Math.min(window.innerWidth - 30, clientX + 14)}px`;
    el.style.top = `${Math.min(window.innerHeight - 30, clientY + 14)}px`;
    el.classList.add("on");
  }

  OSC.ui.setHoverTip = setHoverTip;
})();


