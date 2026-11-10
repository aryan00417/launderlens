-- Stage 2: keep the detected pattern and its plain-language reason with each case alert.
ALTER TABLE case_alerts ADD COLUMN pattern TEXT, ADD COLUMN reason TEXT;
