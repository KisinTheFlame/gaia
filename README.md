# Gaia Config Center MVP

This service exposes 3 HTTP APIs:

- `GET /get?key=<key>`
- `POST /set` with JSON body: `{"key":"<key>","value":"<value>"}`
- `DELETE /delete?key=<key>`

Persistent data is stored in PostgreSQL.

## Build image

```bash
docker build -t gaia-config-center:latest .
```

## Run with Docker Compose

```bash
docker compose up -d --build
```

Services in compose:

- `postgres` (`postgres:16-alpine`) with volume `gaia-postgres-data`
- `gaia-config-center` on host `33000`

Database env defaults (already configured in compose):

- `DB_HOST=postgres`
- `DB_PORT=5432`
- `DB_NAME=gaia`
- `DB_USER=gaia`
- `DB_PASSWORD=gaia`

## API examples

```bash
curl -X POST http://localhost:33000/set \
  -H "Content-Type: application/json" \
  -d '{"key":"demo","value":"v1"}'

curl "http://localhost:33000/get?key=demo"

curl -X DELETE "http://localhost:33000/delete?key=demo"
```
