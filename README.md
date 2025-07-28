# nostr-poster

A robust Nostr posting module with Proof of Work, retry logic, and comprehensive error handling.

## Installation

```bash
npm install besoeasy/nostr-poster
```

## Features

- ✅ **Automatic content parsing**: Hashtags (#tag), links, mentions (@npub), and note references
- ✅ **Proof of Work**: Configurable difficulty with non-blocking calculation
- ✅ **Retry logic**: Automatic retry with exponential backoff for failed relays
- ✅ **Input validation**: Comprehensive validation and sanitization
- ✅ **Enhanced error handling**: Detailed error messages and categorization
- ✅ **Optional expiration**: Posts can expire after specified days
- ✅ **Multiple relay support**: Publishes to 22+ relays by default (configurable via `relays.json`)
- ✅ **Connection management**: Proper timeout and cleanup handling

## Configuration

### Default Relays

The module uses a configurable list of default relays stored in `relays.json`. You can modify this file to customize the default relay list:

```json
{
  "defaultRelays": [
    "wss://relay.damus.io",
    "wss://purplerelay.com",
    "wss://relay.nostr.band"
  ]
}
```

Or pass custom relays in the options parameter to override the defaults.

## Usage

```javascript
import postToNostr from 'nostr-poster';

// Basic usage
const result = await postToNostr(nsec, 'Hello #nostr world!');

// Advanced usage with all options
const result = await postToNostr(nsec, content, {
  relays: ["wss://custom.relay"],
  powDifficulty: 4,
  expirationDays: 30,
  timeout: 5000,
  maxRetries: 3,
  kind: 1
});
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `relays` | `string[]` | Built-in list | Array of relay URLs |
| `powDifficulty` | `number` | `2` | POW difficulty level (0-32) |
| `expirationDays` | `number` | `undefined` | Expiration time in days |
| `timeout` | `number` | `15000` | Connection timeout in ms (1s-60s) |
| `maxRetries` | `number` | `3` | Max retry attempts per relay (1-10) |
| `kind` | `number` | `1` | Nostr event kind |

## Returns

Promise resolving to a comprehensive result object:

```javascript
{
  // Identifiers
  eventId: "hex...",
  noteId: "note1...", 
  pubkey: "hex...",
  npub: "npub1...",
  
  // Content metadata
  content: "processed content",
  contentLength: 42,
  hashtags: ["nostr"],
  links: ["https://..."],
  mentions: ["npub1..."],
  notes: ["note1..."],
  
  // Publishing results
  publishedTo: 15,
  totalRelays: 22,
  successfulRelays: [...],
  failedRelays: [...],
  
  // Configuration
  powDifficulty: 2,
  retriesUsed: 3,
  
  // Optional expiration
  expirationDate: "2025-08-04T22:22:22.000Z",
  expiresIn: "7 days"
}
```

## Improvements in v1.1.0

- **Non-blocking POW**: Calculation yields control to prevent UI freezing
- **Retry logic**: Automatic retry with exponential backoff
- **Better parsing**: Improved regex patterns for content extraction
- **Input validation**: Comprehensive validation and sanitization
- **Enhanced errors**: Categorized error messages for better debugging
- **Connection cleanup**: Proper WebSocket cleanup and timeout handling
- **Note references**: Support for `note1...` references as `e` tags
