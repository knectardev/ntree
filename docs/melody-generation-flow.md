# Melody Generation — Data Flow

This diagram describes how the Pathfinding Sequencer generates soprano and bass notes from price data.

## Data Flow (Mermaid)

```mermaid
flowchart TD
    subgraph Input [Price Data Input]
        A[Bar OHLCV]
        A1[High wick h]
        A2[Low wick l]
        A --> A1
        A --> A2
    end

    subgraph Engine [Engine - Price to MIDI]
        B[priceToMidi]
        B1[Viewport price range]
        B2[Melodic Range slider]
        B3[Voice-specific MIDI range]
        A1 --> B
        B1 --> B
        B2 --> B
        B --> B3
    end

    subgraph BarBoundary [Bar Boundary subStep 0]
        C[updateRegimeFromPrice]
        D[advanceProgression]
        E[updateVisiblePriceRange]
        F[Set runTargetNote soprano bass]
        A --> C
        C --> D
        D --> E
        E --> F
        B --> F
    end

    subgraph Theory [Theory - Pools]
        G[getScaleNotes regime rootMidi]
        H[getTonalContext chord-aware]
        I[getChordTonesInRange]
        J[buildVoicePools]
        G --> J
        H --> J
        I --> J
    end

    subgraph SopranoBranch [Soprano Note Generation]
        K{Pattern Override?}
        L[generatePatternNote]
        M{soprano.runStepsRemaining gt 0?}
        N[executeSopranoRunStep]
        O[detectMelodicPattern]
        P{Distance to target}
        Q[Cell Selection]
        R[startVoiceCell]
        S[executeSopranoRunStep]
        K -->|Yes| L
        K -->|No| M
        M -->|Continue cell| N
        M -->|New cell| O
        O --> P
        P -->|gt 4 semitones| Q
        P -->|le 4 semitones| Q
        Q -->|scale_run orbit arpeggio enclosure sequence chord_skip leap_fill| R
        R --> S
    end

    subgraph BassBranch [Bass Note Generation]
        T{Pattern Override?}
        U[generatePatternNote]
        V{bass.runStepsRemaining gt 0?}
        W[executeWalkingStep]
        X{Distance to target}
        Y[Bass Cell Selection]
        Z[startVoiceCell]
        AA[executeWalkingStep]
        T -->|Yes| U
        T -->|No| V
        V -->|Continue cell| W
        V -->|New cell| X
        X --> Y
        Y -->|walk_up walk_down arpeggio| Z
        Z --> AA
    end

    subgraph PostProcess [Post-Process]
        AB[applyGenreComplexity]
        AC[applyWickGravity]
        AD[applyAvoidGravity]
        AE[applyStrongBeatLanding]
        AF[nearestScaleNote constraint]
        N --> AB
        S --> AB
        W --> AB
        AA --> AB
        AB --> AC
        AC --> AD
        AD --> AE
        AE --> AF
    end

    subgraph Output [Output]
        AG[Trigger Sampler]
        AH[emitSubStepNote]
        AF --> AG
        AF --> AH
    end

    F --> SopranoBranch
    F --> BassBranch
    J --> SopranoBranch
    J --> BassBranch
    B --> SopranoBranch
    B --> BassBranch
```

## Simplified Flow (Conductor-centric)

```mermaid
flowchart TD
    subgraph Conductor [processSubStep - The Conductor]
        direction TB
        S1[Every sub-step: Drum beat]
        S2[Bar boundary: Regime + Progression + Targets]
        S3[Euclidean pulse gate: shouldTriggerRhythmicPulse]
        S4{Soprano: Pattern Override?}
        S5[Pathfinder: Cell selection by distance]
        S6[Scale run: 1 degree per step toward wick]
        S7[Orbit: Dance around wick Target]
        S8[Genre ornaments: beat-gated only]
        S9[Wick gravity: safety net only]
        S10[Harmonic: avoid-note + strong-beat landing]
        S1 --> S2
        S2 --> S3
        S3 --> S4
        S4 -->|Override| S11[generatePatternNote]
        S4 -->|Pathfinder| S5
        S5 --> S6
        S5 --> S7
        S6 --> S8
        S7 --> S8
        S8 --> S9
        S9 --> S10
    end

    subgraph Inputs [Inputs]
        I1[Bar data h l]
        I2[Regime UPTREND/DOWNTREND]
        I3[Chord progression step]
        I4[Scale from config]
    end

    subgraph Pathfinder [Pathfinder Cell Types]
        P1[scale_run - far from wick]
        P2[orbit - near wick]
        P3[arpeggio enclosure sequence chord_skip leap_fill]
    end

    I1 --> Conductor
    I2 --> Conductor
    I3 --> Conductor
    I4 --> Conductor
```

## Key Concepts

| Concept | Location | Description |
|---------|----------|-------------|
| **priceToMidi** | engine.js | Maps OHLC high/low to soprano/bass MIDI using viewport range + Melodic Range |
| **Regime** | theory.js | UPTREND/DOWNTREND from price trend; selects scale (e.g. Major vs Minor) |
| **Cell** | pathfinder.js | 4–8 note melodic unit: scale_run, orbit, arpeggio, enclosure, etc. |
| **Distance-based selection** | conductor.js | \>4 semitones → scale_run; ≤4 → orbit; Complexity adds stochastic interruptions |
| **Wick gravity** | pathfinder.js | Safety net only for extreme drift; cells handle normal tracking |
| **Pattern Override** | conductor.js | Bypasses pathfinder; uses deterministic patterns (scale_asc, root_only, etc.) |
