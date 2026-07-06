"""
Normalized RFID storage + station-session tracker.

Implements the layered pipeline from Database.md:

    raw read  ->  rfid_raw_reads   (append-only source of truth)
              ->  rfid_tags        (find/create by EPC)
              ->  parts + part_tag_assignments (auto-created from decoded EPC)
              ->  part_station_events (ENTER / EXIT)
              ->  part_station_sessions (dwell time + status)

Antenna role (Entry / Exit) is resolved per-station from rfid_antennas, so
"entrance" and "exit" are relative to the machine, not hardcoded numbers.

Session lifecycle
-----------------
  open      : first valid Entry read (after MIN_READS_FOR_SESSION threshold)
  closed    : last valid Exit read on antenna 2 after idle -> dwell = exit_time - entry_time
  abandoned : Entry seen but no Exit within ABANDON_TIMEOUT_SEC
  exit_only : Exit read with no prior Entry

Exit time is the timestamp of the last valid read at the Exit antenna (antenna 2, rssi >= EXIT_RSSI_MIN).
Weaker exit reads are stored in rfid_raw_reads but ignored for session close.
After EXIT_IDLE_TIMEOUT_SEC with no new valid exit reads, the sweeper closes (exit_time = last valid read).
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database.migrate import run_migrations
from epc_type_map import format_tag_id, parse_tag_id
from config import (
    RSSI_MIN,
    EXIT_RSSI_MIN,
    MIN_READS_FOR_SESSION,
    EPC_FILTER_PATTERN,
    ENTER_EVENT,
    EXIT_EVENT,
    STATUS_OPEN,
    STATUS_CLOSED,
    STATUS_ABANDONED,
    STATUS_EXIT_ONLY,
    RAW_THROTTLE_SEC,
    IDLE_TIMEOUT_SEC,
    EXIT_IDLE_TIMEOUT_SEC,
    SWEEP_INTERVAL_SEC,
    ABANDON_TIMEOUT_SEC,
    DB_PATH,
    STATION_NAME,
    STATION_TYPE,
    STATION_LOCATION,
    READER_NAME,
    READER_IP,
    ENTRY_ANTENNA,
    EXIT_ANTENNA,
)

_DEFAULT_DB = DB_PATH

# Reject reads whose reader timestamp is older than this vs. server time (stale/replayed)
STALE_READ_SEC = 900.0  # 15 min


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_ts(value: str) -> Optional[datetime]:
    """Parse the reader's ISO timestamp like '2026-05-22T23:40:14.471+0000'."""
    if not value:
        return None
    v = value.strip()
    if len(v) >= 5 and (v[-5] in "+-") and v[-3] != ":":
        v = v[:-2] + ":" + v[-2:]
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _valid_rssi(rssi) -> bool:
    if rssi is None:
        return False
    try:
        r = int(rssi)
    except (TypeError, ValueError):
        return False
    return RSSI_MIN <= r <= 0


def _valid_exit_rssi(rssi) -> bool:
    """True when an exit-antenna read counts toward exit_time (last valid read wins)."""
    if rssi is None:
        return False
    try:
        r = int(rssi)
    except (TypeError, ValueError):
        return False
    return r >= EXIT_RSSI_MIN and r <= 0


def _decode_epc(epc: str) -> str:
    try:
        raw = bytes.fromhex(epc).rstrip(b"\x00").decode("ascii", errors="replace")
    except Exception:
        raw = epc
    return format_tag_id(raw)


def _epc_matches_filter(epc: str) -> bool:
    decoded = _decode_epc(epc)
    if not parse_tag_id(decoded)["is_known"]:
        return False
    if not EPC_FILTER_PATTERN:
        return True
    return re.fullmatch(EPC_FILTER_PATTERN, decoded) is not None


# ── Open session in-memory state ──────────────────────────────────────────────

