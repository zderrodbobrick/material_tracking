# Glossary

Terms used across Material Tracking documentation and the shop floor.

| Term | Definition |
|------|------------|
| **RFID** | Radio-Frequency Identification — wireless identification using tags and fixed readers |
| **EPC** | Electronic Product Code — unique ID stored on an RFID tag, often transmitted as hex |
| **IBUS** | Bobrick internal work-order / part numbering scheme embedded in tag data (e.g. `IBUS463947`) |
| **Work order** | Manufacturing batch identified by six digits; multiple part tags share one IBUS order |
| **FX9600** | Zebra fixed UHF RFID reader used at production stations |
| **HTTP POST mode** | Reader configuration that pushes tag JSON to a URL (`/tags`) — production ingest path |
| **LLRP** | Low-Level Reader Protocol — direct reader protocol (legacy `archive/read.py` only) |
| **Antenna port** | Numeric ID for a physical reader antenna (1–7 in this deployment) |
| **RSSI** | Received Signal Strength Indicator in dBm; closer to 0 = stronger signal |
| **Session** | One part visit to a station from entry/presence through close/abandon |
| **Dwell** | Time a part spends in a dwell-mode station between entry and close events |
| **Dwell station** | Station using enter/exit timing (Gannomat, Tennoner) |
| **Presence station** | Station using “read = here, idle = gone” (LBD, Insert Station) |
| **Production spine** | Ordered stations for progress: Tenoner → LBD → Gannomat → Insert Station |
| **Sweeper** | Background thread that closes idle or abandoned sessions |
| **Throttle** | Time-based deduplication of repeated reads (`RAW_THROTTLE_SEC`) |
| **RTLS** | Real-Time Location System — Sewio badge tracking for operators |
| **Sewio** | Vendor RTLS platform (sensmapserver WebSocket + REST) |
| **Badge tag** | Sewio tag worn by operator; distinct from part RFID labels |
| **Zone** | Sewio floor area mapped to a station name |
| **WAL** | SQLite Write-Ahead Logging — allows concurrent reads during writes |
| **Socket.IO** | WebSocket library; API emits `rfid_update` on DB changes |
| **ZPL** | Zebra Programming Language — printer command format for labels and encode |
| **R41** | Bobrick work order file format parsed by `r41/` tools |
| **Gannomat** | CNC/drilling station — primary POC for dwell tracking |
| **Tennoner / Tenoner** | Cutting station; DB may store “Tennoner”, spine uses “Tenoner” |
| **LBD** | Machining station (presence mode) |
| **Insert Station** | Assembly station; antenna 3 closes Gannomat dwell |
| **POC** | Proof of concept — current deployment scope before full plant roll-out |
| **DwellTracker** | Python class in `storage.py` implementing session logic |
| **vw_live_part_status** | SQL view joining sessions, parts, tags for dashboard queries |

---

## Status values

| DB value | Typical UI label |
|----------|------------------|
| `open` | In process |
| `closed` | Completed |
| `abandoned` | Abandoned |
| `exit_only` | Exit only / missing entrance |

---

## Related

- [Data model](../explanation/data-model.md)
- [Session lifecycle](../explanation/session-lifecycle.md)
