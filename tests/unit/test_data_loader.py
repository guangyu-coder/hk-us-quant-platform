import unittest
import queue
import os
import shutil
import pandas as pd
from src.data_loader.historic_csv import HistoricCSVDataHandler

class TestHistoricCSVDataHandler(unittest.TestCase):
    def setUp(self):
        self.csv_dir = "tests/data"
        self.symbol_list = ["AAPL"]
        self.events_queue = queue.Queue()
        
        # Create dummy data
        if not os.path.exists(self.csv_dir):
            os.makedirs(self.csv_dir)
        
        with open(os.path.join(self.csv_dir, "AAPL.csv"), "w") as f:
            f.write("Date,Open,High,Low,Close,Volume,Adj Close\n")
            f.write("2023-01-01,100.0,105.0,99.0,102.0,1000,102.0\n")
            f.write("2023-01-02,102.0,103.0,101.0,101.0,500,101.0\n")

    def tearDown(self):
        if os.path.exists(self.csv_dir):
            shutil.rmtree(self.csv_dir)

    def test_load_and_update(self):
        data_handler = HistoricCSVDataHandler(self.events_queue, self.csv_dir, self.symbol_list)
        
        # Test getting the first bar
        data_handler.update_bars()
        latest_bar = data_handler.get_latest_bar("AAPL")
        
        # Latest bar is (timestamp, series)
        self.assertIsNotNone(latest_bar)
        # Accessing series data
        self.assertEqual(latest_bar[1]['close'], 102.0)
        
        # Check event queue
        self.assertFalse(self.events_queue.empty())
        event = self.events_queue.get()
        self.assertEqual(event.type, 'MARKET')

        # Test getting second bar
        data_handler.update_bars()
        latest_bar = data_handler.get_latest_bar("AAPL")
        self.assertEqual(latest_bar[1]['close'], 101.0)
        
        # Check end of data
        data_handler.update_bars()
        self.assertFalse(data_handler.continue_backtest)

if __name__ == '__main__':
    unittest.main()
