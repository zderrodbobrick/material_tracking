# Material Tracking — Documentation

Material tracking provides real-time visibility into the progress of each IBUS number and the current location of its associated parts. By integrating RTLS data, the system can identify which operators worked on each part and support analysis of machine, operator, and part-level efficiency.

---

## Tutorials

Use these tutorials to learn how to set up the system, navigate the dashboard, and use its primary features.

| Document | What you will learn |
|----------|---------------------|
| [Getting started](tutorials/getting-started.md) | Install dependencies, start services, open the dashboard, verify RFID ingest |
| [Explore the dashboard](tutorials/explore-the-dashboard.md) | Navigate live map, IBUS orders, analytics, and station settings |

---

## How-to guides

Goal-oriented instructions for specific tasks.

| Document | Task |
|----------|------|
| [Start up (Local)](how-to/run-locally.md) | Start API, listener, and dashboard on Windows |
| [Configure the Zebra reader](how-to/configure-zebra-reader.md) | Point an FX9600 at the HTTP listener |
| [Run the simulator](how-to/run-the-simulator.md) | Demo the line without physical hardware |
| [Print RFID labels](how-to/print-rfid-labels.md) | Encode tags and print test labels |
| [Enable RTLS](how-to/enable-rtls.md) | Connect Sewio operator badge tracking |
| [Build the dashboard](how-to/build-and-deploy-dashboard.md) | Vite dev server vs production build |
| [Run tests](how-to/run-tests.md) | Execute the test suite |
| [Publish documentation](how-to/publish-documentation.md) | Build and host this docs web app |

---

## Explanation

Conceptual background — how and why the system works.

| Document | Topic |
|----------|-------|
| [Architecture](explanation/architecture.md) | Components, data flow, and technology stack |
| [Session lifecycle](explanation/session-lifecycle.md) | Dwell vs presence stations, statuses, sweeper |
| [Data model](explanation/data-model.md) | Normalized schema, views, and EPC format |
| [RTLS and operators](explanation/rtls-and-operators.md) | Sewio integration and operator assignment |

---

## Reference

Technical specifications for lookup while working.

| Document | Contents |
|----------|----------|
| [Configuration](reference/configuration.md) | All environment variables and defaults |
| [API](reference/api.md) | REST endpoints and WebSocket events |
| [Database schema](reference/database-schema.md) | Tables, views, indexes, migrations |
| [CLI and scripts](reference/cli-and-scripts.md) | `start.ps1`, sim, printer, utilities |
| [Glossary](reference/glossary.md) | Terms and acronyms |

---

## Legacy reference

[CODEBASE_REFERENCE.md](CODEBASE_REFERENCE.md) is an older monolithic reference (June 2026). Prefer the Diátaxis docs above for current behavior; use the legacy file only if you need historical detail.

## Architecture diagrams

Interactive HTML diagrams live in this folder:

- [architecture.html](architecture.html) — full system diagram
- [architecture-simple.html](architecture-simple.html) — simplified view
- [architecture.mmd](architecture.mmd) — Mermaid source
