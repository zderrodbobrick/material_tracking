"""
database/migrate.py
Versioned schema migration runner for the RFID tracking database.

Implements the normalized POC schema from Database.md (SQLite dialect):

  Core (9):
    rfid_tags, parts, part_tag_assignments,
    stations, rfid_readers, rfid_antennas,
    rfid_raw_reads, part_station_events, part_station_sessions

  Operators (3, tables only for now):
    operators, operator_station_presence, part_operator_assignments

  Plus view vw_live_part_status and all recommended indexes.

Both storage.py (DwellTracker) and api.py call run_migrations(conn, ...) on
startup. Migrations are numbered, each runs exactly once, and every migration
is idempotent so concurrent startups are safe.

Adding a new migration:
  1. Write a _mNNN_description(conn, **kwargs) function.
  2. Append (NNN, "description", _mNNN_description) to _MIGRATIONS.
"""
from __future__ import annotations

import sqlite3

_UTC_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

# Default station catalog (Database.md section 12)
_DEFAULT_STATIONS = [
    ("Gannomat",       "Drilling"),
    ("Tennoner",       "Cutting"),
    ("Insert Station", "Assembly"),
    ("Anderson",       "Machining"),
    ("Final Packing",  "Packing"),
]


# ── Core schema ───────────────────────────────────────────────────────────────

