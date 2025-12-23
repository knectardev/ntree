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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))

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

        for b in self.feed.bars:
            if b.ts < series_start:
                continue
            if b.ts >= window_end:
                break
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
        for k in sorted(buckets.keys()):
            bb = buckets[k]
            bars_out.append(
                {
                    "ts": _iso_z(bb["ts"]),
                    "o": float(bb["o"]),
                    "h": float(bb["h"]),
                    "l": float(bb["l"]),
                    "c": float(bb["c"]),
                    "v": float(bb["v"]),
                }
            )

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
            "overlays": {},  # optional; UI can handle empty
            "score": {},     # optional
        }

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


