from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class FeatureSpec:
    """
    Canonical feature spec.

    Notes:
    - `group` is used for warmup/missing flags and for coarse masking (per notes.txt).
    - `clip` is applied after normalization (registry-driven).
    - `max_lookback` is informational and used to derive group warmup defaults.
    """

    name: str
    group: str
    dtype: str = "float32"
    clip: Optional[Tuple[float, float]] = None
    max_lookback: int = 0


class FeatureRegistry:
    """
    Single source of truth for observation schema (order + names).

    Everything else (UI toggles, plotting, exporting, training) should reference
    indices from this registry, never invent its own ordering.
    """

    def __init__(self, *, schema_id: str, specs: Sequence[FeatureSpec]):
        self.schema_id = str(schema_id)
        self.specs: List[FeatureSpec] = list(specs)

        names = [s.name for s in self.specs]
        if len(names) != len(set(names)):
            dupes = sorted({n for n in names if names.count(n) > 1})
            raise ValueError(f"Duplicate feature names in registry: {dupes}")

        self._index: Dict[str, int] = {s.name: i for i, s in enumerate(self.specs)}
        self._groups: List[str] = sorted({s.group for s in self.specs})

    @property
    def dim(self) -> int:
        return len(self.specs)

    @property
    def feature_names(self) -> List[str]:
        return [s.name for s in self.specs]

    @property
    def feature_groups(self) -> List[str]:
        return list(self._groups)

    def index_of(self, name: str) -> int:
        return self._index[str(name)]

    def group_of(self, name: str) -> str:
        return self.specs[self.index_of(name)].group

    def iter_by_group(self, group: str) -> Iterable[FeatureSpec]:
        g = str(group)
        for s in self.specs:
            if s.group == g:
                yield s

    def indices_for_group(self, group: str) -> List[int]:
        g = str(group)
        return [i for i, s in enumerate(self.specs) if s.group == g]

    def indices_for_group_flags(self, group: str) -> List[int]:
        """
        Return indices for the per-group flags (is_warm_<group>, is_missing_<group>).
        These features live in the 'flags' group but refer to the given group.
        """
        g = str(group)
        want = {f"is_warm_{g}", f"is_missing_{g}"}
        return [i for i, s in enumerate(self.specs) if s.name in want]

    def group_warmup_bars(self) -> Dict[str, int]:
        """
        Default warmup bars per group, derived from max_lookback across features in group.
        """
        out: Dict[str, int] = {}
        for g in self._groups:
            ml = 0
            for s in self.iter_by_group(g):
                ml = max(ml, int(s.max_lookback or 0))
            out[g] = int(ml)
        return out

    def validate_schema(
        self,
        *,
        schema_id: str,
        feature_names: Sequence[str],
        allow_remap: bool = False,
    ) -> None:
        """
        Training-time guard: refuse mismatched schema unless you opt-in to remap.
        """
        if str(schema_id) != self.schema_id:
            raise ValueError(f"schema_id mismatch: expected {self.schema_id}, got {schema_id}")
        if list(feature_names) == self.feature_names:
            return
        if not allow_remap:
            raise ValueError(
                "feature_names/order mismatch for schema_id "
                f"{self.schema_id}. Refusing to proceed without allow_remap=True."
            )

    @classmethod
    def schema_v1(cls) -> "FeatureRegistry":
        """
        schema_v1: proxy cycle scalping feature set + placeholder cycle scan slots.
        """
        G = {
            "price_base": "price_base",
            "mr_bands": "mr_bands",
            "cycle_proxy": "cycle_proxy",
            "trend": "trend",
            "risk": "risk",
            "time": "time",
            "position_state": "position_state",
            "cycle_scan": "cycle_scan",  # reserved slots (0 until implemented)
            "flags": "flags",  # warm/missing flags live here
        }

        def f(name: str, group: str, *, clip: Optional[Tuple[float, float]] = (-5.0, 5.0), lb: int = 0):
            return FeatureSpec(name=name, group=group, dtype="float32", clip=clip, max_lookback=lb)

        # Windows (in bars) per your v1 defaults.
        SIGMA_W = 120
        SIGMA_SHORT_W = 60
        BANDS_W = 120
        BP_STAT_W = 120
        TREND_W = 120

        specs: List[FeatureSpec] = []

        # --- price_base ---
        specs += [
            f("ret_1", G["price_base"], clip=(-0.01, 0.01), lb=1),  # 1m log ret; lightly clipped
            f("ret_1_z", G["price_base"], clip=(-5.0, 5.0), lb=SIGMA_W),
            f("sigma", G["price_base"], clip=(0.0, 0.01), lb=SIGMA_W),
            f("vol_z", G["risk"], clip=(0.0, 5.0), lb=max(SIGMA_W, SIGMA_SHORT_W)),
            f("vwap_dev_z", G["price_base"], clip=(-5.0, 5.0), lb=SIGMA_W),
        ]

        # --- mean-reversion bands ---
        specs += [
            f("mr_z", G["mr_bands"], clip=(-5.0, 5.0), lb=BANDS_W),
            f("mr_band_width_z", G["mr_bands"], clip=(0.0, 10.0), lb=BANDS_W),
        ]

        # --- cycle proxy ---
        specs += [
            f("bp", G["cycle_proxy"], clip=(-0.02, 0.02), lb=60),
            f("bp_z", G["cycle_proxy"], clip=(-5.0, 5.0), lb=BP_STAT_W),
            f("bp_slope", G["cycle_proxy"], clip=(-5.0, 5.0), lb=61),
            f("acorr_ret_l15", G["cycle_proxy"], clip=(-1.0, 1.0), lb=120),
            f("acorr_ret_l30", G["cycle_proxy"], clip=(-1.0, 1.0), lb=120),
            f("acorr_ret_l60", G["cycle_proxy"], clip=(-1.0, 1.0), lb=120),
        ]

        # --- trend ---
        specs += [
            f("trend_slope_z", G["trend"], clip=(-5.0, 5.0), lb=TREND_W),
        ]

        # --- risk / breakout ---
        specs += [
            f("range_break_flag", G["risk"], clip=(0.0, 1.0), lb=BANDS_W),
        ]

        # --- time ---
        specs += [
            f("tod_sin", G["time"], clip=(-1.0, 1.0), lb=0),
            f("tod_cos", G["time"], clip=(-1.0, 1.0), lb=0),
        ]

        # --- position state ---
        specs += [
            f("position", G["position_state"], clip=(-1.0, 1.0), lb=0),
            f("time_in_pos_norm", G["position_state"], clip=(0.0, 1.0), lb=0),
        ]

        # --- reserved cycle scan outputs (placeholders keep schema stable) ---
        specs += [
            f("cycle_period_norm", G["cycle_scan"], clip=(0.0, 10.0), lb=0),
            f("cycle_coherence", G["cycle_scan"], clip=(0.0, 1.0), lb=0),
            f("cycle_phase_sin", G["cycle_scan"], clip=(-1.0, 1.0), lb=0),
            f("cycle_phase_cos", G["cycle_scan"], clip=(-1.0, 1.0), lb=0),
            f("cycle_amplitude", G["cycle_scan"], clip=(0.0, 10.0), lb=0),
        ]

        # --- per-group flags ---
        # Per your spec: is_warm_<group>, is_missing_<group>.
        for group in [
            G["price_base"],
            G["mr_bands"],
            G["cycle_proxy"],
            G["trend"],
            G["risk"],
            G["time"],
            G["position_state"],
            G["cycle_scan"],
        ]:
            specs.append(f(f"is_warm_{group}", G["flags"], clip=(0.0, 1.0), lb=0))
            specs.append(f(f"is_missing_{group}", G["flags"], clip=(0.0, 1.0), lb=0))

        return cls(schema_id="schema_v1", specs=specs)


