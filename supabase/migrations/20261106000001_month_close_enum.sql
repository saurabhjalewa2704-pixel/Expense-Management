-- Month-end close (MONTH-CLOSE-PRD.md): the new transaction source. A new enum value cannot be used in the transaction that adds it, so
-- it lives in its own migration, applied before 20261106000002_month_close.sql.
alter type txn_source add value if not exists 'close';
