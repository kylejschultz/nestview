_VALID_STATES: dict[str, set[str]] = {
    "stop":    {"running", "restarting", "paused"},
    "restart": {"running", "restarting", "paused", "exited"},
    "start":   {"exited", "created", "dead"},
}
