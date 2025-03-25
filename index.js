import { finalizeEvent, getPublicKey, nip19, getEventHash } from "nostr-tools";
import WebSocket from "ws";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://purplerelay.com",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.nostr.bg",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://nostr.bitcoiner.social",
  "wss://nostr21.com",
  "wss://nostr.oxtr.dev",
  "wss://nostr.bongbong.com",
  "wss://relay.primal.net",
  "wss://nostr.zbd.gg",
  "wss://nostr-relay.nokotaro.com",
  "wss://relayable.org",
  "wss://public.relaying.io",
  "wss://nostr.fmt.wiz.biz",
  "wss://soloco.nl",
  "wss://relay.mutinywallet.com",
  "wss://nostr.einundzwanzig.space",
  "wss://relay.nostr.net",
];

const DEFAULT_POW_DIFFICULTY = 2;
const DEFAULT_TIMEOUT = 1000 * 15;
/**
 * Extracts hashtags, mentions and links from content
 * @param {string} content - Content to analyze
 * @returns {{hashtags: string[], mentions: string[], links: string[]}} Extracted tags
 */
function extractContentTags(content) {
  const hashtagPattern = /#(\w+)/g;
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const mentionPattern = /@npub[a-zA-Z0-9]{59}/g;

  const hashtags = [...(content.match(hashtagPattern) || [])].map((tag) =>
    tag.slice(1)
  );
  const links = content.match(urlPattern) || [];
  const mentions = content.match(mentionPattern) || [];

  return { hashtags, links, mentions };
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
    event.tags = event.tags.filter((tag) => tag[0] !== "nonce");
    event.tags.push(["nonce", String(nonce), String(difficulty)]);
    hash = getEventHash(event);
    nonce++;
  } while (!hash.startsWith("0".repeat(difficulty)));
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
 * @param {number} [options.kind] - Nostr event kind (default: 1 for text note)
 * @returns {Promise<Object>} Post result with comprehensive metadata
 */
async function postToNostr(nsec, content, options = {}) {
  const {
    relays = DEFAULT_RELAYS,
    powDifficulty = DEFAULT_POW_DIFFICULTY,
    expirationDays,
    timeout = DEFAULT_TIMEOUT,
    kind = 1,
  } = options;

  // Validate inputs
  if (!nsec || typeof nsec !== "string") throw new Error("Invalid private key");
  if (!content || typeof content !== "string")
    throw new Error("Invalid content");

  // Decode private key
  const privateKey = nsec.startsWith("nsec") ? nip19.decode(nsec).data : nsec;
  const pubkey = getPublicKey(privateKey);

  // Encode public key as npub
  const npub = nip19.npubEncode(pubkey);

  // Prepare event data
  const { hashtags, links, mentions } = extractContentTags(content);
  const tags = [
    ...hashtags.map((tag) => ["t", tag]),
    ...links.map((url) => ["r", url]),
  ];

  // Add mentions as p tags
  for (const mention of mentions) {
    try {
      const { data } = nip19.decode(mention.slice(1)); // Remove @ prefix
      tags.push(["p", data]);
    } catch (e) {
      console.warn(`Invalid mention: ${mention}`);
    }
  }

  // Add expiration tag only if expirationDays is specified
  let expirationTime;
  if (expirationDays !== undefined) {
    if (!Number.isInteger(expirationDays) || expirationDays <= 0) {
      throw new Error("expirationDays must be a positive integer");
    }
    expirationTime =
      Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60;
    tags.push(["expiration", String(expirationTime)]);
  }

  const createdAt = Math.floor(Date.now() / 1000);

  let event = {
    kind,
    created_at: createdAt,
    tags,
    content,
    pubkey,
  };

  // Calculate POW
  event = calculatePow(event, powDifficulty);

  const signedEvent = finalizeEvent(event, privateKey);
  const eventId = signedEvent.id;

  // Encode event ID as note ID
  const noteId = nip19.noteEncode(eventId);

  const relayResults = await Promise.allSettled(
    relays.map(async (relayUrl) => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(relayUrl);
        let timeoutId;

        timeoutId = setTimeout(() => {
          ws.close();
          reject(new Error(`Connection to ${relayUrl} timed out`));
        }, timeout);

        ws.on("open", () => {
          ws.send(JSON.stringify(["EVENT", signedEvent]));
        });

        ws.on("message", (data) => {
          try {
            const [type, id, success, message] = JSON.parse(data);
            if (type === "OK" && id === eventId) {
              clearTimeout(timeoutId);
              ws.close();
              resolve({
                relay: relayUrl,
                success: !!success,
                message: message || null,
              });
            }
          } catch (err) {
            console.warn(`Error parsing message from ${relayUrl}:`, err);
          }
        });

        ws.on("error", (err) => {
          clearTimeout(timeoutId);
          ws.close();
          reject(new Error(`WebSocket error with ${relayUrl}: ${err.message}`));
        });
      });
    })
  );

  // Process relay results
  const successfulRelays = [];
  const failedRelays = [];

  relayResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successfulRelays.push(result.value);
    } else {
      failedRelays.push({
        relay: relays[index],
        error: result.reason.message,
      });
    }
  });

  if (successfulRelays.length === 0) {
    throw new Error("Failed to publish to any relay");
  }

  // Construct comprehensive result object
  const result = {
    // Basic identifiers
    eventId,
    noteId,
    pubkey,
    npub,

    // Event details
    kind,
    content,
    createdAt,
    createdAtISO: new Date(createdAt * 1000).toISOString(),

    // Content metadata
    contentLength: content.length,
    hashtags,
    links,
    mentions,

    // Relay information
    publishedTo: successfulRelays.length,
    totalRelays: relays.length,
    successfulRelays,
    failedRelays,

    // Raw event (for debugging or further processing)
    rawEvent: signedEvent,
  };

  // Add expiration info if applicable
  if (expirationTime) {
    result.expirationTime = expirationTime;
    result.expirationDate = new Date(expirationTime * 1000).toISOString();
    result.expiresIn = `${expirationDays} days`;
  }

  return result;
}

export default postToNostr;
