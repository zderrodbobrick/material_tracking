# Session lifecycle

How RFID reads become open and closed **part station sessions**, including dwell calculation, statuses, and background cleanup.

---

## Core concepts

**Session** — One visit by a tagged part to a logical station (Gannomat, Tennoner, LBD, Insert Station). Stored in `part_station_sessions`.

**Dwell** — Elapsed seconds between session entry and the event that closes the session (for dwell-mode stations).

**Event** — Atomic ENTER or EXIT record in `part_station_events`, linked to a raw read.

---

## Station modes

Configured in `config.py`:

| Mode | Stations | Behavior |
|------|----------|----------|
| **Dwell** | Gannomat, Tennoner | Entry antenna opens session; specific closer ends it with `dwell_seconds` |
| **Presence** | LBD, Insert Station | Valid read = part present; idle timeout without reads = gone |

### Gannomat dwell path (antennas 1 → 2 → 3)

1. **Antenna 1 (entry)** — Opens `open` session after `MIN_READS_FOR_SESSION` sustained reads
2. **Antenna 2 (exit)** — Marks exit-side activity; **does not close** the Gannomat session (config change from early two-antenna design)
3. **Antenna 3 (Insert Station)** — Strong read (`THIRD_RSSI_MIN`) closes Gannomat session as `closed` with dwell from first entry to Insert arrival

This models parts leaving Gannomat physically before Insert Station confirms completion.

### Tennoner dwell path

- **Antenna 7** — Entry, opens Tennoner session
- **Antennas 4 / 5** — Exit table reads; stop dwell timer visually but session may stay open for map tracking
- **Antenna 6 (LBD)** — Closes the Tennoner visit (one session per part through Tennoner)

### Presence stations (LBD, Insert)

Reads keep the session alive. The background **sweeper** closes the session after `IDLE_TIMEOUT_SEC` with no reads. No enter/exit pair is required.

---

## Session statuses

Stored in `part_station_sessions.session_status`:

| Status | Meaning |
|--------|---------|
| `open` | Part currently in or associated with the station |
| `closed` | Normal completion with dwell (where applicable) |
| `abandoned` | Entry without timely close — sweeper or manual end |
| `exit_only` | Exit-side activity without matching entry |

The dashboard maps these to human labels (In Process, Completed, etc.).

---

## Ingest flow (per batch)

`DwellTracker.ingest_batch()` in `tracking/storage.py`:

1. Filter by RSSI, EPC regex, stale timestamp (> 15 min skew rejected)
2. Strongest-signal-wins within 100 ms per EPC
3. Throttle duplicate (EPC, antenna) within `RAW_THROTTLE_SEC`
4. Insert `rfid_raw_reads`
5. Resolve or create `rfid_tags` and `parts` from decoded EPC
6. Emit ENTER/EXIT events and update or create sessions
7. On session open, attempt RTLS operator assignment (`rtls_storage.try_assign_on_session_open`)

Returns counters: `raw_inserted`, `session_opened`, `session_closed`, etc.

---

## Dwell calculation

For closed dwell sessions:

```
dwell_seconds = exit_time − entry_time
```

Times are ISO-8601 UTC. Integer seconds stored in `dwell_seconds`. Display strings (e.g. `14 min 22 sec`) computed in API helpers.

---

## Background sweeper

Daemon thread in `DwellTracker`, interval `SWEEP_INTERVAL_SEC`:

| Condition | Action |
|-----------|--------|
| Idle ≥ `IDLE_TIMEOUT_SEC`, no exit event | Finalize as `closed` or `exit_only` depending on events seen |
| Entrance only, idle ≥ `ABANDON_TIMEOUT_SEC` | `abandoned` |

Gannomat sessions intentionally use long `ABANDON_TIMEOUT_SEC` (default 4 hours) so parts stay tracked until Insert Station (ant 3) confirms.

---

## Re-entry and duplicate tags

If a part reads on entry while a previous session for the same tag at that station is still open, logic may finalize the old session before opening a new one.

Exit before entry timestamp is ignored.

---

## Manual session end

`POST /api/sessions/<session_id>/end` sets status to `abandoned`, sets exit time to now, calculates dwell from entry. Used from operator workflows when a part is removed without a clean RFID exit.

---

## Simulator vs production

`sim/run.py` calls the same `ingest_batch()` with synthetic events. Session behavior is identical; only the transport differs (no HTTP POST).

---

## Related

- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Configure Zebra reader](../how-to/configure-zebra-reader.md)
- [Configuration — timeouts](../reference/configuration.md)
