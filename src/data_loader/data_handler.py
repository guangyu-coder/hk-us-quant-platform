from abc import ABC, abstractmethod
import pandas as pd

class DataHandler(ABC):
    """
    DataHandler is an abstract base class providing an interface for
    all subsequent (inherited) data handlers (both live and historic).
    """

    @abstractmethod
    def get_latest_bar(self, symbol):
        """
        Returns the last bar updated.
        """
        raise NotImplementedError("Should implement get_latest_bar()")

    @abstractmethod
    def update_bars(self):
        """
        Pushes the latest bars to the bars_queue for each symbol
        in a tuple format: (symbol, datetime, open, high, low, close, volume).
        """
        raise NotImplementedError("Should implement update_bars()")
