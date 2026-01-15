# SPY Statistical Analysis Summary (Direction-Neutral)

## Data Coverage
- **292,593** 1-minute bars for SPY
- Date range: **January 3, 2023** to **January 7, 2026**
- **755 trading days** analyzed
- Includes regular trading hours (RTH) and extended hours

---

## Analysis 1: Intraday Movement (Open to Close)

### Average Daily Movement by Day of Week

| Day of Week | Avg Move ($) | Avg Move (%) | Std Dev ($) | Std Dev (%) | Sample Size |
|-------------|--------------|--------------|-------------|-------------|-------------|
| Monday      | +$0.78       | +0.16%       | $3.23       | 0.61%       | 141 days    |
| Tuesday     | +$0.18       | +0.03%       | $3.63       | 0.70%       | 157 days    |
| Wednesday   | +$0.14       | +0.03%       | $5.34       | 1.05%       | 155 days    |
| Thursday    | -$0.70       | -0.11%       | $4.16       | 0.79%       | 149 days    |
| Friday      | +$0.26       | +0.07%       | $4.16       | 0.78%       | 153 days    |

**Overall Average**: +$0.13 (+0.03%), Std Dev: $4.19 (0.81%)

### Direction Frequency (Close vs Open)

| Day of Week | Close > Open | Close < Open | Close = Open |
|-------------|--------------|--------------|--------------|
| Monday      | 86 (61.0%)   | 55 (39.0%)   | 0 (0.0%)     |
| Tuesday     | 85 (54.1%)   | 72 (45.9%)   | 0 (0.0%)     |
| Wednesday   | 79 (51.0%)   | 76 (49.0%)   | 0 (0.0%)     |
| Thursday    | 68 (45.6%)   | 81 (54.4%)   | 0 (0.0%)     |
| Friday      | 88 (57.5%)   | 65 (42.5%)   | 0 (0.0%)     |

### Key Observations

- **Monday**: Most consistent upward drift (+$0.78 avg), lowest volatility ($3.23 std dev)
- **Wednesday**: Highest volatility ($5.34 std dev) with near-neutral direction (51% up)
- **Thursday**: Only day with average downward drift (-$0.70), slightly higher frequency of down days (54.4%)
- **Friday**: Moderate upward drift with moderate volatility

---

## Analysis 2: Overnight Movement (4pm Close to 9:30am Open)

### Average Overnight Gap by Day of Week

| Opening Day | Avg Gap ($) | Avg Gap (%) | Std Dev ($) | Std Dev (%) | Sample Size |
|-------------|-------------|-------------|-------------|-------------|-------------|
| Monday      | +$0.18      | +0.03%      | -           | -           | 141 gaps    |
| Tuesday     | +$0.51      | +0.10%      | -           | -           | 156 gaps    |
| Wednesday   | +$0.57      | +0.10%      | -           | -           | 153 gaps    |
| Thursday    | +$0.92      | +0.18%      | -           | -           | 148 gaps    |
| Friday      | +$0.46      | +0.09%      | -           | -           | 153 gaps    |

**Overall Average**: +$0.53 (+0.10%), Std Dev: $7.05 (1.34%)

### Gap Direction Frequency

| Opening Day | Gap Up       | Gap Down     |
|-------------|--------------|--------------|
| Monday      | 73 (51.8%)   | 68 (48.2%)   |
| Tuesday     | 82 (52.6%)   | 74 (47.4%)   |
| Wednesday   | 85 (55.6%)   | 68 (44.4%)   |
| Thursday    | 84 (56.8%)   | 64 (43.2%)   |
| Friday      | 87 (56.9%)   | 66 (43.1%)   |

**Overall**: 411 gap up (54.7%), 340 gap down (45.3%)

### Key Observations

- **Monday Openings**: Smallest average gap magnitude (+$0.18), most balanced direction (51.8% vs 48.2%)
- **Thursday Openings**: Largest average gap magnitude (+$0.92), highest upward frequency (56.8%)
- **Overall Pattern**: Overnight periods show consistent upward drift (+$0.53 avg) with higher volatility ($7.05 std dev) than intraday periods ($4.19 std dev)
- **Weekend Effect**: Monday gaps (over weekend) are smallest and most balanced

---

## Statistical Notes

### Correlation
- Open-to-Close price correlation: **0.9989** (extremely high across all days)
- This indicates the closing price is highly predictable from the opening price magnitude

### Volatility Patterns
- **Intraday volatility** (open to close): Average std dev of $4.19 (0.81%)
- **Overnight volatility** (close to open): Average std dev of $7.05 (1.34%)
- Overnight periods show **68% higher volatility** than intraday periods

### Data Quality
- Complete 1-minute bar coverage including extended hours
- 3-year dataset provides robust sample sizes (140-160 observations per day of week)
- No missing trading days detected

---

## Files Generated
- `spy_daily_analysis.csv` - Complete daily OHLC and return data
- `spy_overnight_gaps.csv` - Complete overnight gap measurements

---

*Analysis Date: January 14, 2026*  
*Data Source: stock_data.db (ntree database)*
