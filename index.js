import { finalizeEvent, getPublicKey, nip19, getEventHash } from "nostr-tools";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load relays from JSON file
let DEFAULT_RELAYS;
try {
  const relaysConfig = JSON.parse(readFileSync(join(__dirname, 'relays.json'), 'utf8'));
  DEFAULT_RELAYS = relaysConfig.defaultRelays;
} catch (error) {
  // Fallback relays if JSON file is not found
  console.warn('Warning: Could not load relays.json, using fallback relays');
  DEFAULT_RELAYS = [
    "wss://relay.damus.io",
    "wss://purplerelay.com",
    "wss://relay.nostr.band",
    "wss://relay.snort.social",
    "wss://nostr-pub.wellorder.net"
  ];
}

const DEFAULT_POW_DIFFICULTY = 2;
const DEFAULT_TIMEOUT = 1000 * 15;
const MAX_RETRIES = 3;
const MAX_CONTENT_LENGTH = 65535;

/**
 * Validates and sanitizes input parameters
 * @param {string} nsec - Private key
 * @param {string} content - Content to post
 * @param {Object} options - Options object
 * @returns {Object} Validated and sanitized inputs
 */
function validateAndSanitizeInputs(nsec, content, options = {}) {
  // Validate private key
  if (!nsec || typeof nsec !== "string" || nsec.trim().length === 0) {
    throw new Error("Invalid private key: must be a non-empty string");
  }
  
  // Validate content
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Invalid content: must be a non-empty string");
  }
  
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content too long: maximum ${MAX_CONTENT_LENGTH} characters`);
  }
  
  // Sanitize and validate options
  const sanitizedOptions = {
    relays: Array.isArray(options.relays) ? options.relays.filter(r => typeof r === 'string' && r.startsWith('wss://')) : DEFAULT_RELAYS,
    powDifficulty: Math.max(0, Math.min(Number(options.powDifficulty) || DEFAULT_POW_DIFFICULTY, 32)),
    timeout: Math.max(1000, Math.min(Number(options.timeout) || DEFAULT_TIMEOUT, 60000)),
    kind: Number(options.kind) || 1,
    expirationDays: options.expirationDays ? Math.max(1, Number(options.expirationDays)) : undefined,
    maxRetries: Math.max(1, Math.min(Number(options.maxRetries) || MAX_RETRIES, 10))
  };
  
  if (sanitizedOptions.relays.length === 0) {
    throw new Error("No valid relay URLs provided");
  }
  
  return { nsec: nsec.trim(), content: content.trim(), options: sanitizedOptions };
}

/**
 * Extracts hashtags, mentions and links from content
 * @param {string} content - Content to analyze
 * @returns {{hashtags: string[], mentions: string[], links: string[], notes: string[]}} Extracted tags
 */
function extractContentTags(content) {
  // More comprehensive patterns
  const hashtagPattern = /#([a-zA-Z0-9_]+)/g;
  const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  const mentionPattern = /@(npub[a-zA-Z0-9]{59})/g;
  const notePattern = /(nostr:)?(note[a-zA-Z0-9]{59})/g;

  const hashtags = [...(content.match(hashtagPattern) || [])].map((tag) =>
    tag.slice(1).toLowerCase()
  );
  
  const links = content.match(urlPattern) || [];
  
  const mentions = [];
  const mentionMatches = content.match(mentionPattern) || [];
  for (const match of mentionMatches) {
    const npub = match.replace('@', '');
    if (npub.length === 63) { // Valid npub length
      mentions.push(npub);
    }
  }

  const notes = [...(content.match(notePattern) || [])].map(note => 
    note.replace('nostr:', '')
  );

  return { hashtags, links, mentions, notes };
}

/**
 * Calculates Proof of Work for an event with yielding to prevent blocking
 * @param {Object} event - Nostr event object
 * @param {number} difficulty - POW difficulty level
 * @returns {Promise<Object>} Event with POW nonce
 */
async function calculatePow(event, difficulty) {
  if (difficulty === 0) return event;
  
  let nonce = 0;
  let hash;
  const startTime = Date.now();
  const targetPrefix = "0".repeat(difficulty);
  
  // Create a copy to avoid mutating the original
  const workEvent = { ...event, tags: [...event.tags] };
  
  do {
    // Yield control every 1000 iterations or after 10ms
    if (nonce % 1000 === 0 && Date.now() - startTime > 10) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    // Remove existing nonce tags
    workEvent.tags = workEvent.tags.filter((tag) => tag[0] !== "nonce");
    workEvent.tags.push(["nonce", String(nonce), String(difficulty)]);
    hash = getEventHash(workEvent);
    nonce++;
    
    // Safety check to prevent infinite loops
    if (nonce > 10000000) {
      throw new Error(`POW calculation exceeded maximum attempts for difficulty ${difficulty}`);
    }
  } while (!hash.startsWith(targetPrefix));
  
  return workEvent;
}

/**
 * Connects to a relay and publishes an event
 * @param {string} relayUrl - Relay URL
 * @param {Object} signedEvent - Signed Nostr event
 * @param {number} timeout - Connection timeout
 * @returns {Promise<Object>} Relay result
 */
function connectAndPublish(relayUrl, signedEvent, timeout) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    let timeoutId;
    let hasResolved = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        cleanup();
        reject(new Error(`Connection to ${relayUrl} timed out`));
      }
    }, timeout);

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify(["EVENT", signedEvent]));
      } catch (error) {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          reject(new Error(`Failed to send event to ${relayUrl}: ${error.message}`));
        }
      }
    });

    ws.on("message", (data) => {
      if (hasResolved) return;
      
      try {
        const [type, id, success, message] = JSON.parse(data);
        if (type === "OK" && id === signedEvent.id) {
          hasResolved = true;
          cleanup();
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
      if (!hasResolved) {
        hasResolved = true;
        cleanup();
        reject(new Error(`WebSocket error with ${relayUrl}: ${err.message}`));
      }
    });
  });
}

/**
 * Publishes to a single relay with retry logic
 * @param {string} relayUrl - Relay URL
 * @param {Object} signedEvent - Signed Nostr event
 * @param {number} timeout - Connection timeout
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} Relay result
 */
async function publishToRelay(relayUrl, signedEvent, timeout, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await connectAndPublish(relayUrl, signedEvent, timeout);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
 * @param {number} [options.maxRetries] - Maximum retry attempts per relay
 * @returns {Promise<Object>} Post result with comprehensive metadata
 */
async function postToNostr(nsec, content, options = {}) {
  try {
    // Validate and sanitize inputs
    const { nsec: validatedNsec, content: validatedContent, options: validatedOptions } = 
      validateAndSanitizeInputs(nsec, content, options);

    const {
      relays,
      powDifficulty,
      expirationDays,
      timeout,
      kind,
      maxRetries
    } = validatedOptions;

    // Decode private key
    const privateKey = validatedNsec.startsWith("nsec") ? nip19.decode(validatedNsec).data : validatedNsec;
    const pubkey = getPublicKey(privateKey);

    // Encode public key as npub
    const npub = nip19.npubEncode(pubkey);

    // Prepare event data
    const { hashtags, links, mentions, notes } = extractContentTags(validatedContent);
    const tags = [
      ...hashtags.map((tag) => ["t", tag]),
      ...links.map((url) => ["r", url]),
    ];

    // Add mentions as p tags
    for (const mention of mentions) {
      try {
        const { data } = nip19.decode(mention); // Already cleaned npub
        tags.push(["p", data]);
      } catch (e) {
        console.warn(`Invalid mention: ${mention}`);
      }
    }

    // Add note references as e tags
    for (const note of notes) {
      try {
        const { data } = nip19.decode(note);
        tags.push(["e", data]);
      } catch (e) {
        console.warn(`Invalid note reference: ${note}`);
      }
    }

    // Add expiration tag only if expirationDays is specified
    let expirationTime;
    if (expirationDays !== undefined) {
      expirationTime = Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60;
      tags.push(["expiration", String(expirationTime)]);
    }

    const createdAt = Math.floor(Date.now() / 1000);

    let event = {
      kind,
      created_at: createdAt,
      tags,
      content: validatedContent,
      pubkey,
    };

    // Calculate POW (now async)
    event = await calculatePow(event, powDifficulty);

    const signedEvent = finalizeEvent(event, privateKey);
    const eventId = signedEvent.id;

    // Encode event ID as note ID
    const noteId = nip19.noteEncode(eventId);

    // Publish to relays with retry logic
    const relayResults = await Promise.allSettled(
      relays.map(async (relayUrl) => {
        return publishToRelay(relayUrl, signedEvent, timeout, maxRetries);
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
      content: validatedContent,
      createdAt,
      createdAtISO: new Date(createdAt * 1000).toISOString(),

      // Content metadata
      contentLength: validatedContent.length,
      hashtags,
      links,
      mentions,
      notes,

      // Relay information
      publishedTo: successfulRelays.length,
      totalRelays: relays.length,
      successfulRelays,
      failedRelays,

      // Configuration used
      powDifficulty,
      retriesUsed: maxRetries,

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

  } catch (error) {
    // Enhanced error handling
    if (error.message.includes('Invalid private key')) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
    if (error.message.includes('POW calculation')) {
      throw new Error(`Proof of Work failed: ${error.message}`);
    }
    if (error.message.includes('Failed to publish')) {
      throw new Error(`Network error: ${error.message}`);
    }
    
    // Re-throw with original message if not a known error type
    throw error;
  }
}

export default postToNostr;
