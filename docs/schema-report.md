# Live show database schema

Inspected directly from the configured, read-only `DATABASE_URL` on 2026-10-01. This is a point-in-time schema report, not a data dump. Runtime show data is always queried from Postgres.

| Table | Columns | Keys and relationships |
| --- | --- | --- |
| `public.liveshows` | `id uuid` NOT NULL, `artist text` NOT NULL, `raw_venue_name text`, `venue_uuid uuid`, `date timestamptz` NOT NULL, `tickets_url text`, `description text`, `source text` NOT NULL, `full_address text`, `created_at timestamptz`, `updated_at timestamptz`, `venue_id uuid` | Primary key `id`; `venue_uuid` references `venues.id`. |
| `public.venues` | `id uuid` NOT NULL, `created_at timestamptz` NOT NULL, `name text`, `lat double precision`, `lng double precision`, `city text` | Primary key `id`; unique constraint on `(name, city, lat, lng)`. |
| `public.artists` | Not present. | Artist is stored as `liveshows.artist` text. |

No price, genre, or neighborhood columns exist in these tables. The configured role is `letsgetdown_reader`, with SELECT access to both tables and no INSERT access to `liveshows`. The fixed show/venue join query completed successfully. At inspection time, 87 rows had `date >= now()`; this count changes continuously.
