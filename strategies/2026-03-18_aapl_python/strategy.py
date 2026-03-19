import pandas as pd
import numpy as np

def generate_signals(ohlcv: pd.DataFrame) -> pd.Series:
    def calculate_rsi(prices, period):
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def calculate_bollinger_bands(prices, period, std_dev):
        sma = prices.rolling(period).mean()
        std = prices.rolling(period).std()
        upper = sma + (std * std_dev)
        lower = sma - (std * std_dev)
        return upper, lower
    
    data = ohlcv.copy()
    data['sma200'] = data['close'].rolling(200).mean()
    data['rsi'] = calculate_rsi(data['close'], 14)
    data['bb_upper'], data['bb_lower'] = calculate_bollinger_bands(data['close'], 20, 2)
    
    signals = pd.Series(0, index=data.index)
    
    long_condition = (data['close'] > data['sma200']) & (data['rsi'] < 30) & (data['close'] < data['bb_lower'])
    exit_condition = data['close'] > data['bb_upper']
    
    position = 0
    entry_price = 0
    days_held = 0
    
    for i in range(len(data)):
        if position == 0 and long_condition.iloc[i]:
            position = 1
            entry_price = data['close'].iloc[i]
            days_held = 0
            signals.iloc[i] = 1
        elif position == 1:
            days_held += 1
            current_return = (data['close'].iloc[i] - entry_price) / entry_price
            if exit_condition.iloc[i] or current_return <= -0.04 or days_held >= 10:
                position = 0
                signals.iloc[i] = -1
    
    return signals