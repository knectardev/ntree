from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Tuple

from replay.types import Bar, Order, OrderSide, Position


def _side_dir(side: OrderSide) -> int:
    return 1 if side == "buy" else -1


@dataclass
class Fill:
    order_id: str
    side: OrderSide
    qty: float
    price: float
    ts: datetime


@dataclass
class BrokerSim:
    """
    Deterministic "paper broker" (v1) using 1m OHLC bars.

    Fill rules (v1):
    - Market fills at next exec bar open (implemented by converting to a limit at next bar open).
    - Limit fills if bar.low <= limit <= bar.high
    - "Direction lock" per bar: choose the first eligible fill deterministically, then fill all
      eligible orders in that same direction; ignore opposite-direction entries for that bar.
    """

    orders: List[Order]
    position: Position

    def place(self, order: Order) -> None:
        self.orders.append(order)

    def cancel(self, order_id: str) -> bool:
        for o in self.orders:
            if o.order_id == order_id and o.status == "working":
                o.status = "canceled"
                return True
        return False

    def modify(self, order_id: str, *, new_price: float) -> bool:
        for o in self.orders:
            if o.order_id == order_id and o.status == "working" and o.type == "limit":
                o.limit_price = float(new_price)
                return True
        return False

    def _eligible(self, bar: Bar) -> List[Tuple[Order, float]]:
        eligible: List[Tuple[Order, float]] = []
        for o in self.orders:
            if o.status != "working":
                continue
            if o.type == "limit":
                if o.limit_price is None:
                    continue
                lp = float(o.limit_price)
                # v1 fill rules (deterministic, "perfect" fills):
                # - Buy limit fills if bar.low <= limit (price traded at or below limit)
                # - Sell limit fills if bar.high >= limit (price traded at or above limit)
                #
                # Note: We intentionally do NOT require limit to be within [low, high] because
                # a buy limit above bar.high (or a sell limit below bar.low) would still fill
                # (e.g. at bar.open) in real markets.
                if o.side == "buy":
                    if bar.low <= lp:
                        eligible.append((o, lp))
                else:
                    if bar.high >= lp:
                        eligible.append((o, lp))
        return eligible

    def evaluate_bar(self, bar: Bar) -> List[Fill]:
        """
        Evaluate fills against one execution bar.
        Returns fills (may be empty).
        """
        elig = self._eligible(bar)
        if not elig:
            return []

        # Deterministic "first fill": nearest to bar open, then by order_id.
        def key(item: Tuple[Order, float]):
            o, px = item
            return (abs(float(bar.open) - float(px)), str(o.order_id))

        first_order, _ = sorted(elig, key=key)[0]
        lock_dir = _side_dir(first_order.side)

        fills: List[Fill] = []
        for o, px in sorted(elig, key=key):
            if _side_dir(o.side) != lock_dir:
                continue
            # Fill
            o.status = "filled"
            fills.append(Fill(order_id=o.order_id, side=o.side, qty=float(o.qty), price=float(px), ts=bar.ts))
            self._apply_fill(side=o.side, qty=float(o.qty), price=float(px))

        return fills

    def _apply_fill(self, *, side: OrderSide, qty: float, price: float) -> None:
        """
        Simple net position model with average price and realized PnL on flips/reductions.
        """
        if qty <= 0:
            return
        pos = self.position
        dir_new = _side_dir(side)
        q_signed = dir_new * qty

        if pos.qty == 0:
            pos.qty = q_signed
            pos.avg_price = price
            return

        # Same direction: update avg
        if (pos.qty > 0 and q_signed > 0) or (pos.qty < 0 and q_signed < 0):
            new_qty = pos.qty + q_signed
            if new_qty != 0:
                pos.avg_price = (pos.avg_price * abs(pos.qty) + price * abs(q_signed)) / abs(new_qty)
            pos.qty = new_qty
            return

        # Opposite direction: reduce/flip and realize PnL on the closed portion
        close_qty = min(abs(pos.qty), abs(q_signed))
        if pos.qty > 0:
            # closing long
            pnl = (price - pos.avg_price) * close_qty
        else:
            # closing short
            pnl = (pos.avg_price - price) * close_qty
        pos.realized_pnl += pnl

        remaining = pos.qty + q_signed
        if remaining == 0:
            pos.qty = 0.0
            pos.avg_price = 0.0
            return

        # Flipped: new avg is this fill price for the residual
        pos.qty = remaining
        pos.avg_price = price


