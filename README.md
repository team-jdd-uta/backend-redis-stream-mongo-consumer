# Redis Stream -> MongoDB

## What this adds
- A terminal-driven producer that publishes lines into Redis Stream.
- Consumer (`src/app.js`) reads from the stream and saves to MongoDB.
- Consumer batches inserts every 1 second (default).
- Terminal producer sends 1000 messages per input (default).

## Prerequisites
- Redis and MongoDB running (Docker recommended).
- `.env` configured (see existing `.env`).

## Run

```powershell
# terminal 1: consumer
node src/app.js
```

```powershell
# terminal 2: interactive producer
node src/cli/streamProducer.js
```

### Input formats
- Plain text: sends as `comment` with `user_id=terminal`, `room_id=0`.
- JSON: `{"user_id":"u1","comment":"hi","room_id":42}`

## Verify

```powershell
node check-data.js
```

## Optional batching env

```env
BATCH_INTERVAL_MS=1000
MAX_BATCH_SIZE=500
BULK_COUNT=1000
```
