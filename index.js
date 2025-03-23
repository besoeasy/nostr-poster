const { finalizeEvent, getPublicKey, nip19, getEventHash } = require('nostr-tools');
const WebSocket = require('ws');

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://purplerelay.com'];
const DEFAULT_POW_DIFFICULTY = 3;
const DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * Nostr posting module with POW and optional expiration features
 * @module nostr-poster
 */

/**
 * Extracts hashtags and links from content
 * @param {string} content - Content to analyze
 * @returns {{hashtags: string[], links: string[]}} Extracted tags
 */
function extractHashtagsAndLinks(content) {
  const hashtagPattern = /#(\w+)/g;
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const hashtags = [...(content.match(hashtagPattern) || [])].map(tag => tag.slice(1));
  const links = content.match(urlPattern) || [];
  return { hashtags, links };
}

/**
 * Calculates Proof of Work for an event
 * @param {Object} event - Nostr event object
 * @param {number} difficulty - POW difficulty level
 * @returns {Object} Event with POW nonce
 */
function calculatePow(event, difficulty) {
  let nonce = 0;
  let hash;
  do {
    event.tags = event.tags.filter(tag => tag[0] !== 'nonce');
    event.tags.push(['nonce', String(nonce), String(difficulty)]);
    hash = getEventHash(event);
    nonce++;
  } while (!hash.startsWith('0'.repeat(difficulty)));
  return event;
}

/**
 * Posts content to Nostr network
 * @param {string} nsec - Private key (nsec format or hex)
 * @param {string} content - Content to post
 * @param {Object} [options] - Configuration options
 * @param {string[]} [options.relays] - Array of relay URLs
 * @param {number} [options.powDifficulty] - POW difficulty level
 * @param {number} [options.expirationDays] - Expiration time in days (optional)
 * @param {number} [options.timeout] - Connection timeout in ms
 * @returns {Promise<{eventId: string, expirationDate?: string}>} Post result
 */
async function postToNostr(nsec, content, options = {}) {
  const {
    relays = DEFAULT_RELAYS,
    powDifficulty = DEFAULT_POW_DIFFICULTY,
    expirationDays,
    timeout = DEFAULT_TIMEOUT
  } = options;

  // Validate inputs
  if (!nsec || typeof nsec !== 'string') throw new Error('Invalid private key');
  if (!content || typeof content !== 'string') throw new Error('Invalid content');

  // Decode private key
  const privateKey = nsec.startsWith('nsec') ? nip19.decode(nsec).data : nsec;
  const pubkey = getPublicKey(privateKey);

  // Prepare event data
  const { hashtags, links } = extractHashtagsAndLinks(content);
  const tags = [
    ...hashtags.map(tag => ['t', tag]),
    ...links.map(url => ['r', url])
  ];

  // Add expiration tag only if expirationDays is specified
  let expirationTime;
  if (expirationDays !== undefined) {
    if (!Number.isInteger(expirationDays) || expirationDays <= 0) {
      throw new Error('expirationDays must be a positive integer');
    }
    expirationTime = Math.floor(Date.now() / 1000) + (expirationDays * 24 * 60 * 60);
    tags.push(['expiration', String(expirationTime)]);
  }

  let event = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey
  };

  // Calculate POW
  event = calculatePow(event, powDifficulty);
  const signedEvent = finalizeEvent(event, privateKey);
  const eventId = signedEvent.id;

  // Publish to relays
  let connectedRelays = 0;
  let published = false;

  const relayPromises = relays.map(relayUrl => new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', signedEvent]));
    });

    ws.on('message', data => {
      const [type, id, success] = JSON.parse(data);
      if (type === 'OK' && id === eventId && success) {
        published = true;
        ws.close();
        resolve();
      }
    });

    ws.on('error', err => {
      ws.close();
      resolve(); // Resolve even on error to continue with other relays
    });
  }));

  // Handle timeout and results
  await Promise.race([
    Promise.all(relayPromises.map(p => p.catch(() => null))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
  ]);

  if (!published) throw new Error('Failed to publish to any relay');

  const result = { eventId };
  if (expirationTime) {
    result.expirationDate = new Date(expirationTime * 1000).toLocaleString();
  }

  return result;
}

module.exports = postToNostr;