'use strict';

// Sidebar Feature UI:
// - Builds a checkbox list for key computed feature series
// - Persists selection via existing UI config persistence (03_persistence_and_catalog.js)
// - Shows a live readout for hovered (or latest) bar
//
// Depends on globals: `ui`, `state`, `scheduleSaveUiConfig`, `getFeatureSeries`, `FEATURES_onStateUpdated`

(function(){
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function isFiniteNum(x){ return Number.isFinite(Number(x)); }

  function fmtNum(x){
    var v = Number(x);
    if(!Number.isFinite(v)) return '—';
    var av = Math.abs(v);
    if(av !== 0 && av < 1e-4) return v.toExponential(2);
    if(av >= 1000) return v.toFixed(2);
    if(av >= 10) return v.toFixed(4);
    return v.toFixed(6);
  }

  // Catalog of checkbox options.
  // `key` is consumed by getFeatureSeries(key).
  var FEATURE_CATALOG = [
    { group: 'Core', items: [
      { id: 'sigma', label: 'sigma (rolling std of log returns)', key: 'sigma' },
      { id: 'vol_z', label: 'vol_z (short/long sigma ratio)', key: 'vol_z' },
      { id: 'vwap_dev_z', label: 'vwap_dev_z (log(close/vwap)/sigma)', key: 'vwap_dev_z' }
    ]},
    { group: 'Kalman', items: [
      { id: 'kal_level', label: 'kalman.level (price)', key: 'kalman.level' },
      { id: 'kal_slope', label: 'kalman.slope_per_bar', key: 'kalman.slope_per_bar' },
      { id: 'kal_slope_z', label: 'kalman.slope_z', key: 'kalman.slope_z' },
      { id: 'kal_fit_ok', label: 'kalman.fit_ok', key: 'kalman.fit_ok' }
    ]},
    { group: 'OLS (rolling drift)', items: [
      { id: 'ols_mu_k1', label: 'ols.mu_hat.k1', key: 'ols.mu_hat.k1' },
      { id: 'ols_t_k1', label: 'ols.t_stat.k1', key: 'ols.t_stat.k1' },
      { id: 'ols_mu_k3', label: 'ols.mu_hat.k3', key: 'ols.mu_hat.k3' },
      { id: 'ols_mu_k10', label: 'ols.mu_hat.k10', key: 'ols.mu_hat.k10' },
      { id: 'ols_fit_ok', label: 'ols.fit_ok', key: 'ols.fit_ok' }
    ]},
    { group: 'AR(1/2/3)', items: [
      { id: 'ar1_mu', label: 'ar1.mu_hat_k1', key: 'ar.ar1.mu_hat_k1' },
      { id: 'ar1_innov', label: 'ar1.innov_z', key: 'ar.ar1.innov_z' },
      { id: 'ar1_stable', label: 'ar1.is_stable', key: 'ar.ar1.is_stable' },
      { id: 'ar1_margin', label: 'ar1.stability_margin', key: 'ar.ar1.stability_margin' },

      { id: 'ar2_mu', label: 'ar2.mu_hat_k1', key: 'ar.ar2.mu_hat_k1' },
      { id: 'ar2_innov', label: 'ar2.innov_z', key: 'ar.ar2.innov_z' },
      { id: 'ar2_stable', label: 'ar2.is_stable', key: 'ar.ar2.is_stable' },
      { id: 'ar2_margin', label: 'ar2.stability_margin', key: 'ar.ar2.stability_margin' },

      { id: 'ar3_mu', label: 'ar3.mu_hat_k1', key: 'ar.ar3.mu_hat_k1' },
      { id: 'ar3_innov', label: 'ar3.innov_z', key: 'ar.ar3.innov_z' },
      { id: 'ar3_stable', label: 'ar3.is_stable', key: 'ar.ar3.is_stable' },
      { id: 'ar3_margin', label: 'ar3.stability_margin', key: 'ar.ar3.stability_margin' }
    ]},
    { group: 'Classifier (logistic)', items: [
      { id: 'clf_k1_p', label: 'clf.k1.p_up', key: 'clf.k1.p_up' },
      { id: 'clf_k1_ent', label: 'clf.k1.entropy', key: 'clf.k1.entropy' },
      { id: 'clf_k1_brier', label: 'clf.k1.brier', key: 'clf.k1.brier' },

      { id: 'clf_k3_p', label: 'clf.k3.p_up', key: 'clf.k3.p_up' },
      { id: 'clf_k3_ent', label: 'clf.k3.entropy', key: 'clf.k3.entropy' },
      { id: 'clf_k3_brier', label: 'clf.k3.brier', key: 'clf.k3.brier' },

      { id: 'clf_k10_p', label: 'clf.k10.p_up', key: 'clf.k10.p_up' },
      { id: 'clf_k10_ent', label: 'clf.k10.entropy', key: 'clf.k10.entropy' },
      { id: 'clf_k10_brier', label: 'clf.k10.brier', key: 'clf.k10.brier' }
    ]}
  ];

  function ensureSavedState(){
    if(!window.__feature_ui_saved || typeof window.__feature_ui_saved !== 'object'){
      window.__feature_ui_saved = { enabled: true, selected: [] };
    }
    if(!Array.isArray(window.__feature_ui_saved.selected)){
      window.__feature_ui_saved.selected = [];
    }
    if(typeof window.__feature_ui_saved.enabled !== 'boolean'){
      window.__feature_ui_saved.enabled = true;
    }
  }

  function getSelectedSet(){
    ensureSavedState();
    return new Set(window.__feature_ui_saved.selected.map(String));
  }

  function setSelectedFromSet(sel){
    ensureSavedState();
    window.__feature_ui_saved.selected = Array.from(sel.values());
  }

  function setFeatureComputeEnabled(on){
    try{
      if(!window.__feature_cfg_saved || typeof window.__feature_cfg_saved !== 'object') window.__feature_cfg_saved = {};
      window.__feature_cfg_saved.enabled = !!on;
      // Recompute immediately so readout has consistent behavior.
      if(typeof window.FEATURES_onStateUpdated === 'function'){
        window.FEATURES_onStateUpdated({ reason: 'ui-toggle' });
      }
      if(!on && window.state) window.state.features = null;
    } catch(_e){}
  }

  function buildUi(){
    if(typeof window.ui !== 'object') return;
    ensureSavedState();

    // Sync master enable checkbox to saved config (if present).
    try{
      if(window.ui.featEnable && typeof window.ui.featEnable.checked === 'boolean'){
        // Prefer persisted feat_cfg.enabled if present; else saved UI enabled.
        var eff = true;
        if(window.__feature_cfg_saved && typeof window.__feature_cfg_saved.enabled === 'boolean'){
          eff = window.__feature_cfg_saved.enabled;
        } else {
          eff = window.__feature_ui_saved.enabled;
        }
        window.ui.featEnable.checked = !!eff;
      }
    } catch(_e0){}

    // Build checkbox list.
    var host = window.ui.featList;
    if(!host) return;
    host.innerHTML = '';

    var sel = getSelectedSet();
    // If no saved selection, choose a small sensible default.
    if(sel.size === 0){
      ['kalman.slope_z','vwap_dev_z','ols.t_stat.k1','ar.ar1.innov_z','clf.k3.p_up'].forEach(function(k){ sel.add(k); });
      setSelectedFromSet(sel);
    }

    function addGroupTitle(txt){
      var div = document.createElement('div');
      div.className = 'hint';
      div.style.margin = '10px 0 6px 0';
      div.style.fontWeight = '700';
      div.textContent = txt;
      host.appendChild(div);
    }

    function addItem(item){
      var row = document.createElement('label');
      row.className = 'chkRow';
      row.title = item.key;

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = sel.has(item.key);
      input.setAttribute('data-feat-key', item.key);
      input.setAttribute('data-feat-label', item.label);

      var spanLbl = document.createElement('span');
      spanLbl.className = 'chkLbl';
      var name = document.createElement('span');
      name.className = 'chkName';
      name.textContent = item.label;
      spanLbl.appendChild(name);

      row.appendChild(input);
      row.appendChild(spanLbl);
      host.appendChild(row);

      input.addEventListener('change', function(){
        var k = String(input.getAttribute('data-feat-key') || '');
        if(!k) return;
        var sel2 = getSelectedSet();
        if(input.checked) sel2.add(k);
        else sel2.delete(k);
        setSelectedFromSet(sel2);
        try{ if(typeof scheduleSaveUiConfig === 'function') scheduleSaveUiConfig(); } catch(_e){}
        updateReadout();
      });
    }

    for(var gi=0; gi<FEATURE_CATALOG.length; gi++){
      var g = FEATURE_CATALOG[gi];
      addGroupTitle(g.group);
      for(var ii=0; ii<g.items.length; ii++){
        addItem(g.items[ii]);
      }
    }

    // Enable toggle handler
    try{
      if(window.ui.featEnable && window.ui.featEnable.addEventListener){
        window.ui.featEnable.addEventListener('change', function(){
          var on = !!window.ui.featEnable.checked;
          ensureSavedState();
          window.__feature_ui_saved.enabled = on;
          setFeatureComputeEnabled(on);
          try{ if(typeof scheduleSaveUiConfig === 'function') scheduleSaveUiConfig(); } catch(_e){}
          updateReadout();
        });
      }
    } catch(_e1){}
  }

  function getReadoutIdx(){
    try{
      if(!window.state || !Array.isArray(window.state.data) || !window.state.data.length) return -1;
      var n = window.state.data.length;
      var hi = Math.floor(Number(window.state.hoverIdx));
      if(Number.isFinite(hi) && hi >= 0 && hi < n) return hi;
      return n - 1;
    } catch(_e){
      return -1;
    }
  }

  function updateReadout(){
    try{
      if(!window.ui || !window.ui.featReadout) return;
      var pre = window.ui.featReadout;
      var idx = getReadoutIdx();
      if(idx < 0){
        pre.textContent = '—';
        return;
      }

      var enabled = !!(window.ui.featEnable && window.ui.featEnable.checked);
      if(!enabled){
        pre.textContent = 'Feature compute disabled.';
        return;
      }

      // Ensure features are available.
      if(!(window.state && window.state.features)){
        if(typeof window.FEATURES_onStateUpdated === 'function'){
          window.FEATURES_onStateUpdated({ reason: 'readout' });
        }
      }
      if(!(window.state && window.state.features)){
        pre.textContent = 'Features not available yet.';
        return;
      }

      var sel = getSelectedSet();
      if(sel.size === 0){
        pre.textContent = 'No features selected.';
        return;
      }

      var lines = [];
      // Header: timestamp
      try{
        var tms = Number(window.state.data[idx] && window.state.data[idx].t);
        if(Number.isFinite(tms)){
          lines.push('t: ' + new Date(tms).toISOString().replace('.000Z','Z'));
        }
      } catch(_eHdr){}

      // Resolve label for key
      var labelByKey = Object.create(null);
      for(var gi=0; gi<FEATURE_CATALOG.length; gi++){
        var items = FEATURE_CATALOG[gi].items || [];
        for(var ii=0; ii<items.length; ii++){
          labelByKey[items[ii].key] = items[ii].label;
        }
      }

      sel.forEach(function(k){
        var series = (typeof window.getFeatureSeries === 'function') ? window.getFeatureSeries(k) : null;
        var v = (series && Array.isArray(series) && idx < series.length) ? series[idx] : NaN;
        var lbl = labelByKey[k] || k;
        lines.push(lbl + ': ' + fmtNum(v));
      });

      pre.textContent = lines.join('\n');
    } catch(_e){
      try{
        if(window.ui && window.ui.featReadout) window.ui.featReadout.textContent = 'Readout error.';
      } catch(_e2){}
    }
  }

  // Keep readout in sync with hover index changes.
  var _lastIdx = -999;
  function tick(){
    try{
      var idx = getReadoutIdx();
      if(idx !== _lastIdx){
        _lastIdx = idx;
        updateReadout();
      }
    } catch(_e){}
    requestAnimationFrame(tick);
  }

  // Boot
  try{
    buildUi();
    updateReadout();
    requestAnimationFrame(tick);
  } catch(_eBoot){}
})();