def _m001_core_tables(conn: sqlite3.Connection, **_) -> None:
    """Create the 9 core POC tables."""
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS rfid_tags (
            tag_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            epc         TEXT NOT NULL UNIQUE,
            tid         TEXT,
            tag_status  TEXT NOT NULL DEFAULT 'active',
            created_at  TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS parts (
            part_id            INTEGER PRIMARY KEY AUTOINCREMENT,
            part_number        TEXT,
            part_name          TEXT,
            part_type          TEXT,
            ibus_number        TEXT,
            job_number         TEXT,
            quantity_required  INTEGER,
            created_at         TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS part_tag_assignments (
            assignment_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id        INTEGER NOT NULL REFERENCES parts(part_id),
            tag_id         INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            assigned_at    TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            unassigned_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS stations (
            station_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            station_name  TEXT NOT NULL UNIQUE,
            station_type  TEXT,
            is_active     INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS rfid_readers (
            reader_id             INTEGER PRIMARY KEY AUTOINCREMENT,
            reader_name           TEXT NOT NULL,
            reader_ip             TEXT,
            station_id            INTEGER REFERENCES stations(station_id),
            location_description  TEXT,
            is_active             INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS rfid_antennas (
            antenna_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            reader_id     INTEGER NOT NULL REFERENCES rfid_readers(reader_id),
            antenna_port  INTEGER NOT NULL,
            antenna_name  TEXT,
            antenna_role  TEXT,
            station_id    INTEGER REFERENCES stations(station_id)
        );

        CREATE TABLE IF NOT EXISTS rfid_raw_reads (
            read_id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id              INTEGER REFERENCES rfid_tags(tag_id),
            epc                 TEXT NOT NULL,
            reader_id           INTEGER REFERENCES rfid_readers(reader_id),
            antenna_id          INTEGER REFERENCES rfid_antennas(antenna_id),
            antenna_port        INTEGER,
            rssi                REAL,
            reader_timestamp    TEXT,
            server_received_at  TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            raw_payload         TEXT,
            read_status         TEXT DEFAULT 'valid',
            is_stale            INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS part_station_events (
            event_id          INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id           INTEGER REFERENCES parts(part_id),
            tag_id            INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            station_id        INTEGER NOT NULL REFERENCES stations(station_id),
            event_type        TEXT NOT NULL,
            event_time        TEXT NOT NULL,
            source_read_id    INTEGER REFERENCES rfid_raw_reads(read_id),
            confidence_score  REAL,
            created_at        TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS part_station_sessions (
            session_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id         INTEGER REFERENCES parts(part_id),
            tag_id          INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            station_id      INTEGER NOT NULL REFERENCES stations(station_id),
            entry_event_id  INTEGER REFERENCES part_station_events(event_id),
            exit_event_id   INTEGER REFERENCES part_station_events(event_id),
            entry_time      TEXT,
            exit_time       TEXT,
            dwell_seconds   INTEGER,
            session_status  TEXT NOT NULL DEFAULT 'open',
            created_at      TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            updated_at      TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );
    """)


def _m002_operator_tables(conn: sqlite3.Connection, **_) -> None:
    """Create the 3 operator tables (Database.md section 6). Tables only."""
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS operators (
            operator_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_number  TEXT,
            operator_name    TEXT,
            rtls_badge_id    TEXT,
            is_active        INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS operator_station_presence (
            presence_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id       INTEGER NOT NULL REFERENCES operators(operator_id),
            station_id        INTEGER NOT NULL REFERENCES stations(station_id),
            detected_at       TEXT NOT NULL,
            distance_meters   REAL,
            confidence_score  REAL
        );

        CREATE TABLE IF NOT EXISTS part_operator_assignments (
            assignment_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id         INTEGER NOT NULL REFERENCES part_station_sessions(session_id),
            operator_id        INTEGER NOT NULL REFERENCES operators(operator_id),
            assignment_method  TEXT NOT NULL,
            confidence_score   REAL,
            assigned_at        TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );
    """)


def _m003_indexes(conn: sqlite3.Connection, **_) -> None:
    """Create recommended indexes (Database.md sections 5.7 and 13.3)."""
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS IX_raw_reads_epc_time
            ON rfid_raw_reads (epc, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_raw_reads_reader_time
            ON rfid_raw_reads (reader_id, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_raw_reads_antenna_time
            ON rfid_raw_reads (antenna_id, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_sessions_tag_station_status
            ON part_station_sessions (tag_id, station_id, session_status);
        CREATE INDEX IF NOT EXISTS IX_events_tag_station_time
            ON part_station_events (tag_id, station_id, event_time);
        CREATE INDEX IF NOT EXISTS IX_tags_epc
            ON rfid_tags (epc);
        CREATE INDEX IF NOT EXISTS IX_assignments_tag
            ON part_tag_assignments (tag_id);
        CREATE INDEX IF NOT EXISTS IX_presence_operator_time
            ON operator_station_presence (operator_id, detected_at);
        CREATE INDEX IF NOT EXISTS IX_part_operator_session
            ON part_operator_assignments (session_id);
    """)


def _m004_live_view(conn: sqlite3.Connection, **_) -> None:
    """Create the live dashboard view (Database.md section 8)."""
    conn.executescript("""
        DROP VIEW IF EXISTS vw_live_part_status;
        CREATE VIEW vw_live_part_status AS
        SELECT
            s.session_id,
            p.part_id,
            p.part_name,
            p.part_type,
            p.part_number,
            p.ibus_number,
            p.job_number,
            t.epc,
            st.station_name,
            s.entry_time,
            s.exit_time,
            s.dwell_seconds,
            s.session_status
        FROM part_station_sessions s
        JOIN rfid_tags t   ON s.tag_id     = t.tag_id
        LEFT JOIN parts p  ON s.part_id    = p.part_id
        JOIN stations st   ON s.station_id = st.station_id;
    """)


def _m005_seed_stations(conn: sqlite3.Connection, **_) -> None:
    """Seed the default station catalog."""
    for name, stype in _DEFAULT_STATIONS:
        conn.execute(
            "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
            (name, stype),
        )


def _m006_seed_reader_and_antennas(
    conn: sqlite3.Connection,
    station_name: str = "Gannomat",
    station_type: str = "Drilling",
    station_location: str = "",
    reader_name: str = "FX9600-Gannomat",
    reader_ip: str = "",
    entry_antenna: int = 1,
    exit_antenna: int = 2,
    **_,
) -> None:
    """Seed this machine's reader + its Entry/Exit antennas, bound to its station."""
    # Ensure the station exists (covers custom station names not in the catalog).
    conn.execute(
        "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
        (station_name, station_type),
    )
    st = conn.execute(
        "SELECT station_id FROM stations WHERE station_name = ?", (station_name,)
    ).fetchone()
    station_id = st[0] if st else None

    location_desc = (
        f"{station_location} - {station_name} entrance/exit RFID reader"
        if station_location
        else f"{station_name} entrance/exit RFID reader"
    )

    reader = conn.execute(
        "SELECT reader_id FROM rfid_readers WHERE reader_name = ?", (reader_name,)
    ).fetchone()
    if reader:
        reader_id = reader[0]
    else:
        cur = conn.execute(
            "INSERT INTO rfid_readers (reader_name, reader_ip, station_id, location_description) "
            "VALUES (?, ?, ?, ?)",
            (reader_name, reader_ip or None, station_id, location_desc),
        )
        reader_id = cur.lastrowid

    antennas = [
        (entry_antenna, f"{station_name} Entry Antenna", "Entry"),
        (exit_antenna,  f"{station_name} Exit Antenna",  "Exit"),
    ]
    for port, aname, role in antennas:
        exists = conn.execute(
            "SELECT antenna_id FROM rfid_antennas WHERE reader_id = ? AND antenna_port = ?",
            (reader_id, port),
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO rfid_antennas (reader_id, antenna_port, antenna_name, antenna_role, station_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (reader_id, port, aname, role, station_id),
            )


# ── Migration registry ────────────────────────────────────────────────────────

_MIGRATIONS: list[tuple[int, str, object]] = [
    (1, "core_tables",              _m001_core_tables),
    (2, "operator_tables",          _m002_operator_tables),
    (3, "indexes",                  _m003_indexes),
    (4, "live_view",                _m004_live_view),
    (5, "seed_stations",            _m005_seed_stations),
    (6, "seed_reader_and_antennas", _m006_seed_reader_and_antennas),
]


# ── Public entrypoint ─────────────────────────────────────────────────────────

def run_migrations(
    conn: sqlite3.Connection,
    station_name: str = "Gannomat",
    station_type: str = "Drilling",
    station_location: str = "",
    reader_name: str = "FX9600-Gannomat",
    reader_ip: str = "",
    entry_antenna: int = 1,
    exit_antenna: int = 2,
) -> None:
    """
    Run all pending migrations against `conn` in order.
    Safe to call on every process startup - already-applied migrations are skipped.
    """
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT ({_UTC_NOW})
        )
    """)

    applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}

    kwargs = {
        "station_name":     station_name,
        "station_type":     station_type,
        "station_location": station_location,
        "reader_name":      reader_name,
        "reader_ip":        reader_ip,
        "entry_antenna":    entry_antenna,
        "exit_antenna":     exit_antenna,
    }

    for version, name, fn in _MIGRATIONS:
        if version in applied:
            continue
        fn(conn, **kwargs)
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)",
            (version, name),
        )

    try:
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
    except Exception:
        pass
