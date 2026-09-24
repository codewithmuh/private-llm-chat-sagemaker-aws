"""JSON log lines for CloudWatch.

One JSON object per line is easy to search in CloudWatch Logs Insights, e.g.
`filter level = "ERROR" | stats count() by logger`.

Keep the privacy rule from settings: log ids, sizes, durations and status
codes. Never log prompts, answers, file contents, passwords or codes.
"""

from __future__ import annotations

import json
import logging

_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
}


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Anything passed with `extra={...}` becomes a top-level field.
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)
