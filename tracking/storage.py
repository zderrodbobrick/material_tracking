"""
Normalized RFID storage + station-session tracker.

Implements the layered pipeline from Database.md:

    raw read  ->  rfid_raw_reads   (append-only source of truth)
              ->  rfid_tags        (find/create by EPC)
              ->  parts + part_tag_assignments (auto-created from decoded EPC)
              ->  part_station_events (ENTER / EXIT)
              ->  part_station_sessions (dwell time + status)

Session modes
-------------
  Dwell (Gannomat, Tennoner):
    Entry antenna opens a session; a dedicated closer ends it with dwell_seconds.
    Gannomat: ant 1 opens; ant 2 = at exit (does NOT close); ant 3 Insert closes.
    Tennoner: ant 7 opens; ant 4/5 mark exit-table (dwell timer stops, session
    stays open for map); LBD ant 6 closes the Tennoner visit (one session per part).

  Presence (LBD, Insert Station):
    A valid read means the part is there. Idle timeout without reads means
    it is not there (session closed). No enter/exit dwell pair.
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
from rtls_storage import try_assign_on_session_open, finalize_session_operators
from config import (
    RSSI_MIN,
    EXIT_RSSI_MIN,
    THIRD_RSSI_MIN,
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
    THIRD_ANTENNA,
    INSERT_STATION_NAME,
    TENONER_ENTRY_ANTENNA,
    TENONER_EXIT_ANTENNAS,
    LBD_ANTENNA,
    DWELL_STATIONS,
    PRESENCE_STATIONS,
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
    """True when an exit-antenna read is strong enough to log a warning."""
    if rssi is None:
        return False
    try:
        r = int(rssi)
    except (TypeError, ValueError):
        return False
    return r >= EXIT_RSSI_MIN and r <= 0


def _wo_digits_from_epc(epc: str | None) -> str | None:
    """Extract 6-digit work-order suffix from a compact or labeled EPC."""
    if not epc:
        return None
    s = str(epc).strip().upper()
    m = re.search(r"IBUS(\d{6})", s)
    if m:
        return m.group(1)
    # Compact: 1T10900001 → 900001 (qty + ref + 0 + wo)
    if len(s) >= 7 and s[-7] == "0" and s[-6:].isdigit():
        return s[-6:]
    if len(s) >= 6 and s[-6:].isdigit():
        return s[-6:]
    return None


def _valid_third_rssi(rssi) -> bool:
    """True when an antenna-3 read is strong enough to end Gannomat dwell."""
    if rssi is None:
        return False
    try:
        r = int(rssi)
    except (TypeError, ValueError):
        return False
    return r >= THIRD_RSSI_MIN and r <= 0


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
    """Tracks an open part_station_sessions row for one tag at one station."""
    __slots__ = (
        "session_id", "tag_id", "part_id", "epc", "station_id",
        "entry_ts", "exit_ts", "exit_rssi", "last_seen_wall",
        "last_exit_wall", "has_exit", "awaiting_insert",
    )

    def __init__(self, session_id, tag_id, part_id, epc, station_id, entry_ts):
        self.session_id = session_id
        self.tag_id = tag_id
        self.part_id = part_id
        self.epc = epc
        self.station_id = station_id
        self.entry_ts: Optional[datetime] = entry_ts
        self.exit_ts: Optional[datetime] = None
        self.exit_rssi: Optional[int] = None
        self.has_exit = False
        self.awaiting_insert = False
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
            third_antenna=THIRD_ANTENNA,
            insert_station_name=INSERT_STATION_NAME,
        )

        # Resolve this machine's station + reader + antenna roles
        self._station_id = self._lookup_station(station_name)
        self._insert_station_id = self._lookup_station(INSERT_STATION_NAME)
        self._tenoner_station_id = self._lookup_station("Tennoner")
        self._lbd_station_id = self._lookup_station("LBD")
        self._reader_id = self._lookup_reader(reader_name)
        self._antenna_roles = self._load_antenna_roles(self._reader_id)  # port -> (id, role)
        self._antenna_stations = self._load_antenna_stations(self._reader_id)
        self._station_names = self._load_station_names()  # station_id -> name

        self._open: dict[str, _Session] = {}           # Gannomat dwell
        self._tenoner_open: dict[str, _Session] = {}   # Tennoner dwell
        self._presence_open: dict[str, _Session] = {}  # LBD / Insert presence
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

    def _load_antenna_stations(self, reader_id) -> dict[int, int]:
        """port -> station_id for antennas bound to a station."""
        out: dict[int, int] = {}
        if reader_id is None:
            return out
        for port, station_id in self._conn.execute(
            "SELECT antenna_port, station_id FROM rfid_antennas "
            "WHERE reader_id = ? AND station_id IS NOT NULL",
            (reader_id,),
        ):
            out[int(port)] = int(station_id)
        return out

    def _load_station_names(self) -> dict[int, str]:
        return {
            int(sid): name
            for sid, name in self._conn.execute(
                "SELECT station_id, station_name FROM stations"
            )
        }

    def _all_open_buckets(self) -> tuple[dict[str, _Session], ...]:
        return (self._open, self._tenoner_open, self._presence_open)

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
        station_ids = {
            sid for sid in (
                self._station_id,
                self._insert_station_id,
                self._tenoner_station_id,
                self._lbd_station_id,
            ) if sid is not None
        }
        if not station_ids:
            return

        placeholders = ",".join("?" * len(station_ids))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT s.session_id, s.tag_id, s.part_id, t.epc, s.station_id, "
                f"       s.entry_time, s.exit_time, s.session_status "
                f"FROM part_station_sessions s "
                f"JOIN rfid_tags t ON s.tag_id = t.tag_id "
                f"WHERE s.station_id IN ({placeholders}) "
                f"AND s.session_status IN (?, ?)",
                (*station_ids, STATUS_OPEN, STATUS_EXIT_ONLY),
            ).fetchall()

        for sid, tag_id, part_id, epc, station_id, entry_time, exit_time, status in rows:
            sess = _Session(
                sid, tag_id, part_id, epc, station_id,
                _parse_ts(entry_time) if entry_time else None,
            )
            sess.has_exit = False
            sess.awaiting_insert = False
            sess.exit_ts = None
            sess.exit_rssi = None
            name = self._station_names.get(station_id, "")
            if station_id == self._station_id:
                self._open[epc] = sess
            elif station_id == self._tenoner_station_id:
                self._tenoner_open[epc] = sess
            elif name in PRESENCE_STATIONS or station_id in (
                self._insert_station_id, self._lbd_station_id
            ):
                self._presence_open[epc] = sess
            else:
                self._presence_open[epc] = sess

    # ── public API ────────────────────────────────────────────────────────

    def ingest_batch(self, events: Iterable[dict]) -> dict:
        summary = {
            "raw_inserted":   0,
            "raw_throttled":  0,
            "raw_rejected":   0,
            "raw_stale":      0,
            "session_opened": 0,
            "session_closed": 0,
            "exit_warnings":  0,
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
                    read_status = "ignored"
                elif antenna_port == THIRD_ANTENNA and not _valid_third_rssi(rssi):
                    read_status = "ignored"  # weak ant-3 — logged only, does not end dwell
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

                # ── 4. event + session logic (port-based) ──────────────
                if antenna_port == ENTRY_ANTENNA:
                    self._handle_dwell_entry(
                        epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                        bucket=self._open, station_id=self._station_id,
                    )
                elif antenna_port == EXIT_ANTENNA:
                    # Gannomat exit sighting: show at ant 2, do NOT close dwell.
                    # Dwell ends at Insert (ant 3) or when the part moves on.
                    if _valid_exit_rssi(rssi):
                        self._handle_gannomat_exit_sighting(
                            epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                        )
                elif antenna_port == TENONER_ENTRY_ANTENNA:
                    self._handle_dwell_entry(
                        epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                        bucket=self._tenoner_open, station_id=self._tenoner_station_id,
                    )
                elif antenna_port in TENONER_EXIT_ANTENNAS:
                    if _valid_exit_rssi(rssi):
                        at_table = self._handle_tennoner_exit_sighting(
                            epc, tag_id, part_id, reader_dt, rssi, summary,
                        )
                        # Exit-only (no ant-7 entry): still show part at table.
                        if not at_table:
                            self._handle_presence(
                                epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                                station_id=self._tenoner_station_id,
                                force=True,
                            )
                elif antenna_port == LBD_ANTENNA:
                    self._handle_presence(
                        epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                        station_id=self._lbd_station_id,
                    )
                elif antenna_port == THIRD_ANTENNA:
                    # Insert: presence only. If Gannomat dwell still open, close it first.
                    if self._open.get(epc) is not None and _valid_third_rssi(rssi):
                        if self._read_counts.get(key, 0) >= MIN_READS_FOR_SESSION:
                            g = self._open[epc]
                            if self._session_still_open(g.session_id):
                                g.exit_ts = reader_dt
                                g.exit_rssi = int(rssi) if rssi is not None else None
                                g.has_exit = True
                                self._finalize(g, STATUS_CLOSED, self._open)
                                summary["session_closed"] = summary.get("session_closed", 0) + 1
                    if _valid_third_rssi(rssi):
                        self._handle_presence(
                            epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                            station_id=self._insert_station_id,
                        )

        return summary

    # ── entry / exit / presence handlers ────────────────────────────────────

    def _close_other_buckets(self, epc: str, keep: dict, summary: dict) -> None:
        for bucket in self._all_open_buckets():
            if bucket is keep:
                continue
            other = bucket.get(epc)
            if other is None:
                continue
            if self._session_still_open(other.session_id):
                # Presence/dwell closed by moving on — record end time for dwell calc when possible
                if other.entry_ts is not None and not other.has_exit:
                    other.exit_ts = datetime.now(timezone.utc)
                    other.has_exit = True
                self._finalize(other, STATUS_CLOSED, bucket)
                summary["session_closed"] = summary.get("session_closed", 0) + 1
            else:
                self._drop_stale_open(epc, bucket)

    def _handle_dwell_entry(
        self, epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
        *, bucket: dict, station_id: Optional[int],
    ):
        if station_id is None:
            return
        sess = bucket.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc, bucket)
            sess = None

        if sess is not None:
            sess.last_seen_wall = datetime.now(timezone.utc)
            self._touch_session(sess.session_id)
            return

        if self._read_counts.get(key, 0) < MIN_READS_FOR_SESSION:
            return

        self._close_other_buckets(epc, bucket, summary)

        event_id = self._insert_event(
            part_id, tag_id, ENTER_EVENT, reader_iso, station_id
        )
        cur = self._conn.execute(
            "INSERT INTO part_station_sessions "
            "(part_id, tag_id, station_id, entry_event_id, entry_time, session_status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (part_id, tag_id, station_id, event_id, reader_iso, STATUS_OPEN),
        )
        new_sess = _Session(
            cur.lastrowid, tag_id, part_id, epc, station_id, reader_dt
        )
        bucket[epc] = new_sess
        summary["session_opened"] += 1
        try_assign_on_session_open(new_sess.session_id, station_id)

    def _handle_dwell_exit(
        self, epc, tag_id, part_id, reader_dt, rssi, summary,
        *, bucket: dict, antenna_label: str,
    ):
        """Close an open dwell session and compute dwell_seconds."""
        sess = bucket.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc, bucket)
            sess = None
        if sess is None:
            # Caller may still open presence so the part stays visible at the table.
            print(
                f"[dwell] {antenna_label}: no open dwell to close for epc={epc!r}",
                flush=True,
            )
            return
        if sess.entry_ts is not None and reader_dt < sess.entry_ts:
            return
        if not _valid_exit_rssi(rssi):
            print(
                f"[dwell] {antenna_label}: exit ignored (weak RSSI={rssi}) epc={epc!r}",
                flush=True,
            )
            return

        sess.exit_ts = reader_dt
        sess.exit_rssi = int(rssi) if rssi is not None else None
        sess.has_exit = True
        sess.last_seen_wall = datetime.now(timezone.utc)
        self._finalize(sess, STATUS_CLOSED, bucket)
        summary["session_closed"] = summary.get("session_closed", 0) + 1
        dwell = None
        if sess.entry_ts is not None:
            dwell = int(round((reader_dt - sess.entry_ts).total_seconds()))
        print(
            f"[dwell] {antenna_label}: session closed epc={epc!r} dwell={dwell}s",
            flush=True,
        )

    def _handle_tennoner_exit_sighting(
        self, epc, tag_id, part_id, reader_dt, rssi, summary,
    ):
        """Antenna 4/5: part at exit table — stop dwell timer, keep one open session until LBD."""
        sess = self._tenoner_open.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc, self._tenoner_open)
            sess = None
        if sess is None:
            print(
                f"[dwell] Tennoner Exit Table: no open dwell for epc={epc!r}",
                flush=True,
            )
            return False
        if sess.entry_ts is not None and reader_dt < sess.entry_ts:
            return False
        if not _valid_exit_rssi(rssi):
            print(
                f"[dwell] Tennoner Exit Table: exit ignored (weak RSSI={rssi}) epc={epc!r}",
                flush=True,
            )
            return False

        sess.exit_ts = reader_dt
        sess.exit_rssi = int(rssi) if rssi is not None else None
        sess.has_exit = True
        sess.last_seen_wall = datetime.now(timezone.utc)
        self._touch_session(sess.session_id)
        dwell = None
        if sess.entry_ts is not None:
            dwell = int(round((reader_dt - sess.entry_ts).total_seconds()))
        print(
            f"[map] Tennoner table hold epc={epc!r} session={sess.session_id} "
            f"machine_dwell={dwell}s (closes at LBD)",
            flush=True,
        )
        return True

    def _handle_gannomat_exit_sighting(
        self, epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
    ):
        """Antenna 2: part is at Gannomat exit — keep dwell open, stay on map."""
        sess = self._open.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc, self._open)
            sess = None

        if sess is not None:
            sess.last_seen_wall = datetime.now(timezone.utc)
            self._touch_session(sess.session_id)
            print(
                f"[map] Gannomat Exit sighting epc={epc!r} "
                f"(dwell still open — closes at Insert)",
                flush=True,
            )
            return

        # No open dwell yet — still show the part at the exit antenna.
        if self._station_id is not None:
            self._handle_presence(
                epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
                station_id=self._station_id,
                force=True,
            )

    def _handle_presence(
        self, epc, tag_id, part_id, reader_dt, reader_iso, key, summary,
        *, station_id: Optional[int], force: bool = False,
    ):
        """Presence station: read => there; idle sweeper => not there."""
        if station_id is None:
            return
        if not force and self._read_counts.get(key, 0) < MIN_READS_FOR_SESSION:
            return

        sess = self._presence_open.get(epc)
        if sess is not None and not self._session_still_open(sess.session_id):
            self._drop_stale_open(epc, self._presence_open)
            sess = None

        if sess is not None and sess.station_id == station_id:
            sess.last_seen_wall = datetime.now(timezone.utc)
            self._touch_session(sess.session_id)
            if station_id == self._insert_station_id:
                self._maybe_complete_ibus_order(epc, summary)
            return

        self._close_other_buckets(epc, self._presence_open, summary)
        # If switching presence station, drop old presence row
        old = self._presence_open.get(epc)
        if old is not None:
            if self._session_still_open(old.session_id):
                old.exit_ts = reader_dt
                old.has_exit = True
                self._finalize(old, STATUS_CLOSED, self._presence_open)
                summary["session_closed"] = summary.get("session_closed", 0) + 1
            else:
                self._drop_stale_open(epc, self._presence_open)

        event_id = self._insert_event(
            part_id, tag_id, ENTER_EVENT, reader_iso, station_id
        )
        cur = self._conn.execute(
            "INSERT INTO part_station_sessions "
            "(part_id, tag_id, station_id, entry_event_id, entry_time, session_status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (part_id, tag_id, station_id, event_id, reader_iso, STATUS_OPEN),
        )
        new_sess = _Session(
            cur.lastrowid, tag_id, part_id, epc, station_id, reader_dt
        )
        self._presence_open[epc] = new_sess
        summary["session_opened"] += 1
        try_assign_on_session_open(new_sess.session_id, station_id)
        st_name = self._station_names.get(station_id, station_id)
        print(
            f"[map] hold OPEN at {st_name} epc={epc!r} session={new_sess.session_id}",
            flush=True,
        )
        if station_id == self._insert_station_id:
            self._maybe_complete_ibus_order(epc, summary)

    def _expected_epcs_for_wo(self, wo_digits: str) -> list[str]:
        """BOM EPCs for this work order, else any currently-open siblings."""
        rows = self._conn.execute(
            "SELECT woc.epc FROM work_order_components woc "
            "JOIN work_orders wo ON wo.work_order_id = woc.work_order_id "
            "WHERE UPPER(wo.ibus_number) = ? OR wo.work_order = ?",
            (f"IBUS{wo_digits}", wo_digits),
        ).fetchall()
        epcs = [r[0] for r in rows if r and r[0]]
        if epcs:
            return epcs
        found: list[str] = []
        for bucket in self._all_open_buckets():
            for e in bucket:
                if _wo_digits_from_epc(e) == wo_digits and e not in found:
                    found.append(e)
        return found

    def _maybe_complete_ibus_order(self, epc: str, summary: dict) -> None:
        """When every BOM part is at Insert, close Insert holds → journey completed."""
        if self._insert_station_id is None:
            return
        wo = _wo_digits_from_epc(epc)
        if not wo:
            return
        expected = self._expected_epcs_for_wo(wo)
        if not expected:
            return

        for e in expected:
            sess = self._presence_open.get(e)
            if (
                sess is None
                or sess.station_id != self._insert_station_id
                or not self._session_still_open(sess.session_id)
            ):
                return
            for bucket in (self._open, self._tenoner_open):
                other = bucket.get(e)
                if other is not None and self._session_still_open(other.session_id):
                    return

        now = datetime.now(timezone.utc)
        closed = 0
        for e in expected:
            sess = self._presence_open.get(e)
            if sess is None:
                continue
            if sess.entry_ts is not None and not sess.has_exit:
                sess.exit_ts = now
                sess.has_exit = True
            self._finalize(sess, STATUS_CLOSED, self._presence_open)
            closed += 1
            summary["session_closed"] = summary.get("session_closed", 0) + 1

        if closed:
            summary["order_completed"] = summary.get("order_completed", 0) + 1
            print(
                f"[ibus] IBUS{wo} COMPLETE — {closed} parts finished at Insert",
                flush=True,
            )

    def try_complete_ibus_order(self, epc: str) -> bool:
        """Public hook (sim/tests): complete order if every part is at Insert."""
        summary: dict = {}
        with self._lock:
            self._maybe_complete_ibus_order(epc, summary)
        return bool(summary.get("order_completed"))

    # ── DB write helpers ──────────────────────────────────────────────────

    def _insert_event(self, part_id, tag_id, event_type, event_iso, station_id) -> int:
        cur = self._conn.execute(
            "INSERT INTO part_station_events "
            "(part_id, tag_id, station_id, event_type, event_time) "
            "VALUES (?, ?, ?, ?, ?)",
            (part_id, tag_id, station_id, event_type, event_iso),
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

    def _drop_stale_open(self, epc: str, bucket: dict[str, _Session]) -> None:
        """Forget an in-memory session that was closed externally (e.g. manual end via API)."""
        bucket.pop(epc, None)

    def open_session_count(self) -> int:
        with self._lock:
            return (
                len(self._open)
                + len(self._tenoner_open)
                + len(self._presence_open)
            )

    def close_open_sessions_for_epc(self, epc: str) -> int:
        """Force-close every open dwell/presence session for this EPC.

        Used by the sim when reseeding (move all 7) so the next entry
        starts a fresh dwell timer instead of touching the old session.
        """
        closed = 0
        now = datetime.now(timezone.utc)
        with self._lock:
            for bucket in self._all_open_buckets():
                sess = bucket.get(epc)
                if sess is None:
                    continue
                if not self._session_still_open(sess.session_id):
                    self._drop_stale_open(epc, bucket)
                    continue
                if sess.entry_ts is not None and not sess.has_exit:
                    sess.exit_ts = now
                    sess.has_exit = True
                self._finalize(sess, STATUS_CLOSED, bucket)
                closed += 1
            # Clear read debounce so the next burst can open a new session
            for key in list(self._read_counts.keys()):
                if key[0] == epc:
                    self._read_counts.pop(key, None)
                    self._last_raw.pop(key, None)
        return closed

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
            # Dwell sessions: abandon if no progress for a long time
            for bucket in (self._open, self._tenoner_open):
                for epc in list(bucket.keys()):
                    sess = bucket[epc]
                    if not self._session_still_open(sess.session_id):
                        self._drop_stale_open(epc, bucket)
                        continue
                    idle = (now - sess.last_seen_wall).total_seconds()
                    if sess.entry_ts is None:
                        if idle >= IDLE_TIMEOUT_SEC:
                            self._finalize(sess, STATUS_EXIT_ONLY, bucket)
                    elif idle >= ABANDON_TIMEOUT_SEC:
                        self._finalize(sess, STATUS_ABANDONED, bucket)

            # Presence:
            #   Insert — stay until abandon or order complete
            #   LBD — idle timeout (no reads => not there)
            #   (Tennoner table hold uses _tenoner_open dwell bucket, not presence)
            for epc in list(self._presence_open.keys()):
                sess = self._presence_open[epc]
                if not self._session_still_open(sess.session_id):
                    self._drop_stale_open(epc, self._presence_open)
                    continue
                idle = (now - sess.last_seen_wall).total_seconds()
                hold_ids = {self._insert_station_id}
                timeout = (
                    ABANDON_TIMEOUT_SEC
                    if sess.station_id in hold_ids
                    else IDLE_TIMEOUT_SEC
                )
                if idle >= timeout:
                    sess.exit_ts = now
                    sess.has_exit = True
                    self._finalize(sess, STATUS_CLOSED, self._presence_open)

    # ── finalize ──────────────────────────────────────────────────────────

    def _finalize(self, sess: _Session, status: str, bucket: dict[str, _Session]) -> None:
        """Close a session. Dwell stations set dwell_seconds = exit − entry."""
        now_iso = datetime.now(timezone.utc).isoformat()

        if sess.has_exit and sess.exit_ts is not None:
            exit_iso = sess.exit_ts.isoformat()
            event_id = self._insert_event(
                sess.part_id, sess.tag_id, EXIT_EVENT, exit_iso, sess.station_id
            )
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
        bucket.pop(sess.epc, None)
        try:
            finalize_session_operators(sess.session_id)
        except Exception:
            pass
