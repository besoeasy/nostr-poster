const nsec = "nsec1hwjakev4fg6u9nkqg495pgl3rss6nrhfzprqcp9ukws4c4d6kdaszkyjjn";
const content = "Hello #nostr world!";

import postToNostr from "./index.js";

/**
 * Test the Nostr posting functionality
 * This example demonstrates how to use the postToNostr module
 */
async function runTest() {
  try {
    console.log("Posting to Nostr network...");

    // Call the postToNostr function with options
    const result = await postToNostr(nsec, content, {
      // Custom options
      powDifficulty: 1, // Lower difficulty for testing (increase for production)
      expirationDays: 7, // Post will expire in 7 days
    });

    // Display the key information
    console.log("\n===== Post Successful =====");
    console.log(`Note ID: ${result.noteId}`);
    console.log(`Account npub: ${result.npub}`);
    console.log(`Event ID (hex): ${result.eventId}`);
    console.log(`Created at: ${result.createdAtISO}`);

    // Display relay information
    console.log(
      `\nPublished to ${result.publishedTo} of ${result.totalRelays} relays`
    );
    console.log("\nSuccessful relays:");
    result.successfulRelays.forEach((relay) => {
      console.log(
        `- ${relay.relay}: ${relay.success ? "Success" : "Failed"} ${
          relay.message ? `(${relay.message})` : ""
        }`
      );
    });

    if (result.failedRelays.length > 0) {
      console.log("\nFailed relays:");
      result.failedRelays.forEach((relay) => {
        console.log(`- ${relay.relay}: ${relay.error}`);
      });
    }

    // Display content metadata
    console.log("\nContent metadata:");
    console.log(`- Length: ${result.contentLength} characters`);
    console.log(`- Hashtags: ${result.hashtags.join(", ") || "None"}`);
    console.log(`- Links: ${result.links.join(", ") || "None"}`);
    console.log(`- Mentions: ${result.mentions.join(", ") || "None"}`);

    // Display expiration info if applicable
    if (result.expirationTime) {
      console.log(`\nExpires on: ${result.expirationDate}`);
      console.log(`Expires in: ${result.expiresIn}`);
    }

    // For debugging: uncomment to see the full raw event
    // console.log('\nRaw event:', JSON.stringify(result.rawEvent, null, 2));

    console.log('\nFull result object available in variable "result"');
  } catch (error) {
    console.error("\n❌ Error posting to Nostr:", error.message);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
  }
}

// Run the test
runTest();

// Usage examples:
/*
// Basic usage
const result = await postToNostr(nsec, 'Hello Nostr world!');

// With custom relays
const result = await postToNostr(nsec, content, {
  relays: ['wss://relay1.com', 'wss://relay2.com']
});

// With custom POW difficulty
const result = await postToNostr(nsec, content, {
  powDifficulty: 5 // Higher difficulty for better spam protection
});

// With expiration
const result = await postToNostr(nsec, content, {
  expirationDays: 30 // Post will expire after 30 days
});

// With custom event kind (e.g., kind 30023 for long-form content)
const result = await postToNostr(nsec, longFormContent, {
  kind: 30023
});
*/
