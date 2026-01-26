---
name: code_standards
description: Official coding standards for the Quant Trading Platform, covering Python and Rust.
---

# Quant Trading Platform - Coding Standards

This skill defines the coding standards and best practices for this project. The agent MUST follow these guidelines when writing or refactoring code.

## 1. General Principles
- **Clarity over Cleverness**: Code should be easy to read and debug.
- **Robust Error Handling**: Quantitative systems handle money; silent failures are unacceptable.
- **Performance**: Critical paths (data ingestion, strategy execution) must be optimized.

## 2. Python Standards (Data Analysis & Scripts)
Used primarily for data loading, analysis, and prototyping.

### 2.1 Style & Formatting
- **Type Hints**: ALL function signatures must have type hints.
  ```python
  def calculate_ma(prices: list[float], window: int) -> list[float]:
      ...
  ```
- **Docstrings**: Use **Google Style** docstrings.
  ```python
  def fetch_data(symbol: str) -> pd.DataFrame:
      """Fetches historical data for a symbol.

      Args:
          symbol: The ticker symbol (e.g., 'AAPL').

      Returns:
          DataFrame containing OHLCV data.
      """
  ```

### 2.2 Libraries
- Use **Pandas** and **NumPy** for vector operations. Avoid explicitly looping over data where vectorization is possible.
- Use `pathlib` instead of `os.path`.

## 3. Rust Standards (Core System)
Used for the high-performance core engine.

### 3.1 Style & Idioms
- **Error Handling**: Use `Result<T, AppError>` for fallible operations. Do NOT use `unwrap()` or `expect()` in production code; handle errors gracefully.
- **Conciseness**: Prefer idiomatic Rust (e.g., iterators, `map`, `filter`) over imperative loops.

### 3.2 Documentation
- Public structs and functions must have documentation comments (`///`).
- Include usage examples in documentation where complex logic is involved.

## 4. Testing
- **Unit Tests**: Every new feature requires a corresponding unit test.
- **Python**: Use `pytest`.
- **Rust**: Use built-in `#[test]` modules.
