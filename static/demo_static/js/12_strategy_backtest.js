'use strict';

(function() {
    // Dropdown elements
    const strategyDD = document.getElementById('strategyDD');
    const strategyBtn = document.getElementById('strategyBtn');
    const strategyLabel = document.getElementById('strategyLabel');
    const strategyMenu = document.getElementById('strategyMenu');
    const strategyDesc = document.getElementById('strategyDesc');

    const btConfigDD = document.getElementById('btConfigDD');
    const btConfigBtn = document.getElementById('btConfigBtn');
    const btConfigLabel = document.getElementById('btConfigLabel');
    const btConfigMenu = document.getElementById('btConfigMenu');

    const runBacktestBtn = document.getElementById('runBacktestBtn');
    const resultsBox = document.getElementById('strategyResults');
    const showExecMarkersChk = document.getElementById('showExecMarkers');
    const execLegend = document.getElementById('execLegend');

    const backtestState = {
        configs: [],
        running: false,
        selectedStrategy: 'none',
        selectedConfigId: '',
        strategyMeta: {}, // { name: {display_name, description, enabled} }
        // Backtest-time artifacts (populated only after running a backtest)
        executionEvents: [],
        executionEventsStrategy: null,
        executionEventsTicker: null,
        executionEventsInterval: null,
        showExecutionMarkers: true,
    };

    // Expose to window.state for renderer
    if (window.state) {
        window.state.backtest = backtestState;
    }

    // Toggle: show/hide execution markers (backtest-time artifacts).
    if (showExecMarkersChk) {
        showExecMarkersChk.checked = true;
        backtestState.showExecutionMarkers = true;
        showExecMarkersChk.addEventListener('change', () => {
            backtestState.showExecutionMarkers = !!showExecMarkersChk.checked;
            if (typeof window.requestDraw === 'function') window.requestDraw('toggle_exec_markers');
        });
    }

    // Generic dropdown toggle logic
    function setupDropdown(dd, btn, menu, onSelect) {
        if (!dd || !btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dd.classList.toggle('open');
            btn.setAttribute('aria-expanded', isOpen);
            
            // Close other dropdowns
            if (isOpen) {
                [strategyDD, btConfigDD].forEach(other => {
                    if (other && other !== dd) {
                        other.classList.remove('open');
                        const otherBtn = other.querySelector('.ddBtn');
                        if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
                    }
                });
            }
        });

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.ddItem');
            if (!item) return;

            const val = item.getAttribute('data-value');
            const text = item.textContent;

            // Update UI
            menu.querySelectorAll('.ddItem').forEach(i => i.classList.remove('sel'));
            item.classList.add('sel');
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');

            if (onSelect) onSelect(val, text, item);
        });
    }

    // Initialize dropdowns
    setupDropdown(strategyDD, strategyBtn, strategyMenu, (val, text, item) => {
        backtestState.selectedStrategy = val;
        // Strategy selection is "intent-time"; clear any stale execution-time artifacts.
        backtestState.executionEvents = [];
        backtestState.executionEventsStrategy = null;
        backtestState.executionEventsTicker = null;
        backtestState.executionEventsInterval = null;
        if (execLegend) execLegend.style.display = 'none';
        strategyLabel.textContent = text;
        const desc = item ? (item.getAttribute('data-desc') || '') : '';
        if (strategyDesc) {
            if (desc) {
                strategyDesc.textContent = desc;
                strategyDesc.style.display = 'block';
            } else {
                strategyDesc.textContent = '';
                strategyDesc.style.display = 'none';
            }
        }
        if (resultsBox) resultsBox.style.display = 'none';
        if (typeof window.loadFromAPI === 'function') window.loadFromAPI();
    });

    setupDropdown(btConfigDD, btConfigBtn, btConfigMenu, (val, text) => {
        backtestState.selectedConfigId = val;
        btConfigLabel.textContent = text;
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
        [strategyDD, btConfigDD].forEach(dd => {
            if (dd) {
                dd.classList.remove('open');
                const btn = dd.querySelector('.ddBtn');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            }
        });
    });

    async function loadBacktestConfigs() {
        try {
            const resp = await fetch('/api/backtest-configs');
            const data = await resp.json();
            backtestState.configs = Array.isArray(data) ? data : [];
            
            if (btConfigMenu) {
                // Keep default option
                btConfigMenu.innerHTML = '<div class="ddItem sel" role="option" data-value="">Default (risk 0.5%, RR 2.0, fee 0)</div>';
                
                backtestState.configs.forEach(cfg => {
                    const item = document.createElement('div');
                    item.className = 'ddItem';
                    item.setAttribute('role', 'option');
                    item.setAttribute('data-value', cfg.id);
                    item.textContent = `${cfg.name} (R:${cfg.risk_percent}% / RR:${cfg.reward_multiple})`;
                    btConfigMenu.appendChild(item);
                });
            }
        } catch (e) {
            console.warn('Failed to load backtest configs', e);
        }
    }

    async function loadStrategies() {
        try {
            const resp = await fetch('/api/strategies');
            const data = await resp.json();
            const strategies = Array.isArray(data) ? data : [];
            if (!strategies.length) return;
            backtestState.strategyMeta = {};

            if (strategyMenu) {
                strategyMenu.innerHTML = '';
                const noneItem = document.createElement('div');
                noneItem.className = 'ddItem sel';
                noneItem.setAttribute('role', 'option');
                noneItem.setAttribute('data-value', 'none');
                noneItem.textContent = 'None';
                strategyMenu.appendChild(noneItem);

                strategies.forEach(s => {
                    const item = document.createElement('div');
                    item.className = 'ddItem';
                    item.setAttribute('role', 'option');
                    item.setAttribute('data-value', s.name);
                    item.setAttribute('data-desc', s.description || '');
                    item.title = s.description || '';
                    item.textContent = s.display_name || s.name;
                    strategyMenu.appendChild(item);
                    backtestState.strategyMeta[s.name] = s;
                });
            }

            // Reset selection to None
            backtestState.selectedStrategy = 'none';
            if (strategyLabel) strategyLabel.textContent = 'None';
            if (strategyDesc) {
                strategyDesc.textContent = '';
                strategyDesc.style.display = 'none';
            }
        } catch (e) {
            console.warn('Failed to load strategies metadata', e);
        }
    }

    function renderResults(metrics) {
        if (!metrics || !resultsBox) {
            if (resultsBox) resultsBox.style.display = 'none';
            return;
        }
        const evs = (metrics && Array.isArray(metrics.execution_events)) ? metrics.execution_events : [];
        const execN = evs.length;
        const entryN = evs.filter(e => e.event === 'entry').length;
        const exitN = evs.filter(e => e.event === 'exit').length;

        const lines = [
            `Trades: ${metrics.n_trades ?? '—'}`,
            `Win rate: ${metrics.win_rate != null ? (metrics.win_rate * 100).toFixed(1) + '%' : '—'}`,
            `Avg ret: ${metrics.avg_ret != null ? (metrics.avg_ret * 100).toFixed(2) + '%' : '—'}`,
            `Median: ${metrics.median_ret != null ? (metrics.median_ret * 100).toFixed(2) + '%' : '—'}`,
            `Markers: ${entryN} entries, ${exitN} exits`,
            `Sharpe: ${metrics.sharpe_ratio != null ? metrics.sharpe_ratio.toFixed(2) : '—'}`
        ];
        
        resultsBox.innerHTML = `<strong>Results</strong><br>${lines.join('<br>')}`;
        resultsBox.style.display = 'block';

        // Only show legend if we actually have execution events to explain.
        if (execLegend) execLegend.style.display = execN > 0 ? 'block' : 'none';
    }

    // Helper to map bar_s to backend interval names
    function mapBarSizeToInterval(barS) {
        const s = parseInt(barS);
        if (s <= 60) return '1Min';
        if (s <= 300) return '5Min';
        if (s <= 900) return '15Min';
        if (s <= 3600) return '1h';
        if (s <= 14400) return '4h';
        if (s <= 86400) return '1d';
        return '1Min';
    }

    async function runBacktest() {
        const strategy = backtestState.selectedStrategy;
        if (strategy === 'none') return;

        const configId = backtestState.selectedConfigId;
        const cfg = backtestState.configs.find(c => String(c.id) === String(configId)) || {};
        
        const getSymbolFromPage = () => {
            const urlParams = new URLSearchParams(window.location.search);
            // Check global state first, then URL, then fallback
            const s = (window.state && window.state.symbol) || urlParams.get('symbol') || 'SPY';
            return s;
        };

        const currentBarS = (window.state && window.state.windowSec) || 60;
        const ticker = getSymbolFromPage();
        const interval = mapBarSizeToInterval(currentBarS);

        console.log(`[Backtest] Running: strat=${strategy}, ticker=${ticker}, interval=${interval} (bar_s=${currentBarS})`);

        // Align backtest to the currently displayed chart window, if available.
        // This ensures stop/TP markers are in-view and time-aligned to `state.data`.
        function currentWindowIso() {
            try {
                // If URL specifies start/end, prefer those (explicit window).
                const urlParams = new URLSearchParams(window.location.search);
                const qsStart = (urlParams.get('start') || '').trim();
                const qsEnd = (urlParams.get('end') || '').trim();
                if (qsStart && qsEnd) return { start: qsStart, end: qsEnd };

                // Otherwise use the navigation anchors from the chart state.
                const st = window.state || {};
                const endMs = Number(st.viewEndMs);
                const spanMs = Number(st.viewSpanMs);
                if (Number.isFinite(endMs) && Number.isFinite(spanMs) && spanMs > 0) {
                    const startMs = endMs - spanMs;
                    const startIso = new Date(startMs).toISOString().replace('.000Z', 'Z');
                    const endIso = new Date(endMs).toISOString().replace('.000Z', 'Z');
                    return { start: startIso, end: endIso };
                }
            } catch (_eWin) {}
            return { start: '', end: '' };
        }
        const winIso = currentWindowIso();

        const payload = {
            ticker: ticker,
            interval: interval,
            start: winIso.start,
            end: winIso.end,
            risk_percent: cfg.risk_percent ?? 0.5,
            reward_multiple: cfg.reward_multiple ?? 2.0,
            fee_bp: cfg.fee_bp ?? 0
        };

        backtestState.running = true;
        if (runBacktestBtn) {
            runBacktestBtn.disabled = true;
            runBacktestBtn.textContent = 'Running...';
        }
        if (resultsBox) resultsBox.style.display = 'none';

        try {
            const resp = await fetch(`/api/strategy/${strategy}/backtest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            
            renderResults(data.metrics);

            // Store execution-time markers for the renderer (stop-loss / take-profit).
            // These are backtest artifacts and should not exist until after the run.
            try {
                const ev = (data && data.metrics && Array.isArray(data.metrics.execution_events))
                    ? data.metrics.execution_events
                    : [];
                backtestState.executionEvents = ev;
                backtestState.executionEventsStrategy = strategy;
                backtestState.executionEventsTicker = ticker;
                backtestState.executionEventsInterval = interval;
            } catch (_eEv) {
                backtestState.executionEvents = [];
            }
            
            // Force redraw to ensure markers are up to date (though they usually come from ticker data load)
            if (typeof window.requestDraw === 'function') window.requestDraw('backtest_complete');
        } catch (err) {
            console.error('Backtest failed', err);
            if (resultsBox) {
                resultsBox.innerHTML = `<span style="color:#f87171;">Error: ${err.message}</span>`;
                resultsBox.style.display = 'block';
            }
        } finally {
            backtestState.running = false;
            if (runBacktestBtn) {
                runBacktestBtn.disabled = false;
                runBacktestBtn.textContent = 'Run Backtest';
            }
        }
    }

    if (runBacktestBtn) {
        runBacktestBtn.addEventListener('click', runBacktest);
    }

    // Initial load
    loadStrategies();
    loadBacktestConfigs();
})();
