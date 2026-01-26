import os
import pandas as pd
from ..events import MarketEvent
from .data_handler import DataHandler

class HistoricCSVDataHandler(DataHandler):
    """
    HistoricCSVDataHandler is designed to read CSV files for
    each requested symbol from disk and provide an interface
    to obtain the 'latest' bar in a manner identical to a live
    trading interface.
    """

    def __init__(self, events_queue, csv_dir, symbol_list):
        """
        Initializes the historic data handler by requesting
        the location of the CSV files and a list of symbols.

        Parameters:
        events_queue - The Event Queue.
        csv_dir - Absolute directory path to the CSV files.
        symbol_list - A list of symbol strings.
        """
        self.events_queue = events_queue
        self.csv_dir = csv_dir
        self.symbol_list = symbol_list

        self.symbol_data = {}
        self.latest_symbol_data = {}
        self.continue_backtest = True
        
        self._open_convert_csv_files()

    def _open_convert_csv_files(self):
        """
        Opens the CSV files from the data directory, converting
        them into pandas DataFrames within a symbol dictionary.
        """
        comb_index = None

        for s in self.symbol_list:
            # Load the CSV file with no header information, indexed on date
            file_path = os.path.join(self.csv_dir, f"{s}.csv")
            
            if not os.path.exists(file_path):
                print(f"Warning: File {file_path} not found.")
                self.symbol_data[s] = pd.DataFrame()
                continue

            self.symbol_data[s] = pd.read_csv(
                file_path, 
                header=0, 
                index_col=0, 
                parse_dates=True,
                names=['datetime', 'open', 'high', 'low', 'close', 'volume']
            )
            # Combine the index to a column for standardized iteration
            self.symbol_data[s].sort_index(inplace=True)
            self.latest_symbol_data[s] = []
            
            # Create an iterator/generator for the data
            self.symbol_data[s] = self.symbol_data[s].iterrows()

    def _get_new_bar(self, symbol):
        """
        Returns the latest bar from the data feed.
        """
        try:
            return next(self.symbol_data[symbol])
        except StopIteration:
            return None

    def get_latest_bar(self, symbol):
        """
        Returns the last bar from the latest_symbol_data list.
        """
        try:
            return self.latest_symbol_data[symbol][-1]
        except IndexError:
            return None

    def update_bars(self):
        """
        Pushes the latest bar to the valid_symbol_data structure 
        for all symbols in the symbol list.
        """
        for s in self.symbol_list:
            try:
                bar = self._get_new_bar(s)
            except Exception:
                self.continue_backtest = False
                return

            if bar is not None:
                # bar is a tuple (index, series)
                # Timestamp is the index
                timestamp = bar[0]
                data = bar[1]
                
                # Append to latest_symbol_data
                self.latest_symbol_data[s].append((timestamp, data))
                
                # Push MarketEvent to queue
                market_event = MarketEvent() 
                self.events_queue.put(market_event)
            else:
                self.continue_backtest = False
