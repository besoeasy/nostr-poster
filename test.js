const postToNostr = require("./index");

const nsec = "nsec1hwjakev4fg6u9nkqg495pgl3rss6nrhfzprqcp9ukws4c4d6kdaszkyjjn";
const content = "Hello #nostr world!";

async function main() {
  await postToNostr(nsec, content)
    .then((result) => console.log(result))
    .catch((err) => console.error(err));

  await postToNostr(nsec, content, {
    relays: ["wss://custom.relay"],
    powDifficulty: 4,
    expirationDays: 30,
    timeout: 5000,
  }).then((result) => console.log(result));
}

main();
