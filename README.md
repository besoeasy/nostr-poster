# nostr-poster

A simple Nostr posting module with Proof of Work and optional expiration.

## Installation

```bash
npm install nostr-poster
```

## Usage

```javascript
const postToNostr = require('nostr-poster');

  await postToNostr(nsec, content)
    .then((result) => console.log(result))
    .catch((err) => console.error(err));

  await postToNostr(nsec, content, {
    relays: ["wss://custom.relay"],
    powDifficulty: 4,
    expirationDays: 30,
    timeout: 5000,
  }).then((result) => console.log(result));
```

## Features

- Automatic hashtag (#tag) extraction
- Link detection and tagging
- Proof of Work (default difficulty: 3)
- Optional expiration in days
- Multiple relay support

## Options

- `relays`: Array of relay URLs (default: damus.io, purplerelay.com)
- `powDifficulty`: POW difficulty level (default: 3)
- `expirationDays`: Expiration time in days (optional)
- `timeout`: Connection timeout in ms (default: 10000)

## Returns

Promise resolving to:
- `{ eventId: string }` (no expiration)
- `{ eventId: string, expirationDate: string }` (with expiration)
