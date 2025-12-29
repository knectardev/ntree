from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from database import get_db_connection
from replay.broker import BrokerSim
from replay.events import EventLogger, _iso_z
from replay.market import MarketFeed
from replay.types import Order, Position, ReplayState

try:
    # Python 3.9+
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]

try:
    import pytz
except Exception:  # pragma: no cover
    pytz = None  # type: ignore[assignment]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def _ceil_time_to_step(dt: datetime, step_sec: int) -> datetime:
    """
    Snap dt UP to the next boundary aligned on `step_sec` (epoch-based).
    For 5m (300s), this aligns to :00/:05/:10... boundaries (in whatever timezone dt is expressed).
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    step = max(1, int(step_sec))
    t = dt.timestamp()
    snapped = ((int(t) + step - 1) // step) * step
    return datetime.fromtimestamp(snapped, tz=timezone.utc)

def _floor_time_to_step(dt: datetime, step_sec: int) -> datetime:
    """
    Snap dt DOWN to the boundary aligned on `step_sec` (epoch-based).
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    step = max(1, int(step_sec))
    t = dt.timestamp()
    snapped = (int(t) // step) * step
    return datetime.fromtimestamp(snapped, tz=timezone.utc)


def _ema_series(values: List[float], period: int) -> List[Optional[float]]:
    """
    EMA implementation intentionally matches demo_static.html:
    - k = 2/(p+1)
    - seed EMA with close[0]
    - if close[i] is not finite, reuse previous EMA
    """
    p = max(1, int(period))
    if not values:
        return []
    k = 2.0 / (p + 1.0)
    out: List[Optional[float]] = [None] * len(values)
    ema = float(values[0])
    out[0] = ema
    for i in range(1, len(values)):
        c = values[i]
        try:
            c_f = float(c)
        except Exception:
            c_f = ema
        # Avoid NaNs poisoning the series.
        if c_f != c_f:  # NaN check
            c_f = ema
        ema = c_f * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _vwap_session_series(
    *,
    ts_utc: List[datetime],
    high: List[float],
    low: List[float],
    close: List[float],
    volume: List[float],
) -> List[Optional[float]]:
    """
    Session VWAP intended to match demo_static.html logic:
    - VWAP anchored to 09:30 ET
    - Before 09:30: None
    - During regular session [09:30, 16:00): cumulative typical-price * volume / cumulative volume
    - After 16:00: hold last regular VWAP flat
    - Reset at day boundary, and when crossing from <09:30 to >=09:30
    """
    n = min(len(ts_utc), len(high), len(low), len(close), len(volume))
    if n <= 0:
        return []
    ny = None
    if ZoneInfo is not None:
        try:
            ny = ZoneInfo("America/New_York")
        except Exception:
            ny = None
    if ny is None and pytz is not None:
        try:
            ny = pytz.timezone("America/New_York")
        except Exception:
            ny = None
    if ny is None:
        return [None] * n
    open_mins = 9 * 60 + 30
    close_mins = 16 * 60

    out: List[Optional[float]] = [None] * n
    cum_pv = 0.0
    cum_v = 0.0
    prev_day_key: Optional[Tuple[int, int, int]] = None
    prev_mins = -1
    last_reg_vwap: Optional[float] = None

    for i in range(n):
        dt = ts_utc[i]
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_ny = dt.astimezone(ny)
        mins = dt_ny.hour * 60 + dt_ny.minute
        day_key = (dt_ny.year, dt_ny.month, dt_ny.day)

        reset = False
        if i == 0:
            reset = True
        elif prev_day_key is not None and day_key != prev_day_key:
            reset = True
        elif prev_mins < open_mins <= mins:
            reset = True
        if reset:
            cum_pv = 0.0
            cum_v = 0.0
            last_reg_vwap = None

        # Before 09:30: no VWAP (don't accumulate premarket prints)
        if mins < open_mins:
            out[i] = None
        # After 16:00: hold last regular VWAP flat
        elif mins >= close_mins:
            out[i] = last_reg_vwap
        else:
            tp = (float(high[i]) + float(low[i]) + float(close[i])) / 3.0
            if tp != tp:  # NaN
                tp = float(close[i])
            vv = float(volume[i]) if volume[i] == volume[i] else 0.0
            if vv < 0:
                vv = 0.0
            cum_pv += tp * vv
            cum_v += vv
            vwap = (cum_pv / cum_v) if cum_v > 0 else tp
            out[i] = vwap
            last_reg_vwap = vwap

        prev_day_key = day_key
        prev_mins = mins

    return out


@dataclass(frozen=True)
class ReplaySessionConfig:
    symbol: str
    t_start: str  # ISO
    t_end: str  # ISO
    exec_tf_sec: int = 60
    disp_tf_sec: int = 300
    seed: Optional[int] = None
    # UI / start behavior
    snap_to_disp_boundary: bool = True
    t_anchor: Optional[str] = None  # ISO; if provided, session starts here (after snapping)
    initial_history_bars: int = 200
    min_future_disp_bars: int = 3


class ReplaySession:
    """
    In-memory replay session runner.

    v1 stepping: step by display bars, evaluating fills on each 1m bar inside the window.
    """

    def __init__(self, *, session_id: str, cfg: ReplaySessionConfig, feed: MarketFeed):
        self.session_id = session_id
        self.cfg = cfg
        self.feed = feed

        self.paused = False
        self.position = Position()
        self.orders: List[Order] = []
        self.broker = BrokerSim(orders=self.orders, position=self.position)
        self.logger = EventLogger(session_id=session_id)

        # Cursor state:
        # - display cursor advances in fixed wall-clock windows (Option A in notes.txt)
        # - exec cursor advances by consuming bars whose timestamps land within each display window
        self._exec_idx = 0
        self._cursor_exec_ts = _parse_iso(cfg.t_start)

        self._t_start_dt = _parse_iso(cfg.t_start)
        self._t_end_dt = _parse_iso(cfg.t_end)
        # Start at anchor if provided; otherwise at requested t_start.
        anchor_dt = _parse_iso(cfg.t_anchor) if cfg.t_anchor else self._t_start_dt
        if cfg.snap_to_disp_boundary:
            self._disp_cursor_start_ts = _ceil_time_to_step(anchor_dt, int(cfg.disp_tf_sec))
        else:
            self._disp_cursor_start_ts = anchor_dt.astimezone(timezone.utc)
        self._last_event_id = 0
        self._last_bar = None  # last consumed exec bar (for market fills)

        # Delta-mode (opt-in) cache:
        # - Maintains a fixed-length rolling display window for fast {drop, append} updates.
        # - Keeps server-authoritative overlays as rolling windows + append points.
        self._delta_inited: bool = False
        self._delta_hist: int = max(10, int(cfg.initial_history_bars))
        self._delta_window_end: Optional[datetime] = None  # exclusive end timestamp for the current right-edge bucket
        self._delta_bars: List[Dict[str, Any]] = []  # [{"ts","o","h","l","c","v"}] length == _delta_hist
        self._delta_overlays: Dict[str, Any] = {}  # {"ema": {"9":[{ts,v}], ...}, "vwap":[{ts,v}]}
        self._delta_ema_last: Dict[str, Optional[float]] = {}  # keys "9","21","50"
        self._delta_vwap_state: Dict[str, Any] = {}  # incremental state for session VWAP
        self._delta_steps: int = 0  # number of delta steps emitted (for periodic resync)
        self._delta_ny_tz = None

        # Persist session record
        self._persist_session_row(status="active")

        # Initial event
        self._last_event_id = self.logger.emit(
            event_type="SESSION_START",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={
                "symbol": cfg.symbol,
                "exec_tf_sec": cfg.exec_tf_sec,
                "disp_tf_sec": cfg.disp_tf_sec,
                "t_start": cfg.t_start,
                "t_end": cfg.t_end,
                "seed": cfg.seed,
            },
        )

    @classmethod
    def create(cls, cfg: ReplaySessionConfig) -> "ReplaySession":
        if int(cfg.exec_tf_sec) <= 0 or int(cfg.disp_tf_sec) <= 0:
            raise ValueError("exec_tf_sec and disp_tf_sec must be > 0")
        if int(cfg.disp_tf_sec) % int(cfg.exec_tf_sec) != 0:
            raise ValueError("disp_tf_sec must be an integer multiple of exec_tf_sec")
        session_id = str(uuid.uuid4())
        feed = MarketFeed.from_stock_data(symbol=cfg.symbol, start_ts=cfg.t_start, end_ts=cfg.t_end, interval="1Min")
        if not feed.bars:
            raise ValueError("No bars found for requested range")
        sess = cls(session_id=session_id, cfg=cfg, feed=feed)
        # Initialize exec index to first bar at/after display cursor start
        while sess._exec_idx < len(feed.bars) and feed.bars[sess._exec_idx].ts < sess._disp_cursor_start_ts:
            sess._exec_idx += 1
        sess._cursor_exec_ts = sess._disp_cursor_start_ts
        return sess

    @property
    def cursor_exec_ts(self) -> datetime:
        return self._cursor_exec_ts

    def get_state(self) -> ReplayState:
        return ReplayState(
            session_id=self.session_id,
            symbol=self.cfg.symbol,
            exec_tf_sec=self.cfg.exec_tf_sec,
            disp_tf_sec=self.cfg.disp_tf_sec,
            cursor_exec_ts=self.cursor_exec_ts,
            paused=self.paused,
            position=self.position,
            orders=list(self.orders),
            last_event_id=int(self._last_event_id),
            extra={
                "exec_idx": int(self._exec_idx),
                "n_exec_bars": int(len(self.feed.bars)),
                "cursor_disp_start_ts": _iso_z(self._disp_cursor_start_ts),
                "t_start_requested": self.cfg.t_start,
                "t_end_requested": self.cfg.t_end,
                "t_anchor": self.cfg.t_anchor,
            },
        )

    def get_state_payload(self) -> Dict[str, Any]:
        """
        Payload used by demo_static.html replay UI.
        Returns a dict with:
        - display_series.bars: aggregated OHLCV buckets (disp_tf_sec)
        - clock.disp_window: start/end for current display window
        - clock.exec_cursor_ts: last consumed exec timestamp (best-effort)
        """
        st = self.get_state()
        disp_tf = int(self.cfg.disp_tf_sec)
        exec_tf = int(self.cfg.exec_tf_sec)
        window_start = self._disp_cursor_start_ts
        window_end = window_start + timedelta(seconds=disp_tf)

        # How much history to include in the display series.
        hist = max(10, int(self.cfg.initial_history_bars))
        series_start = window_end - timedelta(seconds=disp_tf * hist)

        # Aggregate exec bars into display buckets for [series_start, window_end).
        buckets: Dict[int, Dict[str, Any]] = {}
        step_sec = max(1, disp_tf)

        def bucket_key(dt: datetime) -> int:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return (int(dt.timestamp()) // step_sec) * step_sec

        # Fast range scan (avoid iterating the entire feed each step).
        i0, i1 = self.feed.range_indices(start_ts=series_start, end_ts_exclusive=window_end)
        for b in self.feed.bars[i0:i1]:
            k = bucket_key(b.ts)
            cur = buckets.get(k)
            if cur is None:
                buckets[k] = {
                    "ts": datetime.fromtimestamp(k, tz=timezone.utc),
                    "o": float(b.open),
                    "h": float(b.high),
                    "l": float(b.low),
                    "c": float(b.close),
                    "v": float(b.volume or 0.0),
                }
            else:
                cur["h"] = max(float(cur["h"]), float(b.high))
                cur["l"] = min(float(cur["l"]), float(b.low))
                cur["c"] = float(b.close)
                cur["v"] = float(cur["v"]) + float(b.volume or 0.0)

        bars_out = []
        # Keep arrays for overlays. These are derived from display buckets (disp_tf_sec), not exec bars.
        ts_list: List[datetime] = []
        o_list: List[float] = []
        h_list: List[float] = []
        l_list: List[float] = []
        c_list: List[float] = []
        v_list: List[float] = []
        for k in sorted(buckets.keys()):
            bb = buckets[k]
            ts_dt = bb["ts"]
            o0 = float(bb["o"])
            h0 = float(bb["h"])
            l0 = float(bb["l"])
            c0 = float(bb["c"])
            v0 = float(bb["v"])
            bars_out.append({"ts": _iso_z(ts_dt), "o": o0, "h": h0, "l": l0, "c": c0, "v": v0})
            ts_list.append(ts_dt)
            o_list.append(o0)
            h_list.append(h0)
            l_list.append(l0)
            c_list.append(c0)
            v_list.append(v0)

        # Basic position payload; unrealized is approximated from last close.
        last_px = None
        try:
            if self._last_bar is not None:
                last_px = float(self._last_bar.close)
            elif self._exec_idx > 0 and self.feed.bars:
                last_px = float(self.feed.bars[max(0, self._exec_idx - 1)].close)
        except Exception:
            last_px = None
        unreal = 0.0
        try:
            if last_px is not None and float(self.position.qty) != 0:
                unreal = (last_px - float(self.position.avg_price)) * float(self.position.qty)
        except Exception:
            unreal = 0.0

        # Optional overlays (EMA + session VWAP). Kept best-effort: UI can handle empty.
        overlays: Dict[str, Any] = {}
        try:
            n = len(ts_list)
            if n >= 2:
                ema9 = _ema_series(c_list, 9)
                ema21 = _ema_series(c_list, 21)
                ema50 = _ema_series(c_list, 50)
                vwap = _vwap_session_series(ts_utc=ts_list, high=h_list, low=l_list, close=c_list, volume=v_list)
                overlays = {
                    "ema": {
                        "9": [{"ts": _iso_z(ts_list[i]), "v": ema9[i]} for i in range(n)],
                        "21": [{"ts": _iso_z(ts_list[i]), "v": ema21[i]} for i in range(n)],
                        "50": [{"ts": _iso_z(ts_list[i]), "v": ema50[i]} for i in range(n)],
                    },
                    "vwap": [
                        {"ts": _iso_z(ts_list[i]), "v": vwap[i]} for i in range(n)
                    ],
                }
        except Exception:
            overlays = {}

        return {
            "session_id": st.session_id,
            "symbol": st.symbol,
            "exec_tf_sec": exec_tf,
            "disp_tf_sec": disp_tf,
            "requested_range": {"start": self.cfg.t_start, "end": self.cfg.t_end},
            "actual_range": {
                "start": _iso_z(self.feed.bars[0].ts) if self.feed.bars else self.cfg.t_start,
                "end": _iso_z(self.feed.bars[-1].ts) if self.feed.bars else self.cfg.t_end,
            },
            "clock": {
                "exec_cursor_ts": _iso_z(st.cursor_exec_ts),
                "disp_window": {"start": _iso_z(window_start), "end": _iso_z(window_end)},
            },
            "display_series": {"bars": bars_out},
            "position": {
                "qty": float(self.position.qty),
                "avg_price": float(self.position.avg_price),
                "realized_pnl": float(self.position.realized_pnl),
                "unrealized_pnl": float(unreal),
            },
            "orders": [o.__dict__ for o in st.orders],
            "overlays": overlays,  # optional; UI can handle empty
            "score": {},     # optional
        }

    # -----------------------
    # Delta-mode (opt-in) API
    # -----------------------

    def _delta_get_ny_tz(self):
        """
        Best-effort tz object for America/New_York. Mirrors _vwap_session_series behavior.
        Cached per session for delta stepping.
        """
        if self._delta_ny_tz is not None:
            return self._delta_ny_tz
        ny = None
        if ZoneInfo is not None:
            try:
                ny = ZoneInfo("America/New_York")
            except Exception:
                ny = None
        if ny is None and pytz is not None:
            try:
                ny = pytz.timezone("America/New_York")
            except Exception:
                ny = None
        self._delta_ny_tz = ny
        return ny

    def _delta_vwap_next(
        self,
        *,
        dt_utc: datetime,
        high: float,
        low: float,
        close: float,
        volume: float,
    ) -> Optional[float]:
        """
        Incremental VWAP update to match _vwap_session_series logic.
        State lives in self._delta_vwap_state.
        """
        ny = self._delta_get_ny_tz()
        if ny is None:
            return None

        # Init state dict once.
        st = self._delta_vwap_state
        if not st:
            st["open_mins"] = 9 * 60 + 30
            st["close_mins"] = 16 * 60
            st["cum_pv"] = 0.0
            st["cum_v"] = 0.0
            st["prev_day_key"] = None
            st["prev_mins"] = -1
            st["last_reg_vwap"] = None

        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        dt_ny = dt_utc.astimezone(ny)
        mins = dt_ny.hour * 60 + dt_ny.minute
        day_key = (dt_ny.year, dt_ny.month, dt_ny.day)

        open_mins = int(st["open_mins"])
        close_mins = int(st["close_mins"])

        reset = False
        if st["prev_day_key"] is None:
            reset = True
        elif day_key != st["prev_day_key"]:
            reset = True
        elif int(st["prev_mins"]) < open_mins <= mins:
            reset = True

        if reset:
            st["cum_pv"] = 0.0
            st["cum_v"] = 0.0
            st["last_reg_vwap"] = None

        out: Optional[float]
        if mins < open_mins:
            out = None
        elif mins >= close_mins:
            out = st["last_reg_vwap"]
        else:
            tp = (float(high) + float(low) + float(close)) / 3.0
            if tp != tp:  # NaN
                tp = float(close)
            vv = float(volume) if volume == volume else 0.0
            if vv < 0:
                vv = 0.0
            st["cum_pv"] = float(st["cum_pv"]) + tp * vv
            st["cum_v"] = float(st["cum_v"]) + vv
            out = (float(st["cum_pv"]) / float(st["cum_v"])) if float(st["cum_v"]) > 0 else tp
            st["last_reg_vwap"] = out

        st["prev_day_key"] = day_key
        st["prev_mins"] = mins
        return out

    def _delta_aggregate_bar(
        self, *, start_ts: datetime, end_ts_exclusive: datetime
    ) -> Optional[Dict[str, Any]]:
        """
        Aggregate exec bars into one display bar for [start_ts, end_ts_exclusive).
        If empty, return None (skip closed/gap windows to match the legacy snapshot behavior).
        """
        i0, i1 = self.feed.range_indices(start_ts=start_ts, end_ts_exclusive=end_ts_exclusive)
        if i1 > i0:
            o = float(self.feed.bars[i0].open)
            h = float(self.feed.bars[i0].high)
            l = float(self.feed.bars[i0].low)
            c = float(self.feed.bars[i0].close)
            v = float(self.feed.bars[i0].volume or 0.0)
            for b in self.feed.bars[i0 + 1 : i1]:
                h = max(h, float(b.high))
                l = min(l, float(b.low))
                c = float(b.close)
                v += float(b.volume or 0.0)
            return {"ts": _iso_z(start_ts), "o": o, "h": h, "l": l, "c": c, "v": v}
        return None

    def _delta_init_cache(self) -> None:
        """
        Initialize the fixed-length rolling window and overlay series used by delta-only stepping.
        This does NOT change default snapshot behavior; it's only used when delta_mode/delta_only is requested.
        """
        if self._delta_inited:
            return
        disp_tf_sec = int(self.cfg.disp_tf_sec)
        step = timedelta(seconds=max(1, disp_tf_sec))
        hist = max(10, int(self.cfg.initial_history_bars))
        self._delta_hist = hist

        # Keep initial semantics aligned with existing UI: window_end is "current display window end".
        # (demo_static clamps viewEnd to this.)
        window_end = self._disp_cursor_start_ts + step
        self._delta_window_end = window_end

        series_start = window_end - step * hist
        bars: List[Dict[str, Any]] = []
        # Build rolling bars window by aggregating each display bucket and skipping empty windows.
        for i in range(hist):
            b_start = series_start + step * i
            b_end = b_start + step
            bb = self._delta_aggregate_bar(start_ts=b_start, end_ts_exclusive=b_end)
            if bb is not None:
                bars.append(bb)
        self._delta_bars = bars

        # Seed overlay rolling windows (server-authoritative) and incremental state.
        ts_list: List[datetime] = []
        h_list: List[float] = []
        l_list: List[float] = []
        c_list: List[float] = []
        v_list: List[float] = []
        for i in range(len(bars)):
            dt = _parse_iso(str(bars[i]["ts"]))
            ts_list.append(dt.astimezone(timezone.utc))
            h_list.append(float(bars[i]["h"]))
            l_list.append(float(bars[i]["l"]))
            c_list.append(float(bars[i]["c"]))
            v_list.append(float(bars[i]["v"]))

        ema9 = _ema_series(c_list, 9) if c_list else []
        ema21 = _ema_series(c_list, 21) if c_list else []
        ema50 = _ema_series(c_list, 50) if c_list else []

        # Reset VWAP state and compute window series using incremental updater (ensures continuity state is correct).
        self._delta_vwap_state = {}
        vwap_vals: List[Optional[float]] = []
        for i in range(len(ts_list)):
            vwap_vals.append(
                self._delta_vwap_next(
                    dt_utc=ts_list[i],
                    high=h_list[i],
                    low=l_list[i],
                    close=c_list[i],
                    volume=v_list[i],
                )
            )

        def points(ts: List[datetime], vals: List[Optional[float]]) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            n = min(len(ts), len(vals))
            for i in range(n):
                out.append({"ts": _iso_z(ts[i]), "v": vals[i]})
            return out

        self._delta_overlays = {
            "ema": {"9": points(ts_list, ema9), "21": points(ts_list, ema21), "50": points(ts_list, ema50)},
            "vwap": points(ts_list, vwap_vals),
        }
        # Store last EMA values for incremental stepping (None-safe).
        self._delta_ema_last = {
            "9": (ema9[-1] if ema9 else None),
            "21": (ema21[-1] if ema21 else None),
            "50": (ema50[-1] if ema50 else None),
        }
        self._delta_steps = 0
        self._delta_inited = True

    def get_state_payload_delta(self) -> Dict[str, Any]:
        """
        Full snapshot payload for delta mode (fixed window + overlays).
        Shape matches demo_static.html expectations, but uses a fixed-length bars window.
        """
        self._delta_init_cache()
        st = self.get_state()
        disp_tf = int(self.cfg.disp_tf_sec)
        exec_tf = int(self.cfg.exec_tf_sec)
        step = timedelta(seconds=max(1, disp_tf))
        window_end = self._delta_window_end or (self._disp_cursor_start_ts + step)
        window_start = window_end - step

        # Position payload (same style as get_state_payload).
        last_px = None
        try:
            if self._delta_bars:
                last_px = float(self._delta_bars[-1]["c"])
        except Exception:
            last_px = None
        unreal = 0.0
        try:
            if last_px is not None and float(self.position.qty) != 0:
                unreal = (last_px - float(self.position.avg_price)) * float(self.position.qty)
        except Exception:
            unreal = 0.0

        return {
            "session_id": st.session_id,
            "symbol": st.symbol,
            "exec_tf_sec": exec_tf,
            "disp_tf_sec": disp_tf,
            "requested_range": {"start": self.cfg.t_start, "end": self.cfg.t_end},
            "actual_range": {
                "start": _iso_z(self.feed.bars[0].ts) if self.feed.bars else self.cfg.t_start,
                "end": _iso_z(self.feed.bars[-1].ts) if self.feed.bars else self.cfg.t_end,
            },
            "clock": {
                "exec_cursor_ts": _iso_z(st.cursor_exec_ts),
                "disp_window": {"start": _iso_z(window_start), "end": _iso_z(window_end)},
            },
            "display_series": {"bars": list(self._delta_bars)},
            "position": {
                "qty": float(self.position.qty),
                "avg_price": float(self.position.avg_price),
                "realized_pnl": float(self.position.realized_pnl),
                "unrealized_pnl": float(unreal),
            },
            "orders": [o.__dict__ for o in st.orders],
            "overlays": self._delta_overlays,
            "score": {},
        }

    def step_delta(
        self,
        *,
        resync_every: int = 0,
        force_state: bool = False,
    ) -> Dict[str, Any]:
        """
        Advance the simulation by 1 display step, returning a delta payload.
        May include a full `state` snapshot occasionally for resync (or when forced).
        """
        self._delta_init_cache()

        before_end = self._delta_window_end

        disp_tf_sec = int(self.cfg.disp_tf_sec)
        step_td = timedelta(seconds=max(1, disp_tf_sec))
        if before_end is None:
            before_end = self._disp_cursor_start_ts + step_td

        # Delta playback should feel like a steady "tick" even during closed hours/weekends.
        # Instead of emitting no-op deltas (which makes the UI appear stalled), fast-forward
        # over empty windows until we find a real bar to append.
        st_after = None
        new_end = before_end
        bar = None
        max_skips = 256  # safety: cap fast-forwarding in a single delta step
        for _ in range(max_skips):
            # Step sim (fills/orders/position); advances internal cursor by 1 display window.
            st_after = self.step(disp_steps=1)
            if st_after.paused and self._disp_cursor_start_ts >= self._t_end_dt:
                full = self.get_state_payload_delta()
                return {"ok": True, "delta": {"drop": 0, "append_bars": [], "overlays_append": {}}, "state": full}

            new_end = new_end + step_td
            self._delta_window_end = new_end
            bar = self._delta_aggregate_bar(start_ts=new_end - step_td, end_ts_exclusive=new_end)
            if bar is not None:
                break

        # If we couldn't find a bar within max_skips, emit a no-op delta as a fallback (rare).
        if bar is None:
            self._delta_steps = int(self._delta_steps) + 1
            out0: Dict[str, Any] = {
                "ok": True,
                "delta": {"drop": 0, "append_bars": [], "overlays_append": {}},
                "position": {
                    "qty": float(self.position.qty),
                    "avg_price": float(self.position.avg_price),
                    "realized_pnl": float(self.position.realized_pnl),
                    "unrealized_pnl": 0.0,
                },
                "orders": [o.__dict__ for o in self.get_state().orders],
                "meta": {"disp_window_end": _iso_z(new_end), "delta_step": int(self._delta_steps), "disp_tf_sec": int(self.cfg.disp_tf_sec)},
            }
            include_state0 = bool(force_state)
            if not include_state0 and resync_every:
                try:
                    n0 = max(1, int(resync_every))
                    if (self._delta_steps % n0) == 0:
                        include_state0 = True
                except Exception:
                    include_state0 = False
            if include_state0:
                out0["state"] = self.get_state_payload_delta()
            return out0

        # Slide window by 1 (only when we have a real bar).
        drop = 1 if self._delta_bars else 0
        if drop and self._delta_bars:
            self._delta_bars.pop(0)
        self._delta_bars.append(bar)

        # Overlays append (server-authoritative, append-only points).
        # EMA incremental: same constants as _ema_series.
        k9 = 2.0 / (9.0 + 1.0)
        k21 = 2.0 / (21.0 + 1.0)
        k50 = 2.0 / (50.0 + 1.0)
        c = float(bar["c"])
        ema_append: Dict[str, Dict[str, Any]] = {}
        for p, k in (("9", k9), ("21", k21), ("50", k50)):
            prev = self._delta_ema_last.get(p)
            if prev is None:
                ema = c
            else:
                ema = float(c) * float(k) + float(prev) * (1.0 - float(k))
            self._delta_ema_last[p] = ema
            ema_append[p] = {"ts": str(bar["ts"]), "v": ema}

        # VWAP incremental.
        dt_utc = _parse_iso(str(bar["ts"])).astimezone(timezone.utc)
        vwap_v = self._delta_vwap_next(
            dt_utc=dt_utc, high=float(bar["h"]), low=float(bar["l"]), close=float(bar["c"]), volume=float(bar["v"])
        )
        vwap_append = {"ts": str(bar["ts"]), "v": vwap_v}

        # Maintain rolling overlay windows for resync snapshots.
        try:
            ov = self._delta_overlays
            if isinstance(ov.get("ema"), dict):
                for p in ("9", "21", "50"):
                    arr = ov["ema"].get(p)
                    if isinstance(arr, list) and arr:
                        arr.pop(0)
                        arr.append({"ts": str(bar["ts"]), "v": ema_append[p]["v"]})
            vw = ov.get("vwap")
            if isinstance(vw, list) and vw:
                vw.pop(0)
                vw.append({"ts": str(bar["ts"]), "v": vwap_v})
        except Exception:
            # If maintenance fails, we can still emit append points; resync will rebuild on demand.
            pass

        # Count emitted deltas (not internal skipped windows).
        self._delta_steps = int(self._delta_steps) + 1

        include_state = bool(force_state)
        if not include_state and resync_every:
            try:
                n = max(1, int(resync_every))
                if (self._delta_steps % n) == 0:
                    include_state = True
            except Exception:
                include_state = False

        # Lightweight position/orders snapshot each tick (small; keeps UI reactive without full state).
        last_px = None
        try:
            if self._delta_bars:
                last_px = float(self._delta_bars[-1]["c"])
        except Exception:
            last_px = None
        unreal = 0.0
        try:
            if last_px is not None and float(self.position.qty) != 0:
                unreal = (last_px - float(self.position.avg_price)) * float(self.position.qty)
        except Exception:
            unreal = 0.0

        out: Dict[str, Any] = {
            "ok": True,
            "delta": {
                "drop": drop,
                "append_bars": [bar],
                "overlays_append": {
                    "ema": {"9": [ema_append["9"]], "21": [ema_append["21"]], "50": [ema_append["50"]]},
                    "vwap": [vwap_append],
                },
            },
            "position": {
                "qty": float(self.position.qty),
                "avg_price": float(self.position.avg_price),
                "realized_pnl": float(self.position.realized_pnl),
                "unrealized_pnl": float(unreal),
            },
            "orders": [o.__dict__ for o in self.get_state().orders],
            "meta": {"disp_window_end": _iso_z(new_end), "delta_step": int(self._delta_steps), "disp_tf_sec": int(self.cfg.disp_tf_sec)},
        }
        if include_state:
            out["state"] = self.get_state_payload_delta()
        return out

    def step_delta_payloads(
        self,
        *,
        disp_steps: int = 1,
        resync_every: int = 0,
        force_state: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Batch delta stepping: returns one delta item per step (small payloads; safe to buffer on the client).
        """
        steps = max(1, int(disp_steps))
        out: List[Dict[str, Any]] = []
        for i in range(steps):
            # Only force_state on the first item (client uses it to realign); periodic resync handles the rest.
            out.append(self.step_delta(resync_every=resync_every, force_state=force_state if i == 0 else False))
        return out

    def step_payloads(self, *, disp_steps: int = 1) -> List[Dict[str, Any]]:
        """
        Step the session forward by disp_steps display windows, returning a payload snapshot per step.
        This is used by the browser replay UI to prefetch a small buffer and play it back smoothly.
        """
        steps = max(1, int(disp_steps))
        out: List[Dict[str, Any]] = []
        for _ in range(steps):
            self.step(disp_steps=1)
            out.append(self.get_state_payload())
        return out

    def place_limit(self, *, side: str, price: float, qty: float, tag: Optional[str] = None) -> Order:
        oid = str(uuid.uuid4())
        o = Order(
            order_id=oid,
            side=side,  # type: ignore[arg-type]
            type="limit",
            qty=float(qty),
            limit_price=float(price),
            tag=tag,
            created_ts=self.cursor_exec_ts,
        )
        self.broker.place(o)
        self._last_event_id = self.logger.emit(
            event_type="ORDER_PLACED",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={"order_id": oid, "side": side, "type": "limit", "qty": qty, "limit_price": price, "tag": tag},
        )
        return o

    def place_market(self, *, side: str, qty: float, tag: Optional[str] = None) -> Tuple[Order, Optional[float]]:
        """
        v1 "market": fill immediately at the last known close (deterministic).
        Returns (order, fill_price).
        """
        # Choose a deterministic fill price based on last consumed bar (or nearest available).
        fill_px = None
        try:
            if self._last_bar is not None:
                fill_px = float(self._last_bar.close)
            elif self._exec_idx > 0 and self.feed.bars:
                fill_px = float(self.feed.bars[max(0, self._exec_idx - 1)].close)
            elif self.feed.bars:
                fill_px = float(self.feed.bars[0].close)
        except Exception:
            fill_px = None

        oid = str(uuid.uuid4())
        o = Order(
            order_id=oid,
            side=side,  # type: ignore[arg-type]
            type="market",
            qty=float(qty),
            limit_price=None,
            tag=tag,
            created_ts=self.cursor_exec_ts,
            status="filled",
        )
        # Store the order (UI expects an order list).
        self.orders.append(o)
        self._last_event_id = self.logger.emit(
            event_type="ORDER_PLACED",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={"order_id": oid, "side": side, "type": "market", "qty": qty, "price": fill_px, "tag": tag},
        )
        if fill_px is not None:
            # Apply fill immediately.
            self.broker._apply_fill(side=side, qty=float(qty), price=float(fill_px))  # type: ignore[attr-defined]
            self._last_event_id = self.logger.emit(
                event_type="FILL",
                ts_exec=self.cursor_exec_ts,
                ts_market=self.cursor_exec_ts,
                payload={
                    "order_id": oid,
                    "side": side,
                    "qty": float(qty),
                    "price": float(fill_px),
                    "position_qty": self.position.qty,
                    "avg_price": self.position.avg_price,
                    "realized_pnl": self.position.realized_pnl,
                    "tag": tag,
                },
            )
        return o, fill_px

    def flatten_now(self, *, tag: Optional[str] = None) -> Optional[float]:
        """
        Close any open position immediately at last known close.
        Returns fill price if executed, else None.
        """
        q = float(self.position.qty)
        if q == 0:
            return None
        side = "sell" if q > 0 else "buy"
        _, px = self.place_market(side=side, qty=abs(q), tag=tag or "flatten")
        return px

    def cancel(self, *, order_id: str) -> bool:
        ok = self.broker.cancel(order_id)
        if ok:
            self._last_event_id = self.logger.emit(
                event_type="ORDER_CANCELED",
                ts_exec=self.cursor_exec_ts,
                ts_market=self.cursor_exec_ts,
                payload={"order_id": order_id},
            )
        return ok

    def modify(self, *, order_id: str, new_price: float) -> bool:
        ok = self.broker.modify(order_id, new_price=float(new_price))
        if ok:
            self._last_event_id = self.logger.emit(
                event_type="ORDER_MODIFIED",
                ts_exec=self.cursor_exec_ts,
                ts_market=self.cursor_exec_ts,
                payload={"order_id": order_id, "new_price": float(new_price)},
            )
        return ok

    def step(self, *, disp_steps: int = 1) -> ReplayState:
        if self.paused:
            return self.get_state()

        steps = max(1, int(disp_steps))

        disp_tf = timedelta(seconds=int(self.cfg.disp_tf_sec))

        for _ in range(steps):
            # End condition: display cursor reached requested session end.
            if self._disp_cursor_start_ts >= self._t_end_dt:
                self._end_session()
                return self.get_state()

            win_start = self._disp_cursor_start_ts
            win_end = win_start + disp_tf

            consumed = 0
            last_ts = None

            # Consume all exec bars with ts in [win_start, win_end)
            while self._exec_idx < len(self.feed.bars) and self.feed.bars[self._exec_idx].ts < win_end:
                bar = self.feed.bars[self._exec_idx]
                if bar.ts >= win_start:
                    consumed += 1
                    last_ts = bar.ts
                    self._last_bar = bar
                    fills = self.broker.evaluate_bar(bar)
                    for f in fills:
                        self._last_event_id = self.logger.emit(
                            event_type="FILL",
                            ts_exec=bar.ts,
                            ts_market=bar.ts,
                            payload={
                                "order_id": f.order_id,
                                "side": f.side,
                                "qty": f.qty,
                                "price": f.price,
                                "position_qty": self.position.qty,
                                "avg_price": self.position.avg_price,
                                "realized_pnl": self.position.realized_pnl,
                            },
                        )
                self._exec_idx += 1

            if consumed == 0:
                # Explicitly log empty windows so replay diagnostics/analytics can see gaps.
                self._last_event_id = self.logger.emit(
                    event_type="WINDOW_EMPTY",
                    ts_exec=win_end,
                    ts_market=win_end,
                    payload={
                        "window_start": _iso_z(win_start),
                        "window_end": _iso_z(win_end),
                    },
                )
            else:
                self._cursor_exec_ts = last_ts  # type: ignore[assignment]

            # Advance the display cursor by exact wall-clock time.
            self._disp_cursor_start_ts = win_end

        # Update session heartbeat
        self._persist_session_row(status="active")
        return self.get_state()

    def pause(self) -> None:
        self.paused = True
        self._last_event_id = self.logger.emit(
            event_type="PAUSE",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={},
        )

    def play(self) -> None:
        self.paused = False
        self._last_event_id = self.logger.emit(
            event_type="PLAY",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={},
        )

    def _end_session(self) -> None:
        self.paused = True
        self._persist_session_row(status="ended", summary_json={"realized_pnl": self.position.realized_pnl})
        self._last_event_id = self.logger.emit(
            event_type="SESSION_END",
            ts_exec=self.cursor_exec_ts,
            ts_market=self.cursor_exec_ts,
            payload={"realized_pnl": self.position.realized_pnl},
        )

    def end(self) -> None:
        """
        Explicitly end the session (e.g., user pressed Reset/End).
        Idempotent-ish: safe to call multiple times.
        """
        try:
            self._end_session()
        except Exception:
            # As a last resort, still mark ended in DB.
            try:
                self.paused = True
                self._persist_session_row(status="ended", summary_json={"realized_pnl": self.position.realized_pnl})
            except Exception:
                pass

    def _persist_session_row(self, *, status: str, summary_json: Optional[Dict[str, Any]] = None) -> None:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            now = _iso_z(_utc_now())
            cur.execute(
                """
                INSERT INTO replay_sessions (
                    session_id, symbol, exec_tf_sec, disp_tf_sec, t_start, t_end, seed, status, created_at, updated_at, summary_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    status=excluded.status,
                    updated_at=excluded.updated_at,
                    summary_json=COALESCE(excluded.summary_json, replay_sessions.summary_json)
                """,
                (
                    self.session_id,
                    self.cfg.symbol,
                    int(self.cfg.exec_tf_sec),
                    int(self.cfg.disp_tf_sec),
                    self.cfg.t_start,
                    self.cfg.t_end,
                    self.cfg.seed,
                    status,
                    now,
                    now,
                    None if summary_json is None else __import__("json").dumps(summary_json),
                ),
            )
            conn.commit()
        finally:
            conn.close()