class _Session:
    """Tracks an open part_station_sessions row for one tag at this station."""
    __slots__ = (
        "session_id", "tag_id", "part_id", "epc",
        "entry_ts", "exit_ts", "exit_rssi", "last_seen_wall",
        "last_exit_wall", "has_exit",
    )

    def __init__(self, session_id, tag_id, part_id, epc, entry_ts):
        self.session_id = session_id
        self.tag_id = tag_id
        self.part_id = part_id
        self.epc = epc
        self.entry_ts: Optional[datetime] = entry_ts
        self.exit_ts: Optional[datetime] = None
        self.exit_rssi: Optional[int] = None
        self.has_exit = False
        self.last_seen_wall = datetime.now(timezone.utc)
        self.last_exit_wall: Optional[datetime] = None


# ── Tracker ───────────────────────────────────────────────────────────────────

class DwellTracker:
    def __init__(
        self,
        db_path: os.PathLike | str = _DEFAULT_DB,
        station_name: str = STATION_NAME,
        station_type: str = STATION_TYPE,
        station_location: str = STATION_LOCATION,
        reader_name: str = READER_NAME,
        reader_ip: str = READER_IP,
    ):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            self.db_path, check_same_thread=False, isolation_level=None
        )
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        self._conn.execute("PRAGMA busy_timeout=5000;")

        run_migrations(
            self._conn,
            station_name=station_name,
            station_type=station_type,
            station_location=station_location,
            reader_name=reader_name,
            reader_ip=reader_ip,
            entry_antenna=ENTRY_ANTENNA,
            exit_antenna=EXIT_ANTENNA,
        )

        # Resolve this machine's station + reader + antenna roles
        self._station_id = self._lookup_station(station_name)
        self._reader_id = self._lookup_reader(reader_name)
        self._antenna_roles = self._load_antenna_roles(self._reader_id)  # port -> (id, role)

        self._open: dict[str, _Session] = {}       # epc -> _Session
        self._last_raw: dict[tuple[str, int], float] = {}
        self._read_counts: dict[tuple[str, int], int] = {}

        self._recover_open_sessions()

        self._stop_evt = threading.Event()
        self._sweeper = threading.Thread(
            target=self._sweep_loop, name="dwell-sweeper", daemon=True
        )
        self._sweeper.start()

    # ── config lookups ────────────────────────────────────────────────────

    def _lookup_station(self, station_name: str) -> Optional[int]:
        row = self._conn.execute(
            "SELECT station_id FROM stations WHERE station_name = ?", (station_name,)
        ).fetchone()
        return row[0] if row else None

    def _lookup_reader(self, reader_name: str) -> Optional[int]:
        row = self._conn.execute(
            "SELECT reader_id FROM rfid_readers WHERE reader_name = ?", (reader_name,)
        ).fetchone()
        return row[0] if row else None

    def _load_antenna_roles(self, reader_id) -> dict[int, tuple[int, str]]:
        roles: dict[int, tuple[int, str]] = {}
        if reader_id is None:
            return roles
        for aid, port, role in self._conn.execute(
            "SELECT antenna_id, antenna_port, antenna_role FROM rfid_antennas WHERE reader_id = ?",
            (reader_id,),
        ):
            roles[int(port)] = (aid, role)
        return roles

    # ── tag / part resolution ─────────────────────────────────────────────

    def _find_or_create_tag(self, epc: str) -> int:
        row = self._conn.execute(
            "SELECT tag_id FROM rfid_tags WHERE epc = ?", (epc,)
        ).fetchone()
        if row:
            return row[0]
        cur = self._conn.execute(
            "INSERT INTO rfid_tags (epc) VALUES (?)", (epc,)
        )
        return cur.lastrowid

    def _find_or_create_part(self, tag_id: int, decoded_epc: str) -> Optional[int]:
        """Return the part currently assigned to this tag, creating one from the
        decoded EPC (qty/part#/type/work-order) if no active assignment exists."""
        row = self._conn.execute(
            "SELECT part_id FROM part_tag_assignments "
            "WHERE tag_id = ? AND unassigned_at IS NULL "
            "ORDER BY assignment_id DESC LIMIT 1",
            (tag_id,),
        ).fetchone()
        if row:
            return row[0]

        p = parse_tag_id(decoded_epc)
        try:
            qty = int(p["qty"]) if p.get("qty") is not None else None
        except (TypeError, ValueError):
            qty = None

        cur = self._conn.execute(
            "INSERT INTO parts (part_number, part_name, part_type, ibus_number, "
            "                   job_number, quantity_required) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                p.get("part_number"),
                p.get("part_number"),
                p.get("type_label"),
                p.get("raw"),
                p.get("work_order"),
                qty,
            ),
        )
        part_id = cur.lastrowid
        self._conn.execute(
            "INSERT INTO part_tag_assignments (part_id, tag_id) VALUES (?, ?)",
            (part_id, tag_id),
        )
        return part_id

    # ── recovery ──────────────────────────────────────────────────────────

    def _recover_open_sessions(self) -> None:
        with self._lock:
            rows = self._conn.execute(
                "SELECT s.session_id, s.tag_id, s.part_id, t.epc, "
                "       s.entry_time, s.exit_time, s.session_status "
                "FROM part_station_sessions s "
                "JOIN rfid_tags t ON s.tag_id = t.tag_id "
                "WHERE s.station_id = ? AND s.session_status IN (?, ?)",
                (self._station_id, STATUS_OPEN, STATUS_EXIT_ONLY),
            ).fetchall()

        for sid, tag_id, part_id, epc, entry_time, exit_time, status in rows:
            sess = _Session(sid, tag_id, part_id, epc, _parse_ts(entry_time) if entry_time else None)
            sess.exit_ts = _parse_ts(exit_time) if exit_time else None
            sess.has_exit = sess.exit_ts is not None
            self._open[epc] = sess

    # ── public API ────────────────────────────────────────────────────────

    def ingest_batch(self, events: Iterable[dict]) -> dict:
        summary = {
            "raw_inserted":   0,
            "raw_throttled":  0,
            "raw_rejected":   0,
            "raw_stale":      0,
            "session_opened": 0,
            "session_closed": 0,
        }

        ordered = []
        for ev in events or []:
            dt = _parse_ts(ev.get("timestamp", ""))
            if dt is None:
                dt = datetime.now(timezone.utc)
            ordered.append((dt, ev))
        ordered.sort(key=lambda x: x[0])

        # Strongest-signal-wins within a 100ms window per EPC + antenna (never drop exit for entry)
        WINNER_WINDOW_SEC = 0.10
        epc_best: dict[tuple[str, int], tuple[datetime, dict, int]] = {}
        for reader_dt, ev in ordered:
            data = ev.get("data") or {}
            epc = (data.get("idHex") or data.get("epc") or "").lower()
            if not epc:
                continue
            try:
                antenna_port = int(data.get("antenna") or 0)
                rssi_val = int(data.get("peakRssi"))
            except (TypeError, ValueError):
                continue
            if antenna_port == 0:
                continue
            dedupe_key = (epc, antenna_port)
            existing = epc_best.get(dedupe_key)
            if existing is None or (reader_dt - existing[0]).total_seconds() > WINNER_WINDOW_SEC:
                epc_best[dedupe_key] = (reader_dt, ev, rssi_val)
            elif rssi_val > existing[2]:
                epc_best[dedupe_key] = (reader_dt, ev, rssi_val)

        winners = sorted(epc_best.values(), key=lambda x: x[0])

        with self._lock:
            for reader_dt, ev, _rssi in winners:
                data = ev.get("data") or {}
                epc_hex = (data.get("idHex") or data.get("epc") or "").lower()
                if not epc_hex or not _epc_matches_filter(epc_hex):
                    continue
                epc = _decode_epc(epc_hex)

                antenna_port = int(data.get("antenna") or 0)
                if antenna_port == 0:
                    continue

                rssi = data.get("peakRssi")
                if not _valid_rssi(rssi):
                    summary["raw_rejected"] += 1
                    continue
                rssi = int(rssi)

                now = datetime.now(timezone.utc)
                is_stale = (now - reader_dt).total_seconds() > STALE_READ_SEC
                reader_iso = reader_dt.isoformat()

                # ── 1. tag + part identity ─────────────────────────────
                tag_id = self._find_or_create_tag(epc)
                part_id = self._find_or_create_part(tag_id, epc)

                # ── 2. append-only raw read (source of truth) ──────────
                ant = self._antenna_roles.get(antenna_port)
                antenna_id = ant[0] if ant else None
                role = ant[1] if ant else None
                if is_stale:
                    read_status = "stale"
                elif role == "Exit" and not _valid_exit_rssi(rssi):
                    read_status = "ignored"  # logged, below EXIT_RSSI_MIN — not used for close
                else:
                    read_status = "valid"
                self._conn.execute(
                    "INSERT INTO rfid_raw_reads "
                    "(tag_id, epc, reader_id, antenna_id, antenna_port, rssi, "
                    " reader_timestamp, raw_payload, read_status, is_stale) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (tag_id, epc, self._reader_id, antenna_id, antenna_port, rssi,
                     reader_iso, None, read_status,
                     1 if is_stale else 0),
                )
                summary["raw_inserted"] += 1

                if is_stale:
                    summary["raw_stale"] += 1
                    continue  # never drive session logic from stale reads

                # ── 3. throttle / debounce ─────────────────────────────
                key = (epc, antenna_port)
                now_epoch = reader_dt.timestamp()
                last = self._last_raw.get(key, 0.0)
                if now_epoch - last >= RAW_THROTTLE_SEC:
                    self._last_raw[key] = now_epoch
                    self._read_counts[key] = 1
                else:
                    summary["raw_throttled"] += 1
                    self._read_counts[key] = self._read_counts.get(key, 0) + 1

                # ── 4. event + session logic (role-based) ──────────────
                if role == "Entry":
                    self._handle_entry(epc, tag_id, part_id, reader_dt, reader_iso, key, summary)
                elif role == "Exit":
                    self._handle_exit(epc, tag_id, part_id, reader_dt, rssi, summary)

        return summary

    # ── entry / exit handlers ─────────────────────────────────────────────

    def _handle_entry(self, epc, tag_id, part_id, reader_dt, reader_iso, key, summary):
        sess = self._open.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc)
            sess = None

        # A new entry after a completed pass -> close the stale one first
        if sess is not None and sess.has_exit:
            self._finalize(sess, STATUS_CLOSED)
            summary["session_closed"] += 1
            sess = None

        if sess is None:
            if self._read_counts.get(key, 0) < MIN_READS_FOR_SESSION:
                return
            event_id = self._insert_event(part_id, tag_id, ENTER_EVENT, reader_iso)
            cur = self._conn.execute(
                "INSERT INTO part_station_sessions "
                "(part_id, tag_id, station_id, entry_event_id, entry_time, session_status) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (part_id, tag_id, self._station_id, event_id, reader_iso, STATUS_OPEN),
            )
            new_sess = _Session(cur.lastrowid, tag_id, part_id, epc, reader_dt)
            self._open[epc] = new_sess
            summary["session_opened"] += 1
        else:
            sess.last_seen_wall = datetime.now(timezone.utc)
            self._touch_session(sess.session_id)

    def _handle_exit(self, epc, tag_id, part_id, reader_dt, rssi, summary):
        """Exit time = last valid read at the exit antenna (rssi >= EXIT_RSSI_MIN)."""
        sess = self._open.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc)
            sess = None
        if sess is None:
            return
        if sess.entry_ts is not None and reader_dt < sess.entry_ts:
            return  # exit earlier than entry -> ignore
        if not _valid_exit_rssi(rssi):
            return  # weak exit — logged in rfid_raw_reads only

        now = datetime.now(timezone.utc)
        sess.last_seen_wall = now
        sess.has_exit = True
        sess.last_exit_wall = now

        # Last valid exit read wins (reader time, then stronger RSSI on tie).
        if (
            sess.exit_ts is None
            or reader_dt > sess.exit_ts
            or (reader_dt == sess.exit_ts and rssi > (sess.exit_rssi or -999))
        ):
            sess.exit_ts = reader_dt
            sess.exit_rssi = rssi

        self._touch_session(sess.session_id)

    # ── DB write helpers ──────────────────────────────────────────────────

    def _insert_event(self, part_id, tag_id, event_type, event_iso) -> int:
        cur = self._conn.execute(
            "INSERT INTO part_station_events "
            "(part_id, tag_id, station_id, event_type, event_time) "
            "VALUES (?, ?, ?, ?, ?)",
            (part_id, tag_id, self._station_id, event_type, event_iso),
        )
        return cur.lastrowid

    def _touch_session(self, session_id: int) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            "UPDATE part_station_sessions SET updated_at = ? WHERE session_id = ?",
            (now_iso, session_id),
        )

    def _session_still_open(self, session_id: int) -> bool:
        """True if the DB row is still an active session (may differ from in-memory cache)."""
        row = self._conn.execute(
            "SELECT session_status FROM part_station_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return row is not None and row[0] in (STATUS_OPEN, STATUS_EXIT_ONLY)

    def _drop_stale_open(self, epc: str) -> None:
        """Forget an in-memory session that was closed externally (e.g. manual end via API)."""
        self._open.pop(epc, None)

    def open_session_count(self) -> int:
        with self._lock:
            return len(self._open)

    def close(self) -> None:
        self._stop_evt.set()
        try:
            self._sweeper.join(timeout=2.0)
        except RuntimeError:
            pass
        with self._lock:
            self._conn.close()

    # ── background sweeper ────────────────────────────────────────────────

    def _sweep_loop(self) -> None:
        while not self._stop_evt.wait(SWEEP_INTERVAL_SEC):
            try:
                self._sweep_once()
            except Exception as exc:
                print(f"[dwell-sweeper] error: {exc}")

    def _exit_idle_timeout(self) -> float:
        return EXIT_IDLE_TIMEOUT_SEC

    def _sweep_once(self) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            for epc in list(self._open.keys()):
                sess = self._open[epc]
                if not self._session_still_open(sess.session_id):
                    self._drop_stale_open(epc)
                    continue

                if sess.has_exit:
                    ref = sess.last_exit_wall or sess.last_seen_wall
                    idle = (now - ref).total_seconds()
                    if idle >= self._exit_idle_timeout():
                        self._finalize(sess, STATUS_CLOSED)
                    continue

                idle = (now - sess.last_seen_wall).total_seconds()
                if sess.entry_ts is None:
                    if idle >= IDLE_TIMEOUT_SEC:
                        self._finalize(sess, STATUS_EXIT_ONLY)
                elif idle >= ABANDON_TIMEOUT_SEC:
                    self._finalize(sess, STATUS_ABANDONED)

    # ── finalize ──────────────────────────────────────────────────────────

    def _finalize(self, sess: _Session, status: str) -> None:
        """Close a session. Exit time/dwell come from the last exit-antenna read."""
        now_iso = datetime.now(timezone.utc).isoformat()

        if sess.has_exit and sess.exit_ts is not None:
            exit_iso = sess.exit_ts.isoformat()
            event_id = self._insert_event(sess.part_id, sess.tag_id, EXIT_EVENT, exit_iso)
            if sess.entry_ts is not None:
                dwell = int(round((sess.exit_ts - sess.entry_ts).total_seconds()))
                final_status = STATUS_CLOSED
            else:
                dwell = None
                final_status = STATUS_EXIT_ONLY
            self._conn.execute(
                "UPDATE part_station_sessions "
                "SET exit_event_id = ?, exit_time = ?, dwell_seconds = ?, "
                "    session_status = ?, updated_at = ? "
                "WHERE session_id = ?",
                (event_id, exit_iso, dwell, final_status, now_iso, sess.session_id),
            )
        else:
            self._conn.execute(
                "UPDATE part_station_sessions "
                "SET session_status = ?, updated_at = ? WHERE session_id = ?",
                (status, now_iso, sess.session_id),
            )
        self._open.pop(sess.epc, None)
